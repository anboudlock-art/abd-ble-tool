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

async function seedUser(companyId: bigint, phone: string, name = 'M') {
  return prisma.user.create({
    data: {
      phone,
      name,
      role: 'member',
      companyId,
      passwordHash: await bcrypt.hash('x', 4),
    },
  });
}

async function seedDevice(
  companyId: bigint,
  modelId: bigint,
  lockId: string,
  mac: string,
) {
  return prisma.device.create({
    data: {
      lockId,
      bleMac: mac,
      modelId,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: companyId,
    },
  });
}

test('POST /authorizations: 2 devices × 3 users → 6 user-scope grants', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d1 = await seedDevice(u.companyId, m.id, '60500401', 'AA:BB:CC:DD:EE:01');
  const d2 = await seedDevice(u.companyId, m.id, '60500402', 'AA:BB:CC:DD:EE:02');
  const u1 = await seedUser(u.companyId, '13900001001', 'A');
  const u2 = await seedUser(u.companyId, '13900001002', 'B');
  const u3 = await seedUser(u.companyId, '13900001003', 'C');
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d1.id), Number(d2.id)],
      userIds: [Number(u1.id), Number(u2.id), Number(u3.id)],
      validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      reason: '本周巡检',
    },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.createdCount, 6);
  assert.equal(body.skippedCount, 0);

  const grants = await prisma.deviceAssignment.findMany({
    where: { revokedAt: null, scope: 'user' },
  });
  assert.equal(grants.length, 6);
  assert.ok(grants.every((g) => g.validUntil != null));
});

test('POST /authorizations: re-grant revokes the prior open grant', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await seedDevice(u.companyId, m.id, '60500410', 'AA:BB:CC:DD:EE:10');
  const u1 = await seedUser(u.companyId, '13900001010', 'A');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      userIds: [Number(u1.id)],
    },
  });
  assert.equal(first.statusCode, 201);

  // Same pair again — first should get revoked, new one created
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      userIds: [Number(u1.id)],
      validUntil: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    },
  });
  assert.equal(second.statusCode, 201);
  const body = JSON.parse(second.body);
  assert.equal(body.createdCount, 1);
  assert.equal(body.revokedCount, 1);

  const open = await prisma.deviceAssignment.findMany({
    where: { deviceId: d.id, userId: u1.id, scope: 'user', revokedAt: null },
  });
  assert.equal(open.length, 1);
  assert.ok(open[0]!.validUntil); // the new one with validUntil set
});

test('POST /authorizations: cross-company device rejected at validation', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'Other', industry: 'logistics' },
  });
  const otherDev = await seedDevice(otherCo.id, m.id, '60500420', 'AA:BB:CC:DD:EE:20');
  const u1 = await seedUser(u.companyId, '13900001020', 'A');
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(otherDev.id)],
      userIds: [Number(u1.id)],
    },
  });
  assert.equal(res.statusCode, 409);
});

test('POST /authorizations: member is rejected (403)', async () => {
  const u = await seedBasicUsers();
  const member = await seedUser(u.companyId, '13900001030', 'M');
  void member;
  const token = await login(app, '13900001030', 'x');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: { deviceIds: [1], userIds: [1] },
  });
  assert.equal(res.statusCode, 403);
});

test('POST /authorizations: rejects validFrom >= validUntil', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const now = new Date();
  const past = new Date(now.getTime() - 1000);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: {
      deviceIds: [1],
      userIds: [1],
      validFrom: now.toISOString(),
      validUntil: past.toISOString(),
    },
  });
  assert.equal(res.statusCode, 400);
});

test('vendor_admin can authorise across companies (skips mismatched pairs)', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'B Co', industry: 'logistics' },
  });
  const dA = await seedDevice(u.companyId, m.id, '60500430', 'AA:BB:CC:DD:EE:30');
  const dB = await seedDevice(otherCo.id, m.id, '60500431', 'AA:BB:CC:DD:EE:31');
  // user only belongs to companyA — pair (dB, userA) gets silently skipped
  const userA = await seedUser(u.companyId, '13900001040', 'A');
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/authorizations',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(dA.id), Number(dB.id)],
      userIds: [Number(userA.id)],
    },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.createdCount, 1);
  assert.equal(body.skippedCount, 1);
});
