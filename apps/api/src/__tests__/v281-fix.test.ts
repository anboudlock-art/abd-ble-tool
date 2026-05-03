import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
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

// ========== Task 1: PUT /users/:id role + scope guard ==========

test('PUT /users/:id: company_admin cannot promote anyone to vendor_admin', async () => {
  const u = await seedBasicUsers();
  const target = await prisma.user.create({
    data: {
      phone: '13900001111',
      name: 'Tgt',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('x', 4),
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${target.id}`,
    headers: bearer(token),
    payload: { role: 'vendor_admin' },
  });
  assert.equal(res.statusCode, 403);
});

test('PUT /users/:id: company_admin can change role to dept_admin', async () => {
  const u = await seedBasicUsers();
  const target = await prisma.user.create({
    data: {
      phone: '13900001112',
      name: 'Tgt',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('x', 4),
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${target.id}`,
    headers: bearer(token),
    payload: { role: 'dept_admin' },
  });
  assert.equal(res.statusCode, 200);
  const reload = await prisma.user.findUnique({ where: { id: target.id } });
  assert.equal(reload?.role, 'dept_admin');
});

test('PUT /users/:id: vendor_admin can promote across company', async () => {
  const u = await seedBasicUsers();
  const target = await prisma.user.create({
    data: {
      phone: '13900001113',
      name: 'Tgt',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('x', 4),
    },
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${target.id}`,
    headers: bearer(token),
    payload: { role: 'company_admin' },
  });
  assert.equal(res.statusCode, 200);
});

// ========== Task 6: fault categories + repair-intake ==========

test('GET /fault-categories returns the seeded list (active only)', async () => {
  const u = await seedBasicUsers();
  // Seed two categories — one active, one disabled
  await prisma.faultCategory.createMany({
    data: [
      { label: '无法开锁', displayOrder: 10, isActive: true },
      { label: '已弃用', displayOrder: 999, isActive: false },
    ],
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/fault-categories',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].label, '无法开锁');
});

test('POST /devices/:id/repair-intake with faultCategoryId copies label to faultReason', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60500200',
      bleMac: 'AA:BB:CC:DD:EE:00',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const cat = await prisma.faultCategory.create({
    data: { label: '电池不充电', displayOrder: 30 },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/repair-intake`,
    headers: bearer(token),
    payload: { faultCategoryId: Number(cat.id), notes: '充电2小时仍 0%' },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.faultReason, '电池不充电');

  const r = await prisma.deviceRepair.findUnique({ where: { id: BigInt(body.id) } });
  assert.equal(r?.faultCategoryId?.toString(), cat.id.toString());
});

test('POST /devices/:id/repair-intake: member of the device company can submit', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60500201',
      bleMac: 'AA:BB:CC:DD:EE:01',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const cat = await prisma.faultCategory.create({
    data: { label: '锁体损坏', displayOrder: 80 },
  });
  const memberPw = 'm-pw';
  await prisma.user.create({
    data: {
      phone: '13900001200',
      name: 'M',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(memberPw, 4),
    },
  });
  const token = await login(app, '13900001200', memberPw);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/repair-intake`,
    headers: bearer(token),
    payload: { faultCategoryId: Number(cat.id) },
  });
  assert.equal(res.statusCode, 201);
});

test('POST /devices/:id/repair-intake: cross-company member rejected (403)', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'B Co', industry: 'logistics' },
  });
  const otherDev = await prisma.device.create({
    data: {
      lockId: '60500202',
      bleMac: 'AA:BB:CC:DD:EE:02',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });
  const cat = await prisma.faultCategory.create({
    data: { label: '其他', displayOrder: 999 },
  });
  const memberPw = 'm-pw';
  await prisma.user.create({
    data: {
      phone: '13900001201',
      name: 'M',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(memberPw, 4),
    },
  });
  const token = await login(app, '13900001201', memberPw);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${otherDev.id}/repair-intake`,
    headers: bearer(token),
    payload: { faultCategoryId: Number(cat.id) },
  });
  assert.equal(res.statusCode, 403);
});

test('POST /devices/:id/repair-intake: requires faultReason or faultCategoryId', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60500203',
      bleMac: 'AA:BB:CC:DD:EE:03',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/repair-intake`,
    headers: bearer(token),
    payload: {},
  });
  assert.equal(res.statusCode, 400);
});

// ========== Task 6: GET /repairs scope guard against query-param spoofing ==========

test('GET /repairs?sourceCompanyId=X is ignored for company_admin (scope locked)', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'B Co', industry: 'logistics' },
  });
  const otherDev = await prisma.device.create({
    data: {
      lockId: '60500300',
      bleMac: 'AA:BB:CC:DD:EE:30',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });
  // Seed a repair on the OTHER company's device
  await prisma.deviceRepair.create({
    data: {
      deviceId: otherDev.id,
      sourceCompanyId: otherCo.id,
      priorStatus: 'active',
      faultReason: 'x',
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  // Company admin tries to spoof and read the other company's repairs
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/repairs?sourceCompanyId=${otherCo.id}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  // Should be 0, not 1 — the query param is ignored for non-vendor.
  assert.equal(JSON.parse(res.body).total, 0);
});
