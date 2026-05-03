import { LockTcp } from '@abd/proto';
import { prisma } from '@abd/db';
import { publishLockEvent } from '../pubsub.js';
import type { LockTcpSession } from './session.js';

/**
 * v2.8 task 1: LOGIN binding.
 *
 * Until 2026-05 we matched only by BLE MAC, which broke the moment a
 * lock from the old platform reconnected before its MAC had been
 * registered in our `device.ble_mac` column. Spec rewrite (CLAUDE_FIX_GW_LOGIN):
 *
 *   1. lookup by lockId (= str(frame.lockSN))      ← preferred
 *   2. lookup by ble_mac (legacy fallback)
 *   3. neither → close as unknown
 *
 * After matching:
 *   - auto-update device.bleMac if the lock reports a different one
 *     (covers MAC changes after a reflash)
 *   - extract IMSI from payload[26..40] → device.iccid (autofill)
 *   - bump last_seen_at + write a lock_event(type='online', source='fourg')
 */
export async function handleLogin(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (frame.payload.length < 20) {
    s.log.warn({ len: frame.payload.length }, 'login payload too short');
    return;
  }
  const reportedMac = LockTcp.macFromLoginPayload(frame.payload);
  const reportedImsi = LockTcp.imsiFromLoginPayload(frame.payload);
  s.bleMac = reportedMac;
  s.lockSN = frame.lockSN;

  // SN-first; MAC-fallback so old-platform locks with a known MAC but
  // no lockId yet still get matched (e.g. devices migrated by export
  // before SN was filled in).
  const lockIdStr = String(frame.lockSN);
  let device = await prisma.device.findUnique({ where: { lockId: lockIdStr } });
  let matchedBy: 'sn' | 'mac' = 'sn';
  if (!device || device.deletedAt) {
    device = await prisma.device.findUnique({ where: { bleMac: reportedMac } });
    matchedBy = 'mac';
  }
  if (!device || device.deletedAt) {
    s.log.warn(
      { mac: reportedMac, lockSN: frame.lockSN },
      'login: unknown device (neither lockId nor bleMac matched)',
    );
    s.close('unknown device');
    return;
  }

  s.deviceId = device.id;
  s.registered = true;

  // If we matched by SN but the lock is reporting a different MAC than
  // what's in the DB, trust the lock — it's the source of truth for
  // its own hardware. Same for IMSI: only fill if currently null,
  // since manually-edited iccid wins.
  const updates: {
    lastSeenAt: Date;
    bleMac?: string;
    iccid?: string;
  } = { lastSeenAt: new Date() };
  if (matchedBy === 'sn' && device.bleMac !== reportedMac) {
    // Make sure the new MAC isn't already taken by a different device.
    const macClash = await prisma.device.findUnique({ where: { bleMac: reportedMac } });
    if (macClash && macClash.id !== device.id) {
      s.log.warn(
        { from: device.bleMac, to: reportedMac, clashId: macClash.id.toString() },
        'login: cannot auto-update bleMac (clashes with another device)',
      );
    } else {
      updates.bleMac = reportedMac;
      s.log.info({ from: device.bleMac, to: reportedMac }, 'login: auto-updated bleMac');
    }
  }
  if (reportedImsi && !device.iccid) {
    updates.iccid = reportedImsi;
    s.log.info({ iccid: reportedImsi }, 'login: filled iccid from IMSI');
  }
  await prisma.device.update({ where: { id: device.id }, data: updates });

  await prisma.lockEvent.create({
    data: {
      deviceId: device.id,
      companyId: device.ownerCompanyId,
      eventType: 'online',
      source: 'fourg',
      rawPayload: Buffer.from(frame.payload),
      createdAt: new Date(),
    },
  });

  s.log.info(
    {
      mac: reportedMac,
      lockSN: frame.lockSN,
      deviceId: device.id.toString(),
      lockId: device.lockId,
      matchedBy,
    },
    'lock logged in',
  );
}

/**
 * v2.8 task 2: HEARTBEAT (Sub=0x06) — payload is firmware version
 * string. After updating the row we MUST send a 0x21 0x10 time-sync
 * frame back; without it the firmware times out at 30 s and reconnects.
 */
export async function handleHeartbeat(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId || s.lockSN == null) return;
  s.lastHeartbeatAt = new Date();
  const fw = frame.payload.toString('ascii').replace(/\0+$/, '').replace(/[^\x20-\x7e]/g, '');
  await prisma.device.update({
    where: { id: s.deviceId },
    data: {
      lastSeenAt: s.lastHeartbeatAt,
      ...(fw && fw !== '' ? { firmwareVersion: fw } : {}),
    },
  });
  // Also surface heartbeats in the event log so the operator can see
  // the connection is live (we keep these out of the alarm path).
  await prisma.lockEvent
    .create({
      data: {
        deviceId: s.deviceId,
        companyId: null, // backfilled by query joins; saves a fetch here
        eventType: 'heartbeat',
        source: 'fourg',
        rawPayload: Buffer.from(frame.payload),
        createdAt: s.lastHeartbeatAt,
      },
    })
    .catch((err: unknown) => s.log.warn({ err }, 'heartbeat event write failed'));

  // Time-sync downlink. Errors here MUST NOT break the heartbeat
  // bookkeeping (we still want lastSeenAt updated even if the socket
  // is half-closed).
  try {
    const downlink = LockTcp.encodeTimeSync(s.lockSN);
    s.send(downlink);
    s.log.debug({ bytes: downlink.length }, 'time-sync sent');
  } catch (err) {
    s.log.warn({ err }, 'failed to send time-sync downlink');
  }
}

/**
 * v2.8 task 3: GPS (Sub=0x0A) — periodic location upload. The payload
 * starts with the 26-byte GPS block documented in protocol §3.2.3,
 * optionally followed by a 10-byte base-station block we ignore.
 *
 * We trust:
 *   - alarms[2] (A2) as battery percent
 *   - alarms[3] (A3) as the mapped lock-state code (one of LockStatus)
 */
export async function handleGps(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId) return;
  const gps = LockTcp.parseGpsBlock(frame.payload);
  if (!gps) {
    s.log.warn({ len: frame.payload.length }, 'gps payload too short');
    return;
  }
  const battery = LockTcp.batteryFromGps(gps);
  const status = LockTcp.lockStatusFromGps(gps);

  const now = new Date();
  const device = await prisma.device.findUnique({
    where: { id: s.deviceId },
    select: { ownerCompanyId: true },
  });
  const event = await prisma.lockEvent.create({
    data: {
      deviceId: s.deviceId,
      companyId: device?.ownerCompanyId ?? null,
      // `gps` isn't a separate event type in our enum (lockEventType is
      // opened/closed/tampered/heartbeat/...), so we surface GPS
      // updates as 'heartbeat' — they're the most-frequent ambient
      // signal and the UI groups them the same way.
      eventType: 'heartbeat',
      source: 'fourg',
      battery,
      lat: gps.lat ?? null,
      lng: gps.lng ?? null,
      rawPayload: Buffer.from(frame.payload),
      createdAt: now,
    },
  });

  // Map 4GBLE093 LockStatus → our LockState enum. opened/closed/tampered
  // are the three values stored on Device.lastState.
  const lastState = mapLockStatusToState(status);

  await prisma.device.update({
    where: { id: s.deviceId },
    data: {
      lastSeenAt: now,
      ...(battery !== null ? { lastBattery: battery } : {}),
      ...(gps.lat !== null && gps.lng !== null
        ? { locationLat: gps.lat as never, locationLng: gps.lng as never }
        : {}),
      ...(lastState ? { lastState } : {}),
    },
  });

  await publishLockEvent({
    eventId: event.id.toString(),
    deviceId: s.deviceId.toString(),
  });
}

/**
 * EVENT (Sub=0x2D) — seal / unseal / lock or status-query response.
 *
 * Two body shapes share this Sub code:
 *   - lock event report:           [0x2A][0x55][cmd][...][9]=lockState
 *   - status-query response:       [0x2A][0x55][0x12]+...+26B GPS+10B base
 *
 * We sniff by the third byte (cmd / func): if it's 0x12 (or 0x13/0x14
 * — read-only queries) we run the structured parser; otherwise we
 * stick to the lightweight cmd/state inference the firmware uses for
 * spontaneous events.
 */
export async function handleEvent(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId) return;
  const p = frame.payload;
  if (p.length < 10) return;

  // Status-query response has the parsable structured body.
  if (p[2] === 0x12) {
    const parsed = LockTcp.parseStatusResponse(p);
    if (parsed) {
      await applyStatusResponse(s, frame, parsed);
      return;
    }
  }

  const cmd = p[2]!;
  const lockStateByte = p[9]!;
  const battery = p.length > 8 ? p[8]! : null;

  let eventType: 'opened' | 'closed' | 'tampered' = 'closed';
  let lastState: 'opened' | 'closed' | 'tampered' = 'closed';
  if (lockStateByte === 0x30) {
    eventType = 'opened';
    lastState = 'opened';
  } else if (lockStateByte === 0x50) {
    eventType = 'closed';
    lastState = 'closed';
  }
  // 0xA0 = 解封 = open
  if (cmd === 0xa0) {
    eventType = 'opened';
    lastState = 'opened';
  }

  const now = new Date();
  const device = (await prisma.device.findUnique({ where: { id: s.deviceId } }))!;

  const event = await prisma.lockEvent.create({
    data: {
      deviceId: s.deviceId,
      companyId: device.ownerCompanyId,
      eventType,
      source: 'fourg',
      battery,
      rawPayload: Buffer.from(frame.payload),
      createdAt: now,
    },
  });

  await prisma.device.update({
    where: { id: s.deviceId },
    data: {
      lastState,
      lastSeenAt: now,
      ...(battery !== null ? { lastBattery: battery } : {}),
    },
  });

  // Resolve any pending command whose intent matches
  const intent = lastState === 'opened' ? 'unlock' : 'lock';
  const pending = await prisma.deviceCommand.findFirst({
    where: {
      deviceId: s.deviceId,
      commandType: intent,
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

  await publishLockEvent({
    eventId: event.id.toString(),
    deviceId: s.deviceId.toString(),
  });
}

/**
 * v2.8 task 4: apply a parsed status-query response. Updates
 * device.lastState + GPS + battery and resolves any pending
 * query_status command via the report serial echo.
 */
async function applyStatusResponse(
  s: LockTcpSession,
  frame: LockTcp.Frame,
  parsed: LockTcp.LockStatusResponse,
): Promise<void> {
  if (!s.deviceId) return;
  const now = new Date();
  const device = (await prisma.device.findUnique({ where: { id: s.deviceId } }))!;

  const battery = parsed.gps ? LockTcp.batteryFromGps(parsed.gps) : null;
  const lastState = mapLockStatusToState(parsed.lockState);

  const event = await prisma.lockEvent.create({
    data: {
      deviceId: s.deviceId,
      companyId: device.ownerCompanyId,
      eventType: lastState ?? 'heartbeat',
      source: 'fourg',
      battery,
      lat: parsed.gps?.lat ?? null,
      lng: parsed.gps?.lng ?? null,
      rawPayload: Buffer.from(frame.payload),
      createdAt: now,
    },
  });

  await prisma.device.update({
    where: { id: s.deviceId },
    data: {
      lastSeenAt: now,
      ...(battery !== null ? { lastBattery: battery } : {}),
      ...(parsed.gps?.lat != null && parsed.gps?.lng != null
        ? { locationLat: parsed.gps.lat as never, locationLng: parsed.gps.lng as never }
        : {}),
      ...(lastState ? { lastState } : {}),
    },
  });

  // Resolve the pending query_status command that triggered this
  // response. The report serial echo lets us match the exact request.
  const pending = await prisma.deviceCommand.findFirst({
    where: {
      deviceId: s.deviceId,
      commandType: 'query_status',
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

  await publishLockEvent({
    eventId: event.id.toString(),
    deviceId: s.deviceId.toString(),
  });
}

/** Translate the firmware's LockStatus into our coarser LockState
 *  (opened / closed / tampered / null = leave unchanged). */
function mapLockStatusToState(
  s: LockTcp.LockStatusValue | null,
): 'opened' | 'closed' | 'tampered' | null {
  if (s == null) return null;
  switch (s) {
    case LockTcp.LockStatus.OPENED:
    case LockTcp.LockStatus.HALF_LOCKED:
    case LockTcp.LockStatus.UNSEALED:
      return 'opened';
    case LockTcp.LockStatus.SEALED:
    case LockTcp.LockStatus.LOCKED:
      return 'closed';
    case LockTcp.LockStatus.CUT_ALARM:
      return 'tampered';
    default:
      return null;
  }
}

/**
 * ACK (Sub=0x16) — firmware echoes back the report_serial we sent in the
 * downlink. We don't strictly need this since we already mark commands
 * 'acked' on the lock state event, but it's a nice "command was received"
 * signal for non-state-changing requests.
 */
export async function handleAck(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId) return;
  const p = frame.payload;
  if (p.length < 3) return;
  // payload[1..2] = report_serial (LE)
  const serial = p.readUInt16LE(1);
  s.log.debug({ serial }, 'lock ACK received');
}
