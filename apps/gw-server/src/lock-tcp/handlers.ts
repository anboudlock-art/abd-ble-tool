import { LockTcp } from '@abd/proto';
import { prisma } from '@abd/db';
import { publishLockEvent } from '../pubsub.js';
import type { LockTcpSession } from './session.js';

/**
 * LOGIN (Sub=0x01) — first frame after TCP connect.
 *   Payload [14..19] = BLE MAC. We resolve the Device by that.
 *   Other interesting bits we don't need yet: server IP/port at [20..25].
 */
export async function handleLogin(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (frame.payload.length < 20) {
    s.log.warn({ len: frame.payload.length }, 'login payload too short');
    return;
  }
  const mac = LockTcp.macFromLoginPayload(frame.payload);
  s.bleMac = mac;
  s.lockSN = frame.lockSN;

  const device = await prisma.device.findUnique({ where: { bleMac: mac } });
  if (!device || device.deletedAt) {
    s.log.warn({ mac, lockSN: frame.lockSN }, 'login: unknown device');
    s.close('unknown device');
    return;
  }

  s.deviceId = device.id;
  s.registered = true;

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

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

  s.log.info({ mac, deviceId: device.id.toString(), lockId: device.lockId }, 'lock logged in');
}

/** HEARTBEAT (Sub=0x06) — payload is firmware version string. */
export async function handleHeartbeat(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId) return;
  s.lastHeartbeatAt = new Date();
  const fw = frame.payload.toString('ascii').replace(/\0+$/, '');
  await prisma.device.update({
    where: { id: s.deviceId },
    data: {
      lastSeenAt: s.lastHeartbeatAt,
      ...(fw && fw !== '' ? { firmwareVersion: fw } : {}),
    },
  });
}

/**
 * GPS (Sub=0x0A) — periodic location upload.
 *   [0..3]  unix timestamp
 *   [4..7]  latitude  (4-byte BCD ddmm.mmmm — big-endian per byte)
 *   [8..11] longitude (4-byte BCD dddmm.mmmm)
 *   [12]    speed
 *   [13]    flags D7=N(0)/S(1) D6=E(0)/W(1)
 *   [14..]  status + battery (model-specific)
 */
export async function handleGps(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId) return;
  if (frame.payload.length < 14) {
    s.log.warn({ len: frame.payload.length }, 'gps payload too short');
    return;
  }
  const p = frame.payload;
  const lat = bcdNmeaToDecimal(p.subarray(4, 8), (p[13]! & 0x80) !== 0);
  const lng = bcdNmeaToDecimal(p.subarray(8, 12), (p[13]! & 0x40) !== 0, true);
  // Battery is at [16] in some fw revisions; not authoritative. Best effort.
  const battery = p.length > 16 ? p[16]! : null;

  const now = new Date();
  const event = await prisma.lockEvent.create({
    data: {
      deviceId: s.deviceId,
      companyId: (await prisma.device.findUnique({ where: { id: s.deviceId } }))!.ownerCompanyId,
      eventType: 'heartbeat',
      source: 'fourg',
      battery: battery,
      lat: lat ?? null,
      lng: lng ?? null,
      rawPayload: Buffer.from(frame.payload),
      createdAt: now,
    },
  });

  await prisma.device.update({
    where: { id: s.deviceId },
    data: {
      lastSeenAt: now,
      ...(battery !== null ? { lastBattery: battery } : {}),
      ...(lat !== null && lng !== null
        ? { locationLat: lat as never, locationLng: lng as never }
        : {}),
    },
  });

  await publishLockEvent({
    eventId: event.id.toString(),
    deviceId: s.deviceId.toString(),
  });
}

/**
 * EVENT (Sub=0x2D) — seal / unseal / lock.
 *   [0]     0x2A
 *   [1]     0x55
 *   [2]     0x80=施封, 0xA0=解封, 0x62=上锁
 *   [9]     锁状态: 0x50=关 / 0x30=开
 */
export async function handleEvent(s: LockTcpSession, frame: LockTcp.Frame): Promise<void> {
  if (!s.deviceId) return;
  const p = frame.payload;
  if (p.length < 10) return;

  const cmd = p[2]!;
  const lockStateByte = p[9]!;
  const battery = p.length > 8 ? p[8]! : null;

  // Map firmware codes to our event taxonomy
  let eventType: 'opened' | 'closed' | 'tampered' = 'closed';
  let lastState: 'opened' | 'closed' | 'tampered' = 'closed';
  if (lockStateByte === 0x30) {
    eventType = 'opened';
    lastState = 'opened';
  } else if (lockStateByte === 0x50) {
    eventType = 'closed';
    lastState = 'closed';
  }
  // 0xA0 explicitly = unseal (force opened)
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
      battery: battery,
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

// ---- helpers ----

/**
 * Convert a 4-byte BCD-encoded NMEA lat/lng (ddmm.mmmm) to decimal degrees.
 * Returns null if the bytes are zero (no fix).
 */
function bcdNmeaToDecimal(bcd: Buffer, neg: boolean, isLng = false): number | null {
  if (bcd.every((b) => b === 0 || b === 0xff)) return null;
  // Each nibble 0..9
  const digits: number[] = [];
  for (const b of bcd) {
    digits.push(b >> 4, b & 0x0f);
  }
  // Build "ddmm.mmmm" (8 digits) for lat or "dddmm.mmmm" (9 digits) for lng
  const str = digits.join('');
  const expected = isLng ? 9 : 8;
  if (str.length < expected) return null;
  const padded = str.padStart(expected, '0');
  // Last 6 digits = mmmm.mm... actually ddmm.mmmm packs mm.mmmm in last 6
  const degLen = isLng ? 3 : 2;
  const deg = Number.parseInt(padded.slice(0, degLen), 10);
  const minStr = padded.slice(degLen, degLen + 2) + '.' + padded.slice(degLen + 2);
  const min = Number.parseFloat(minStr);
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  let value = deg + min / 60;
  if (neg) value = -value;
  // Sanity bounds
  if (isLng ? Math.abs(value) > 180 : Math.abs(value) > 90) return null;
  return Number(value.toFixed(7));
}
