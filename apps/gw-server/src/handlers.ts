import { Gateway, Lora } from '@abd/proto';
import { prisma } from '@abd/db';
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

  await publishLockEvent({ eventId: event.id.toString(), deviceId: device.id.toString() });
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
