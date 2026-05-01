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

async function seedDeptTeamMember(companyId: bigint) {
  const dept = await prisma.department.create({
    data: { companyId, name: '运维部' },
  });
  const team = await prisma.team.create({
    data: { companyId, departmentId: dept.id, name: '一组' },
  });
  const member = await prisma.user.create({
    data: {
      phone: '13800000099',
      name: 'Worker Wang',
      role: 'member',
      companyId,
      passwordHash: await bcrypt.hash('worker-pass', 4),
    },
  });
  await prisma.userMembership.create({
    data: { userId: member.id, teamId: team.id, roleInTeam: 'member' },
  });
  return { dept, team, member };
}

async function seedDevice(companyId: bigint, modelId: bigint, lockId: string, mac: string) {
  return prisma.device.create({
    data: {
      lockId,
      bleMac: mac,
      modelId,
      status: 'delivered',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: companyId,
    },
  });
}

test('assign without userId records team scope', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team } = await seedDeptTeamMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60800001', 'AA:BB:CC:DD:EE:01');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: { deviceIds: [Number(d.id)], teamId: Number(team.id) },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.scope, 'team');
  assert.equal(body.userId, null);

  const a = await prisma.deviceAssignment.findFirst({ where: { deviceId: d.id } });
  assert.equal(a?.scope, 'team');
  assert.equal(a?.userId, null);
});

test('assign with userId records user scope and verifies membership', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team, member } = await seedDeptTeamMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60800002', 'AA:BB:CC:DD:EE:02');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const ok = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      teamId: Number(team.id),
      userId: Number(member.id),
    },
  });
  assert.equal(ok.statusCode, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.scope, 'user');
  assert.equal(body.userId, member.id.toString());
  assert.equal(body.userName, 'Worker Wang');

  const a = await prisma.deviceAssignment.findFirst({
    where: { deviceId: d.id, revokedAt: null },
  });
  assert.equal(a?.scope, 'user');
  assert.equal(a?.userId?.toString(), member.id.toString());

  // Non-member user is rejected
  const stranger = await prisma.user.create({
    data: {
      phone: '13800000088',
      name: 'Stranger',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('x', 4),
    },
  });
  const bad = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      teamId: Number(team.id),
      userId: Number(stranger.id),
    },
  });
  assert.equal(bad.statusCode, 409);
});

test('reassigning revokes the prior assignment', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team, member } = await seedDeptTeamMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60800003', 'AA:BB:CC:DD:EE:03');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: { deviceIds: [Number(d.id)], teamId: Number(team.id) },
  });
  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      teamId: Number(team.id),
      userId: Number(member.id),
    },
  });

  const open = await prisma.deviceAssignment.findMany({
    where: { deviceId: d.id, revokedAt: null },
  });
  assert.equal(open.length, 1);
  assert.equal(open[0]!.scope, 'user');
});

test('GET /devices/:id/assignment returns the latest open assignment', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team, member } = await seedDeptTeamMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60800004', 'AA:BB:CC:DD:EE:04');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      teamId: Number(team.id),
      userId: Number(member.id),
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/devices/${d.id}/assignment`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.current.scope, 'user');
  assert.equal(body.current.userName, 'Worker Wang');
});

test('GET /teams/:id/members lists members; DELETE removes', async () => {
  const u = await seedBasicUsers();
  const { team, member } = await seedDeptTeamMember(u.companyId);
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${team.id}/members`,
    headers: bearer(token),
  });
  assert.equal(list.statusCode, 200);
  const body = JSON.parse(list.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, 'Worker Wang');

  const del = await app.inject({
    method: 'DELETE',
    url: `/api/v1/teams/${team.id}/members/${member.id}`,
    headers: bearer(token),
  });
  assert.equal(del.statusCode, 204);

  const after = await prisma.userMembership.count({ where: { teamId: team.id } });
  assert.equal(after, 0);
});

test('removing a member downgrades user-scope assignments to team-scope', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team, member } = await seedDeptTeamMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60800005', 'AA:BB:CC:DD:EE:05');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d.id)],
      teamId: Number(team.id),
      userId: Number(member.id),
    },
  });
  await app.inject({
    method: 'DELETE',
    url: `/api/v1/teams/${team.id}/members/${member.id}`,
    headers: bearer(token),
  });

  const a = await prisma.deviceAssignment.findFirst({
    where: { deviceId: d.id, revokedAt: null },
  });
  assert.equal(a?.scope, 'team');
  assert.equal(a?.userId, null);
});

test('GET /users/:id/devices returns user-scoped assignments only', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team, member } = await seedDeptTeamMember(u.companyId);
  const d1 = await seedDevice(u.companyId, m.id, '60800006', 'AA:BB:CC:DD:EE:06');
  const d2 = await seedDevice(u.companyId, m.id, '60800007', 'AA:BB:CC:DD:EE:07');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  // d1 → user scope, d2 → team scope only
  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: {
      deviceIds: [Number(d1.id)],
      teamId: Number(team.id),
      userId: Number(member.id),
    },
  });
  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: { deviceIds: [Number(d2.id)], teamId: Number(team.id) },
  });

  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/users/${member.id}/devices`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].lockId, '60800006');
});

test('POST /devices/:id/deploy transitions assigned → active and records deployment', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const { team } = await seedDeptTeamMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60800008', 'AA:BB:CC:DD:EE:08');
  const token = await login(app, '13800000003', u.companyAdminPassword);

  // Assign first so it's in `assigned` state
  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(token),
    payload: { deviceIds: [Number(d.id)], teamId: Number(team.id) },
  });

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/deploy`,
    headers: bearer(token),
    payload: {
      lat: 23.1273,
      lng: 113.3528,
      accuracyM: 5,
      doorLabel: '2号门',
    },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'active');
  assert.ok(body.deployedAt);

  const reload = await prisma.device.findUnique({ where: { id: d.id } });
  assert.equal(reload?.status, 'active');
  assert.equal(reload?.doorLabel, '2号门');
  assert.equal(reload?.locationLat?.toString(), '23.1273');

  const dep = await prisma.deviceDeployment.findFirst({ where: { deviceId: d.id } });
  assert.ok(dep);
  assert.equal(dep?.doorLabel, '2号门');
});

test('deploying an in-warehouse device is rejected', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await prisma.device.create({
    data: {
      lockId: '60800009',
      bleMac: 'AA:BB:CC:DD:EE:09',
      modelId: m.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/deploy`,
    headers: bearer(token),
    payload: { lat: 23.1, lng: 113.3, doorLabel: 'x' },
  });
  assert.equal(res.statusCode, 409);
});

test('redeploying an active device updates location without bouncing state', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await prisma.device.create({
    data: {
      lockId: '60800010',
      bleMac: 'AA:BB:CC:DD:EE:10',
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
    url: `/api/v1/devices/${d.id}/deploy`,
    headers: bearer(token),
    payload: { lat: 23.5, lng: 113.5, doorLabel: '新位置' },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'active');
  assert.equal(body.doorLabel, '新位置');
});
