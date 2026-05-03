import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '@abd/db';
import { resetDb, seedBasicUsers, login, bearer } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  // Sandbox uploads to a tmp dir under the test process so we don't
  // pollute /var/abd/uploads.
  process.env.UPLOAD_DIR ??= '/tmp/abd-test-uploads';
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
});

async function seedBleDeviceWithGrant(opts: {
  companyId: bigint;
  ownerUserId: bigint;
  lockId?: string;
  mac?: string;
}) {
  // BLE-only seal model
  const model = await prisma.deviceModel.create({
    data: {
      code: 'ESEAL-V28',
      name: 'V2.8 eseal',
      category: 'eseal',
      scene: 'logistics',
      hasBle: true,
      has4g: false,
      hasGps: false,
      hasLora: false,
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: opts.lockId ?? '60500300',
      bleMac: opts.mac ?? 'AA:BB:CC:DD:EE:30',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: opts.companyId,
    },
  });
  await prisma.deviceAssignment.create({
    data: {
      deviceId: dev.id,
      companyId: opts.companyId,
      scope: 'user',
      userId: opts.ownerUserId,
    },
  });
  return { model, dev };
}

// ============ link='ble' precheck ============

test('link=ble: company_admin issues, gets commandId + expectedCmdId 1-255, no downlink', async () => {
  const u = await seedBasicUsers();
  const { dev } = await seedBleDeviceWithGrant({
    companyId: u.companyId,
    ownerUserId: u.companyAdminId,
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: {
      commandType: 'unlock',
      link: 'ble',
      phoneLat: 23.1273,
      phoneLng: 113.3528,
      phoneAccuracyM: 5,
    },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.link, 'ble');
  assert.equal(body.bleMac, 'AA:BB:CC:DD:EE:30');
  assert.ok(body.expectedCmdId >= 1 && body.expectedCmdId <= 255);
  assert.ok(body.commandId);

  // No downlink path for BLE: requestPayload should be null on the row
  const row = await prisma.deviceCommand.findUnique({
    where: { id: BigInt(body.commandId) },
  });
  assert.equal(row?.link, 'ble');
  assert.equal(row?.requestPayload, null);
  assert.equal(row?.phoneLat?.toString(), '23.1273');
});

test('link=ble: member with no grant gets 403', async () => {
  const u = await seedBasicUsers();
  const memberPw = 'm-pass';
  const member = await prisma.user.create({
    data: {
      phone: '13900000099',
      name: 'M',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(memberPw, 4),
    },
  });
  // Seed a device but DON'T grant it to the member
  const model = await prisma.deviceModel.create({
    data: {
      code: 'ESEAL-V28b',
      name: 'eseal b',
      category: 'eseal',
      scene: 'logistics',
      hasBle: true,
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60500301',
      bleMac: 'AA:BB:CC:DD:EE:31',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  void member;

  const token = await login(app, '13900000099', memberPw);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: { commandType: 'unlock', link: 'ble' },
  });
  assert.equal(res.statusCode, 403);
});

test('link=ble: device without BLE capability returns 405', async () => {
  const u = await seedBasicUsers();
  // 4G-only device, no BLE
  const model = await prisma.deviceModel.create({
    data: {
      code: 'NOBLE',
      name: 'no ble',
      category: 'gps_lock',
      scene: 'security',
      hasBle: false,
      has4g: true,
      hasGps: true,
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60500302',
      bleMac: 'AA:BB:CC:DD:EE:32',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: { commandType: 'unlock', link: 'ble' },
  });
  assert.equal(res.statusCode, 405);
});

// ============ /ack endpoint ============

test('ack: success flips status, writes lock_event(source=ble), updates device.lastState', async () => {
  const u = await seedBasicUsers();
  const { dev } = await seedBleDeviceWithGrant({
    companyId: u.companyId,
    ownerUserId: u.companyAdminId,
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const create = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: { commandType: 'unlock', link: 'ble' },
  });
  const commandId = JSON.parse(create.body).commandId;

  const ack = await app.inject({
    method: 'POST',
    url: `/api/v1/device-commands/${commandId}/ack`,
    headers: bearer(token),
    payload: {
      ok: true,
      occurredAt: new Date().toISOString(),
      phoneLat: 23.13,
      phoneLng: 113.35,
      phoneAccuracyM: 8,
    },
  });
  assert.equal(ack.statusCode, 200);
  const cmd = await prisma.deviceCommand.findUnique({
    where: { id: BigInt(commandId) },
  });
  assert.equal(cmd?.status, 'acked');
  assert.equal(cmd?.ackPhoneLat?.toString(), '23.13');
  assert.ok(cmd?.resultEventId);

  const ev = await prisma.lockEvent.findUnique({ where: { id: cmd!.resultEventId! } });
  assert.equal(ev?.source, 'ble');
  assert.equal(ev?.eventType, 'opened');

  const reload = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.equal(reload?.lastState, 'opened');
});

test('ack: failure path sets status=failed, no lock_event written', async () => {
  const u = await seedBasicUsers();
  const { dev } = await seedBleDeviceWithGrant({
    companyId: u.companyId,
    ownerUserId: u.companyAdminId,
    lockId: '60500305',
    mac: 'AA:BB:CC:DD:EE:35',
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const create = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: { commandType: 'unlock', link: 'ble' },
  });
  const commandId = JSON.parse(create.body).commandId;
  await app.inject({
    method: 'POST',
    url: `/api/v1/device-commands/${commandId}/ack`,
    headers: bearer(token),
    payload: {
      ok: false,
      errorMessage: 'BLE write timeout',
      occurredAt: new Date().toISOString(),
    },
  });
  const cmd = await prisma.deviceCommand.findUnique({
    where: { id: BigInt(commandId) },
  });
  assert.equal(cmd?.status, 'failed');
  assert.equal(cmd?.errorMessage, 'BLE write timeout');
  assert.equal(cmd?.resultEventId, null);
  // Device.lastState NOT touched
  const reload = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.equal(reload?.lastState, 'unknown');
});

test('ack: only the original requester (or admin) can ack a member-issued command', async () => {
  const u = await seedBasicUsers();
  const memberAPw = 'a-pass';
  const memberA = await prisma.user.create({
    data: {
      phone: '13900000088',
      name: 'A',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(memberAPw, 4),
    },
  });
  const memberBPw = 'b-pass';
  await prisma.user.create({
    data: {
      phone: '13900000089',
      name: 'B',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(memberBPw, 4),
    },
  });
  const { dev } = await seedBleDeviceWithGrant({
    companyId: u.companyId,
    ownerUserId: memberA.id,
    lockId: '60500306',
    mac: 'AA:BB:CC:DD:EE:36',
  });
  const tokenA = await login(app, '13900000088', memberAPw);
  const create = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(tokenA),
    payload: { commandType: 'unlock', link: 'ble' },
  });
  const commandId = JSON.parse(create.body).commandId;

  // B tries to ack — must be 403
  const tokenB = await login(app, '13900000089', memberBPw);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/device-commands/${commandId}/ack`,
    headers: bearer(tokenB),
    payload: { ok: true, occurredAt: new Date().toISOString() },
  });
  assert.equal(res.statusCode, 403);
});

// ============ occurredAt clamp ============

test('occurredAt > now+60s rejected with 400', async () => {
  const u = await seedBasicUsers();
  const { dev } = await seedBleDeviceWithGrant({
    companyId: u.companyId,
    ownerUserId: u.companyAdminId,
    lockId: '60500310',
    mac: 'AA:BB:CC:DD:EE:40',
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const future = new Date(Date.now() + 5 * 60_000).toISOString();
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: { commandType: 'unlock', link: 'ble', occurredAt: future },
  });
  assert.equal(res.statusCode, 400);
});

test('occurredAt > 7d ago is clamped to now() with serverNote', async () => {
  const u = await seedBasicUsers();
  const { dev } = await seedBleDeviceWithGrant({
    companyId: u.companyId,
    ownerUserId: u.companyAdminId,
    lockId: '60500311',
    mac: 'AA:BB:CC:DD:EE:41',
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const ancient = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(token),
    payload: { commandType: 'unlock', link: 'ble', occurredAt: ancient },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.match(body.serverNote ?? '', /clamped/);

  const cmd = await prisma.deviceCommand.findUnique({
    where: { id: BigInt(body.commandId) },
  });
  assert.ok(cmd?.occurredAt);
  // The DB value should be now-ish, not the 30-day-old timestamp.
  assert.ok(Math.abs(cmd!.occurredAt!.getTime() - Date.now()) < 10_000);
});

// ============ /users/me/devices model + gatewayOnline ============

test('/users/me/devices returns model capabilities + gatewayOnline', async () => {
  const u = await seedBasicUsers();
  const gw = await prisma.gateway.create({
    data: {
      gwId: 'GW001234',
      token: 'TOKEN_TEST_1234',
      companyId: u.companyId,
      online: true,
    },
  });
  const model = await prisma.deviceModel.create({
    data: {
      code: 'PADLOCK-V28',
      name: 'V2.8 padlock',
      category: 'fourg_padlock',
      scene: 'security',
      hasBle: true,
      has4g: true,
      hasGps: true,
      hasLora: true,
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60500320',
      bleMac: 'AA:BB:CC:DD:EE:50',
      modelId: model.id,
      gatewayId: gw.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  await prisma.deviceAssignment.create({
    data: {
      deviceId: dev.id,
      companyId: u.companyId,
      scope: 'user',
      userId: u.companyAdminId,
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me/devices',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const items = JSON.parse(res.body).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].model.code, 'PADLOCK-V28');
  assert.equal(items[0].model.hasBle, true);
  assert.equal(items[0].model.hasLora, true);
  assert.equal(items[0].gatewayOnline, true);
});

// ============ /uploads ============

test('/uploads accepts a JPEG, returns url + sizeBytes + mimeType', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000003', u.companyAdminPassword);

  // Smallest valid JPEG (a 1×1 white pixel) — 125 bytes-ish
  const jpegBytes = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAH4//9k=',
    'base64',
  );

  // Build a multipart body manually so we don't need a helper lib
  const boundary = '----test-boundary-' + Math.random();
  const lines = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="test.jpg"',
    'Content-Type: image/jpeg',
    '',
  ].join('\r\n');
  const body = Buffer.concat([
    Buffer.from(lines + '\r\n'),
    jpegBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads',
    headers: {
      ...bearer(token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
  assert.equal(res.statusCode, 201);
  const json = JSON.parse(res.body);
  assert.match(json.url, /^\/uploads\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.jpg$/);
  assert.equal(json.mimeType, 'image/jpeg');
  assert.equal(json.sizeBytes, jpegBytes.length);

  // The static plugin should serve it back at the same URL
  const fetchBack = await app.inject({ method: 'GET', url: json.url });
  assert.equal(fetchBack.statusCode, 200);
  assert.equal(fetchBack.rawPayload.length, jpegBytes.length);
});

test('/uploads rejects unsupported MIME types', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const boundary = '----test-boundary-mime';
  const body = Buffer.concat([
    Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="x.exe"',
        'Content-Type: application/x-msdownload',
        '',
        'MZ\x90\x00',
      ].join('\r\n') + '\r\n',
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/uploads',
    headers: {
      ...bearer(token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
  assert.equal(res.statusCode, 400);
});
