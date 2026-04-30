import { Gateway, Lora } from '@abd/proto';
import { notify, prisma } from '@abd/db';
import type { GatewaySession } from './session.js';
import { publishLockEvent } from './pubsub.js';

export async function handleRegister(s: GatewaySession, payload: Buffer): Promise<void> {
  if (s.registered) {
    s.log.warn('duplicate REGISTER');
    return;
  }

  let parsed: Gateway.RegisterPayload;
  try {
    parsed = Gateway.parseRegisterPayload(payload);
  } catch (err) {
    s.log.warn({ err }, 'bad REGISTER payload');
    s.send(Gateway.encodeError(Gateway.ErrorCode.BAD_LEN));
    s.close('bad register payload');
    return;
  }

  const gateway = await prisma.gateway.findUnique({ where: { gwId: parsed.gwId } });
  if (!gateway) {
    s.send(Gateway.encodeRegisterAck(Gateway.RegisterAckCode.UNKNOWN_GW_ID));
    setTimeout(() => s.close('unknown gw_id'), 1000);
    return;
  }
  if (gateway.token !== parsed.token) {
    s.send(Gateway.encodeRegisterAck(Gateway.RegisterAckCode.BAD_TOKEN));
    setTimeout(() => s.close('bad token'), 1000);
    return;
  }
  if (gateway.status === 'suspended' || gateway.status === 'retired') {
    s.send(Gateway.encodeRegisterAck(Gateway.RegisterAckCode.DISABLED));
    s.close('disabled');
    return;
  }

  await prisma.gateway.update({
    where: { id: gateway.id },
    data: { online: true, lastSeenAt: new Date() },
  });
  await prisma.gatewaySession.create({
    data: { gatewayId: gateway.id, clientIp: s.remoteAddress },
  });

  s.gatewayId = gateway.id;
  s.gwId = gateway.gwId;
  s.registered = true;
  if (s.registerTimer) clearTimeout(s.registerTimer);

  s.send(Gateway.encodeRegisterAck(Gateway.RegisterAckCode.OK));
  s.log.info({ gwId: gateway.gwId }, 'gateway registered');
}

export async function handleHeartbeat(s: GatewaySession): Promise<void> {
  if (!s.registered) {
    s.send(Gateway.encodeError(Gateway.ErrorCode.NOT_REGISTERED));
    return;
  }
  if (s.gatewayId) {
    await prisma.gateway
      .update({ where: { id: s.gatewayId }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }
  s.send(Gateway.encodeHeartbeatAck());
}

export async function handleLoraUplink(s: GatewaySession, payload: Buffer): Promise<void> {
  if (!s.registered || !s.gatewayId) {
    s.send(Gateway.encodeError(Gateway.ErrorCode.NOT_REGISTERED));
    return;
  }

  let uplink: Lora.LoraUplink;
  try {
    uplink = Lora.parseUplink(payload);
  } catch (err) {
    s.log.warn({ err }, 'bad LORA_UPLINK payload');
    return;
  }

  const macStr = Lora.macToString(uplink.mac);
  const device = await prisma.device.findUnique({ where: { bleMac: macStr } });
  if (!device) {
    s.log.warn({ mac: macStr }, 'unknown device MAC in uplink');
    return;
  }

  const eventType = uplinkStatusToEventType(uplink.status);
  const now = new Date();
  const event = await prisma.lockEvent.create({
    data: {
      deviceId: device.id,
      companyId: device.ownerCompanyId,
      eventType,
      source: 'lora',
      battery: uplink.battery,
      gatewayId: s.gatewayId,
      rawPayload: Buffer.from(payload),
      createdAt: now,
      dedupKey: `${macStr}:${eventType}:${Math.floor(now.getTime() / 5000)}`,
    },
  });

  await prisma.device.update({
    where: { id: device.id },
    data: {
      lastState: eventType === 'opened' ? 'opened' : eventType === 'closed' ? 'closed' : 'tampered',
      lastBattery: uplink.battery,
      lastSeenAt: now,
    },
  });

  // Resolve any pending command for this device whose intent matches the
  // observed state. We pick the oldest pending one within its timeout.
  const matchingCmdType =
    eventType === 'opened' ? 'unlock' : eventType === 'closed' ? 'lock' : null;
  if (matchingCmdType) {
    const pending = await prisma.deviceCommand.findFirst({
      where: {
        deviceId: device.id,
        commandType: matchingCmdType,
        status: { in: ['pending', 'sent'] },
        timeoutAt: { gt: now },
      },
      orderBy: { id: 'asc' },
    });
    if (pending) {
      await prisma.deviceCommand.update({
        where: { id: pending.id },
        data: { status: 'acked', ackedAt: now, resultEventId: event.id },
      });
    }
  }

  // ---------- Alarm rules ----------
  // 1) Tampered → critical alarm, deduped per device per minute
  if (uplink.status === Lora.LoraLockStatus.TAMPERED) {
    await raiseAlarm({
      deviceId: device.id,
      companyId: device.ownerCompanyId,
      type: 'tampered',
      severity: 'critical',
      message: `锁 ${device.lockId} 上报破拆/剪断信号`,
      triggeredEventId: event.id,
      dedupBucket: Math.floor(now.getTime() / 60_000),
    });
  }

  // 2) Low-battery rising-edge → warning. Only fire when crossing the
  //    threshold so we don't spam an alarm for every uplink at 18%.
  const wasAbove = (device.lastBattery ?? 100) >= 20;
  const nowBelow = uplink.battery < 20;
  if (wasAbove && nowBelow) {
    await raiseAlarm({
      deviceId: device.id,
      companyId: device.ownerCompanyId,
      type: 'low_battery',
      severity: uplink.battery < 10 ? 'critical' : 'warning',
      message: `锁 ${device.lockId} 电量降至 ${uplink.battery}%`,
      triggeredEventId: event.id,
      payload: { battery: uplink.battery, prev: device.lastBattery },
    });
  }

  await publishLockEvent({ eventId: event.id.toString(), deviceId: device.id.toString() });
}

/** Insert an alarm row, with optional dedup so one event doesn't spam. */
async function raiseAlarm(args: {
  deviceId: bigint;
  companyId: bigint | null;
  type: 'low_battery' | 'offline' | 'tampered' | 'command_timeout';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  triggeredEventId?: bigint;
  payload?: object;
  dedupBucket?: number;
}): Promise<void> {
  const dedupKey = args.dedupBucket
    ? `${args.deviceId}:${args.type}:${args.dedupBucket}`
    : null;

  if (dedupKey) {
    const existing = await prisma.alarm.findFirst({
      where: { dedupKey },
      select: { id: true },
    });
    if (existing) return;
  }

  await prisma.alarm.create({
    data: {
      deviceId: args.deviceId,
      companyId: args.companyId,
      type: args.type,
      severity: args.severity,
      message: args.message,
      triggeredEventId: args.triggeredEventId,
      payload: args.payload as never,
      dedupKey,
    },
  });
  // Fan out an in-app notification to the device's company (or to vendor
  // admins if the device is still vendor-owned).
  await notify({
    companyId: args.companyId,
    kind: 'alarm',
    title:
      args.severity === 'critical'
        ? '设备严重告警'
        : args.severity === 'warning'
          ? '设备告警'
          : '设备提示',
    body: args.message,
    link: '/alarms',
    payload: { deviceId: args.deviceId.toString(), type: args.type },
  });
}

function uplinkStatusToEventType(s: Lora.LoraLockStatus): 'opened' | 'closed' | 'tampered' {
  switch (s) {
    case Lora.LoraLockStatus.OPENED:
      return 'opened';
    case Lora.LoraLockStatus.CLOSED:
      return 'closed';
    case Lora.LoraLockStatus.TAMPERED:
      return 'tampered';
    default:
      return 'tampered';
  }
}
