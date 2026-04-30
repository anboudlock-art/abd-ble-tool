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
  process.env.VENDOR_BOOTSTRAP_TOKEN = 'test-bootstrap';
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

test('login → me happy path', async () => {
  const users = await seedBasicUsers();

  const token = await login(app, '13800000001', users.vendorPassword);
  assert.ok(token.length > 0);

  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: bearer(token),
  });
  assert.equal(me.statusCode, 200);
  const body = JSON.parse(me.body);
  assert.equal(body.role, 'vendor_admin');
  assert.equal(body.phone, '13800000001');
});

test('login rejects wrong password', async () => {
  await seedBasicUsers();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13800000001', password: 'nope-not-real' },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).code, 'UNAUTHORIZED');
});

test('set-password via bootstrap token succeeds', async () => {
  await prisma.user.create({
    data: { phone: '13800000099', name: 'Fresh', role: 'vendor_admin' },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/set-password',
    payload: {
      phone: '13800000099',
      password: 'newpass123',
      setupToken: 'test-bootstrap',
    },
  });
  assert.equal(res.statusCode, 204);

  // Now log in with the new password
  const token = await login(app, '13800000099', 'newpass123');
  assert.ok(token.length > 0);
});

test('set-password without valid token or auth fails', async () => {
  await prisma.user.create({
    data: { phone: '13800000099', name: 'Fresh', role: 'vendor_admin' },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/set-password',
    payload: { phone: '13800000099', password: 'whatever12', setupToken: 'wrong' },
  });
  assert.equal(res.statusCode, 401);
});

test('/auth/me rejects missing token', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
  assert.equal(res.statusCode, 401);
});

test('user creation auto-generates password and sets mustChangePassword', async () => {
  const users = await seedBasicUsers();
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: bearer(cToken),
    payload: {
      phone: '13900088888',
      name: 'Auto Password',
      role: 'member',
    },
  });
  assert.equal(create.statusCode, 201);
  const body = JSON.parse(create.body);
  assert.ok(body.initialPassword, 'initialPassword should be returned');
  assert.equal(body.status, 'active');

  // Login with the auto-generated password works
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13900088888', password: body.initialPassword },
  });
  assert.equal(loginRes.statusCode, 200);
  const loginBody = JSON.parse(loginRes.body);
  assert.equal(loginBody.user.mustChangePassword, true);

  // Change password
  const change = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/change-password',
    headers: bearer(loginBody.accessToken),
    payload: { oldPassword: body.initialPassword, newPassword: 'new-pass-1' },
  });
  assert.equal(change.statusCode, 204);

  // Login with new password; flag now cleared
  const loginRes2 = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13900088888', password: 'new-pass-1' },
  });
  assert.equal(loginRes2.statusCode, 200);
  assert.equal(JSON.parse(loginRes2.body).user.mustChangePassword, false);
});

test('admin reset-password rotates and sets mustChangePassword', async () => {
  const users = await seedBasicUsers();
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  // First create
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: bearer(cToken),
    payload: { phone: '13900099999', name: 'Member', role: 'member', initialPassword: 'initpass1' },
  });
  const newId = JSON.parse(created.body).id;

  // Login and change password to clear the flag
  const initToken = (
    JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { phone: '13900099999', password: 'initpass1' },
        })
      ).body,
    ) as { accessToken: string }
  ).accessToken;
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/change-password',
    headers: bearer(initToken),
    payload: { oldPassword: 'initpass1', newPassword: 'realpass1' },
  });

  // Admin resets
  const reset = await app.inject({
    method: 'POST',
    url: `/api/v1/users/${newId}/reset-password`,
    headers: bearer(cToken),
  });
  assert.equal(reset.statusCode, 200);
  const tempPwd = JSON.parse(reset.body).tempPassword;
  assert.ok(tempPwd && tempPwd.length >= 8);

  // Old real password no longer works
  const oldFail = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13900099999', password: 'realpass1' },
  });
  assert.equal(oldFail.statusCode, 401);

  // Temp password works and forces change
  const tempLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13900099999', password: tempPwd },
  });
  assert.equal(tempLogin.statusCode, 200);
  assert.equal(JSON.parse(tempLogin.body).user.mustChangePassword, true);
});

test('change-password rejects wrong old password', async () => {
  const users = await seedBasicUsers();
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/change-password',
    headers: bearer(cToken),
    payload: { oldPassword: 'definitely-wrong', newPassword: 'whatever-new' },
  });
  assert.equal(res.statusCode, 401);
});
