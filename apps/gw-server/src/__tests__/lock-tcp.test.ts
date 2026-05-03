import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import pino from 'pino';
import { LockTcp } from '@abd/proto';
import { prisma } from '@abd/db';
import { buildLockTcpServer } from '../lock-tcp/server.js';

async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      alarm,
      device_command,
      lock_event,
      device,
      device_model,
      company
    RESTART IDENTITY CASCADE
  `);
}

async function seedDeviceModel() {
  return prisma.deviceModel.create({
    data: {
      code: 'GPS-LT-T',
      name: 'Test',
      category: 'gps_lock',
      scene: 'logistics',
      hasBle: true,
      has4g: true,
      hasGps: true,
    },
  });
}

let server: net.Server;
let port: number;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.LOCK_TCP_DISABLE_DOWNLINK = '1';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.DATABASE_URL ??= 'postgresql://abd:abd_dev_password@localhost:5432/abd';
  process.env.LOCK_TCP_PORT ??= '0'; // ephemeral; we override at listen()

  const log = pino({ level: 'fatal' });
  server = buildLockTcpServer(log);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  // Force exit — node:test sometimes lingers on file/socket handles in
  // test environments. We've cleaned up everything we own; just leave.
  setTimeout(() => process.exit(0), 50).unref();
});

beforeEach(async () => {
  await resetDb();
});

interface TestLock {
  socket: net.Socket;
  send(buf: Buffer): Promise<void>;
  close(): Promise<void>;
}

async function connectLock(): Promise<TestLock> {
  const socket = net.connect({ host: '127.0.0.1', port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    send: (buf) =>
      new Promise<void>((resolve, reject) =>
        socket.write(buf, (err) => (err ? reject(err) : resolve())),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        socket.end(() => resolve());
      }),
  };
}

function buildLogin(lockSN: number, mac: string): Buffer {
  const macBytes = Buffer.from(mac.replace(/:/g, ''), 'hex');
  // GPS section (14B) + MAC (6B) + server IP (4B) + port (2B) = 26B
  const payload = Buffer.alloc(26, 0);
  macBytes.copy(payload, 14);
  return LockTcp.encodeFrame({
    lockSN,
    addr: 0x07,
    sub: LockTcp.Sub.LOGIN,
    subLen: 0,
    payload,
  });
}

function buildHeartbeat(lockSN: number, fwVer: string): Buffer {
  return LockTcp.encodeFrame({
    lockSN,
    addr: 0x05,
    sub: LockTcp.Sub.HEARTBEAT,
    subLen: 0,
    payload: Buffer.from(fwVer, 'ascii'),
  });
}

function buildEvent(
  lockSN: number,
  cmd: 0x80 | 0xa0 | 0x62,
  lockState: 0x30 | 0x50,
): Buffer {
  // 30-byte payload skeleton — handlers only inspect [0..2] and [9].
  const payload = Buffer.alloc(30, 0);
  payload[0] = 0x2a;
  payload[1] = 0x55;
  payload[2] = cmd;
  // LockID at [3..6] (LE) — not strictly needed for handler logic
  payload.writeUInt32LE(lockSN >>> 0, 3);
  payload[8] = 80; // battery 80%
  payload[9] = lockState;
  return LockTcp.encodeFrame({
    lockSN,
    addr: 0x03,
    sub: LockTcp.Sub.EVENT,
    subLen: 0x04,
    payload,
  });
}

test('login → device registered + online event written', async () => {
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806001',
      bleMac: 'AA:BB:CC:DD:EE:01',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });

  const lock = await connectLock();
  await lock.send(buildLogin(60806001, 'AA:BB:CC:DD:EE:01'));
  await wait(150);

  const updated = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.ok(updated!.lastSeenAt);

  const events = await prisma.lockEvent.findMany({
    where: { deviceId: dev.id, eventType: 'online' },
  });
  assert.equal(events.length, 1);
  await lock.close();
});

test('login with unknown MAC closes the connection', async () => {
  const lock = await connectLock();
  await lock.send(buildLogin(99999999, 'DE:AD:BE:EF:00:00'));
  // The handler issues socket.destroy(); wait for end
  await new Promise<void>((resolve) => {
    lock.socket.once('close', () => resolve());
    setTimeout(resolve, 500);
  });
  assert.equal(lock.socket.destroyed, true);
});

test('heartbeat updates firmware version + lastSeenAt', async () => {
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806002',
      bleMac: 'AA:BB:CC:DD:EE:02',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });
  const lock = await connectLock();
  await lock.send(buildLogin(60806002, 'AA:BB:CC:DD:EE:02'));
  await wait(120);
  await lock.send(buildHeartbeat(60806002, 'V11.3'));
  await wait(120);

  const updated = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.equal(updated!.firmwareVersion, 'V11.3');
  await lock.close();
});

test('event 0x2D opened resolves a pending unlock command', async () => {
  const model = await prisma.deviceModel.create({
    data: {
      code: 'GPS-4G-T',
      name: 'GPS 4G',
      category: 'gps_lock',
      scene: 'logistics',
      hasBle: true,
      has4g: true,
      hasGps: true,
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60806003',
      bleMac: 'AA:BB:CC:DD:EE:03',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });

  // Simulate a pending command
  const cmd = await prisma.deviceCommand.create({
    data: {
      deviceId: dev.id,
      commandType: 'unlock',
      issuedByUserId: null,
      source: 'web',
      status: 'sent',
      sentAt: new Date(),
      timeoutAt: new Date(Date.now() + 30_000),
    },
  });

  const lock = await connectLock();
  await lock.send(buildLogin(60806003, 'AA:BB:CC:DD:EE:03'));
  await wait(150);
  await lock.send(buildEvent(60806003, 0xa0, 0x30)); // unseal → opened
  await wait(200);

  const reload = await prisma.deviceCommand.findUnique({ where: { id: cmd.id } });
  assert.equal(reload!.status, 'acked');
  assert.ok(reload!.ackedAt);

  const reloadDev = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.equal(reloadDev!.lastState, 'opened');
  await lock.close();
});

test('garbage-then-frame: parser resyncs', async () => {
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806004',
      bleMac: 'AA:BB:CC:DD:EE:04',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });
  const lock = await connectLock();
  // Send some garbage first then a valid login frame
  await lock.send(Buffer.from([0x00, 0x11, 0x22]));
  await lock.send(buildLogin(60806004, 'AA:BB:CC:DD:EE:04'));
  await wait(150);

  const updated = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.ok(updated!.lastSeenAt);
  await lock.close();
});
