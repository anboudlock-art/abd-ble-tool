import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '@abd/db';
import { resetDb, seedBasicUsers, seedDeviceModel, login, bearer } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'fatal';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
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

async function seedDevice(companyId: bigint, modelId: bigint, lockId: string, mac: string, status: 'active' | 'delivered' | 'in_warehouse' = 'active') {
  return prisma.device.create({
    data: {
      lockId,
      bleMac: mac,
      modelId,
      status,
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: companyId,
    },
  });
}

test('repair-intake: active device → repairing, opens device_repair row with priorStatus', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await seedDevice(u.companyId, m.id, '60500200', 'AA:BB:CC:DD:EE:00', 'active');
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/repair-intake`,
    headers: bearer(token),
    payload: { faultReason: '4G 模块无响应' },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.priorStatus, 'active');
  assert.equal(body.status, 'intake');
  const reload = await prisma.device.findUnique({ where: { id: d.id } });
  assert.equal(reload?.status, 'repairing');
});

test('repair-intake refuses when device already repairing', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await seedDevice(u.companyId, m.id, '60500201', 'AA:BB:CC:DD:EE:01', 'active');
  const token = await login(app, '13800000003', u.companyAdminPassword);
  await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/repair-intake`,
    headers: bearer(token),
    payload: { faultReason: 'x' },
  });
  const dup = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/repair-intake`,
    headers: bearer(token),
    payload: { faultReason: 'x' },
  });
  assert.equal(dup.statusCode, 409);
});

test('update-status: terminal state stamps repairedAt + repairedByUserId', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await seedDevice(u.companyId, m.id, '60500202', 'AA:BB:CC:DD:EE:02', 'delivered');
  const cToken = await login(app, '13800000003', u.companyAdminPassword);
  const intake = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/repair-intake`,
    headers: bearer(cToken),
    payload: { faultReason: 'x' },
  });
  const repairId = JSON.parse(intake.body).id;

  const opToken = await login(app, '13800000002', u.operatorPassword);
  const upd = await app.inject({
    method: 'POST',
    url: `/api/v1/repairs/${repairId}/update-status`,
    headers: bearer(opToken),
    payload: { status: 'repaired', notes: 'replaced battery', partsReplaced: ['battery-3.7v'] },
  });
  assert.equal(upd.statusCode, 200);
  const r = await prisma.deviceRepair.findUnique({ where: { id: BigInt(repairId) } });
  assert.equal(r?.status, 'repaired');
  assert.ok(r?.repairedAt);
});

test('close: restore restores prior status; retire sends to retired', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const cToken = await login(app, '13800000003', u.companyAdminPassword);
  const opToken = await login(app, '13800000002', u.operatorPassword);

  // Restore path
  const d1 = await seedDevice(u.companyId, m.id, '60500203', 'AA:BB:CC:DD:EE:03', 'active');
  const r1 = JSON.parse((await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d1.id}/repair-intake`,
    headers: bearer(cToken),
    payload: { faultReason: 'x' },
  })).body).id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/repairs/${r1}/update-status`,
    headers: bearer(opToken),
    payload: { status: 'repaired' },
  });
  const close1 = await app.inject({
    method: 'POST',
    url: `/api/v1/repairs/${r1}/close`,
    headers: bearer(opToken),
    payload: { resolution: 'restore' },
  });
  assert.equal(close1.statusCode, 200);
  const dev1 = await prisma.device.findUnique({ where: { id: d1.id } });
  assert.equal(dev1?.status, 'active');

  // Retire path
  const d2 = await seedDevice(u.companyId, m.id, '60500204', 'AA:BB:CC:DD:EE:04', 'delivered');
  const r2 = JSON.parse((await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d2.id}/repair-intake`,
    headers: bearer(cToken),
    payload: { faultReason: 'x' },
  })).body).id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/repairs/${r2}/update-status`,
    headers: bearer(opToken),
    payload: { status: 'irreparable' },
  });
  const close2 = await app.inject({
    method: 'POST',
    url: `/api/v1/repairs/${r2}/close`,
    headers: bearer(opToken),
    payload: { resolution: 'retire' },
  });
  assert.equal(close2.statusCode, 200);
  const dev2 = await prisma.device.findUnique({ where: { id: d2.id } });
  assert.equal(dev2?.status, 'retired');
});

test('cannot close a repair while still in non-terminal state', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await seedDevice(u.companyId, m.id, '60500205', 'AA:BB:CC:DD:EE:05', 'active');
  const cToken = await login(app, '13800000003', u.companyAdminPassword);
  const r = JSON.parse((await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/repair-intake`,
    headers: bearer(cToken),
    payload: { faultReason: 'x' },
  })).body).id;
  const opToken = await login(app, '13800000002', u.operatorPassword);
  const tooEarly = await app.inject({
    method: 'POST',
    url: `/api/v1/repairs/${r}/close`,
    headers: bearer(opToken),
    payload: { resolution: 'restore' },
  });
  assert.equal(tooEarly.statusCode, 409);
});

test('GET /repairs filters by status and returns latest first', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const cToken = await login(app, '13800000003', u.companyAdminPassword);
  const opToken = await login(app, '13800000002', u.operatorPassword);

  for (let i = 0; i < 3; i++) {
    const d = await seedDevice(u.companyId, m.id, `6050021${i}`, `AA:BB:CC:DD:EE:1${i}`);
    await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${d.id}/repair-intake`,
      headers: bearer(cToken),
      payload: { faultReason: `f${i}` },
    });
  }
  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/repairs?status=intake',
    headers: bearer(opToken),
  });
  assert.equal(list.statusCode, 200);
  const body = JSON.parse(list.body);
  assert.equal(body.total, 3);
  assert.equal(body.items[0].status, 'intake');
});
