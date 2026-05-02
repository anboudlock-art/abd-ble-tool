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

// ==================== P1 (QA #2.6 / #5.4): /device-tree gating ====================

test('GET /device-tree: member is rejected with 403', async () => {
  const u = await seedBasicUsers();
  // Seed a member in the same company as the company_admin
  const memberPassword = 'member-pass-1';
  await prisma.user.create({
    data: {
      phone: '13900000099',
      name: 'Member Wang',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(memberPassword, 4),
    },
  });
  const token = await login(app, '13900000099', memberPassword);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/device-tree?companyId=${u.companyId}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 403);
});

test('GET /device-tree: production_operator is rejected with 403', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000002', u.operatorPassword);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/device-tree?companyId=${u.companyId}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 403);
});

test('GET /device-tree: company_admin can see their own company tree', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/device-tree',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  // company_admin's scope is locked to their own company; the
  // companyId query param is ignored for them.
  assert.equal(body.id, u.companyId.toString());
});

// ==================== P1 (QA): mustChangePassword stays gated ====================
// The frontend redirect is exercised in browser tests; here we just lock
// in that the API still surfaces the flag correctly so the FE can act.

test('GET /users/me returns mustChangePassword=true for a freshly-seeded admin', async () => {
  const u = await seedBasicUsers();
  // Seed a brand-new admin (mustChangePassword default is now true)
  const password = 'fresh-pass';
  await prisma.user.create({
    data: {
      phone: '13900000088',
      name: 'Fresh Admin',
      role: 'company_admin',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(password, 4),
      // explicit so the test doesn't depend on Prisma default migration
      mustChangePassword: true,
    },
  });
  const token = await login(app, '13900000088', password);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).mustChangePassword, true);
});

test('change-password flips mustChangePassword to false', async () => {
  const u = await seedBasicUsers();
  const password = 'fresh-pass';
  await prisma.user.create({
    data: {
      phone: '13900000077',
      name: 'Fresh',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash(password, 4),
      mustChangePassword: true,
    },
  });
  const token = await login(app, '13900000077', password);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/change-password',
    headers: bearer(token),
    payload: { oldPassword: password, newPassword: 'new-pass-1' },
  });
  assert.equal(res.statusCode, 204);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me',
    headers: bearer(token),
  });
  assert.equal(JSON.parse(me.body).mustChangePassword, false);
});
