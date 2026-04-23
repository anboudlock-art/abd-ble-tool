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
