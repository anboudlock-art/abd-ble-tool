import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '@abd/db';
import { resetDb, seedBasicUsers, login, bearer } from './helpers.js';

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

// ---- Refresh tokens ----

test('login returns access + refresh tokens', async () => {
  const users = await seedBasicUsers();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13800000001', password: users.vendorPassword },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.accessToken && body.accessToken.length > 50);
  assert.ok(body.refreshToken && body.refreshToken.length > 30);
  // refresh row stored, hashed
  const rows = await prisma.refreshToken.findMany({
    where: { userId: users.vendorAdminId, revokedAt: null },
  });
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]!.tokenHash, body.refreshToken); // it's a hash
});

test('refresh issues a new access + new refresh token, revokes the old', async () => {
  const users = await seedBasicUsers();
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13800000001', password: users.vendorPassword },
  });
  const { refreshToken: oldRefresh } = JSON.parse(loginRes.body);

  const refreshRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: oldRefresh },
  });
  assert.equal(refreshRes.statusCode, 200);
  const { accessToken: newAt, refreshToken: newRt } = JSON.parse(refreshRes.body);
  assert.ok(newAt && newRt);
  assert.notEqual(newRt, oldRefresh);

  // Old refresh token now revoked → second use rejected
  const reuse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: oldRefresh },
  });
  assert.equal(reuse.statusCode, 401);
});

test('logout revokes the refresh token', async () => {
  const users = await seedBasicUsers();
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13800000001', password: users.vendorPassword },
  });
  const { accessToken, refreshToken } = JSON.parse(loginRes.body);

  const out = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: bearer(accessToken),
    payload: { refreshToken },
  });
  assert.equal(out.statusCode, 204);

  // refresh now invalid
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken },
  });
  assert.equal(r.statusCode, 401);
});

// ---- Notifications ----

test('alarms create + read user notifications via fan-out by company', async () => {
  const users = await seedBasicUsers();

  // Manually create an alarm + matching notifications (mirrors the
  // gw-server / worker call sites without spinning them up)
  const model = await prisma.deviceModel.create({
    data: { code: 'NOT-T', name: 'T', category: 'gps_lock', scene: 'logistics' },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60806100',
      bleMac: 'AA:BB:CC:DD:EE:99',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  await prisma.alarm.create({
    data: {
      deviceId: dev.id,
      companyId: users.companyId,
      type: 'tampered',
      severity: 'critical',
      message: '测试告警',
    },
  });
  // Direct-create notifications fan-out for the test (in production the
  // gw-server's raiseAlarm() would call notify() automatically)
  await prisma.notification.create({
    data: {
      userId: users.companyAdminId,
      companyId: users.companyId,
      kind: 'alarm',
      title: '设备严重告警',
      body: '测试告警',
      link: '/alarms',
    },
  });

  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications',
    headers: bearer(cToken),
  });
  assert.equal(list.statusCode, 200);
  const body = JSON.parse(list.body);
  assert.equal(body.total, 1);
  assert.equal(body.unreadCount, 1);
  const id = body.items[0].id;

  // Mark read
  const r = await app.inject({
    method: 'POST',
    url: `/api/v1/notifications/${id}/read`,
    headers: bearer(cToken),
  });
  assert.equal(r.statusCode, 204);

  const list2 = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications',
    headers: bearer(cToken),
  });
  assert.equal(JSON.parse(list2.body).unreadCount, 0);
});

test('cross-user notification visibility is blocked', async () => {
  const users = await seedBasicUsers();

  // Create a notification for the vendor admin
  const n = await prisma.notification.create({
    data: {
      userId: users.vendorAdminId,
      kind: 'system',
      title: 'X',
      body: 'Y',
    },
  });

  // company admin tries to ack it
  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const ack = await app.inject({
    method: 'POST',
    url: `/api/v1/notifications/${n.id}/read`,
    headers: bearer(cToken),
  });
  assert.equal(ack.statusCode, 403);
});
