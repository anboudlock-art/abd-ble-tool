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

// ==================== P0 #5: /authorizations ====================

test('GET /authorizations rejects member role with 403', async () => {
  const u = await seedBasicUsers();
  const member = await prisma.user.create({
    data: {
      phone: '13900000099',
      name: 'Member',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('member-pass', 4),
    },
  });
  void member;
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone: '13900000099', password: 'member-pass' },
  });
  const token = JSON.parse(r.body).accessToken;
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/authorizations',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 403);
});

test('GET /authorizations company_admin only sees their own company', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'Other Co', industry: 'logistics' },
  });
  const myDev = await prisma.device.create({
    data: {
      lockId: '60500900',
      bleMac: 'AA:BB:CC:DD:EE:90',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const otherDev = await prisma.device.create({
    data: {
      lockId: '60500901',
      bleMac: 'AA:BB:CC:DD:EE:91',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });
  await prisma.deviceAssignment.createMany({
    data: [
      { deviceId: myDev.id, companyId: u.companyId, scope: 'team' },
      { deviceId: otherDev.id, companyId: otherCo.id, scope: 'team' },
    ],
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/authorizations',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].lockId, '60500900');
});

// ==================== P0 #6: /users/me ====================

test('GET /users/me returns company + memberships with department', async () => {
  const u = await seedBasicUsers();
  const dept = await prisma.department.create({
    data: { companyId: u.companyId, name: '运维部' },
  });
  const team = await prisma.team.create({
    data: { companyId: u.companyId, departmentId: dept.id, name: '一组' },
  });
  await prisma.userMembership.create({
    data: { userId: u.companyAdminId, teamId: team.id, roleInTeam: 'leader' },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.companyName, 'Test Co');
  assert.equal(body.teams.length, 1);
  assert.equal(body.teams[0].departmentName, '运维部');
  assert.equal(body.teams[0].roleInTeam, 'leader');
});

// ==================== Bug #2: device-tree leaderName ====================

test('GET /device-tree includes leaderName per team', async () => {
  const u = await seedBasicUsers();
  const dept = await prisma.department.create({
    data: { companyId: u.companyId, name: 'D' },
  });
  const leader = await prisma.user.create({
    data: {
      phone: '13900000100',
      name: 'Leader Wang',
      role: 'team_leader',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('x', 4),
    },
  });
  await prisma.team.create({
    data: {
      companyId: u.companyId,
      departmentId: dept.id,
      name: 'T1',
      leaderUserId: leader.id,
    },
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/device-tree?companyId=${u.companyId}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.departments[0].teams[0].leaderName, 'Leader Wang');
  assert.equal(body.departments[0].teams[0].leaderPhone, '13900000100');
});

// ==================== Feature #7: create company + admin ====================

test('POST /companies creates a company_admin user when adminPhone is given', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/companies',
    headers: bearer(token),
    payload: {
      name: 'Acme Inc',
      industry: 'security',
      adminPhone: '13900008888',
      adminName: 'Acme Admin',
    },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.ok(body.adminAccount);
  assert.equal(body.adminAccount.phone, '13900008888');
  assert.equal(body.adminAccount.name, 'Acme Admin');
  assert.ok(body.adminAccount.initialPassword.length >= 8);
  // The user is real and locked into the new company.
  const u2 = await prisma.user.findUnique({ where: { phone: '13900008888' } });
  assert.equal(u2?.role, 'company_admin');
  assert.equal(u2?.companyId?.toString(), body.id);
  assert.equal(u2?.mustChangePassword, true);
});

test('POST /companies w/ duplicate adminPhone returns 409 and creates nothing', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000001', u.vendorPassword);
  const before = await prisma.company.count();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/companies',
    headers: bearer(token),
    payload: {
      name: 'Dup Inc',
      industry: 'security',
      adminPhone: '13800000003', // already seeded as companyAdmin
    },
  });
  assert.equal(res.statusCode, 409);
  const after = await prisma.company.count();
  assert.equal(before, after);
});

// ==================== Feature #9: view-as header ====================

test('vendor X-View-As-Company scopes /authorizations like a company_admin would', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'B Co', industry: 'logistics' },
  });
  const dA = await prisma.device.create({
    data: {
      lockId: '60500700',
      bleMac: 'AA:BB:CC:DD:EE:70',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const dB = await prisma.device.create({
    data: {
      lockId: '60500701',
      bleMac: 'AA:BB:CC:DD:EE:71',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });
  await prisma.deviceAssignment.createMany({
    data: [
      { deviceId: dA.id, companyId: u.companyId, scope: 'team' },
      { deviceId: dB.id, companyId: otherCo.id, scope: 'team' },
    ],
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  // No view header -> vendor sees both
  const r1 = await app.inject({
    method: 'GET',
    url: '/api/v1/authorizations',
    headers: bearer(token),
  });
  assert.equal(JSON.parse(r1.body).total, 2);
  // With view header -> sees only that company's
  const r2 = await app.inject({
    method: 'GET',
    url: '/api/v1/authorizations',
    headers: { ...bearer(token), 'x-view-as-company': otherCo.id.toString() },
  });
  const body2 = JSON.parse(r2.body);
  assert.equal(body2.total, 1);
  assert.equal(body2.items[0].lockId, '60500701');
});

test('non-vendor ignoring X-View-As-Company header (no privilege escalation)', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'B Co', industry: 'logistics' },
  });
  await prisma.device.create({
    data: {
      lockId: '60500800',
      bleMac: 'AA:BB:CC:DD:EE:80',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });
  await prisma.deviceAssignment.create({
    data: {
      deviceId: (await prisma.device.findUniqueOrThrow({ where: { lockId: '60500800' } })).id,
      companyId: otherCo.id,
      scope: 'team',
    },
  });
  // Login as the seeded company_admin and try to spoof another company
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/authorizations',
    headers: { ...bearer(token), 'x-view-as-company': otherCo.id.toString() },
  });
  assert.equal(res.statusCode, 200);
  // Should still scope to caller's own company, NOT the spoofed one
  assert.equal(JSON.parse(res.body).total, 0);
});
