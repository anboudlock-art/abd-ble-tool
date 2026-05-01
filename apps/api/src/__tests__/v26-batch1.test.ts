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

test('GET /users/me returns role + company + teams', async () => {
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
  assert.equal(body.role, 'company_admin');
  assert.equal(body.companyId, u.companyId.toString());
  assert.equal(body.teams.length, 1);
  assert.equal(body.teams[0].roleInTeam, 'leader');
});

test('GET /users/me/devices unions team-scope and user-scope grants', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();

  const dept = await prisma.department.create({
    data: { companyId: u.companyId, name: 'D' },
  });
  const team = await prisma.team.create({
    data: { companyId: u.companyId, departmentId: dept.id, name: 'T' },
  });
  const member = await prisma.user.create({
    data: {
      phone: '13800000099',
      name: 'Worker',
      role: 'member',
      companyId: u.companyId,
      passwordHash: await bcrypt.hash('worker-pass', 4),
    },
  });
  await prisma.userMembership.create({
    data: { userId: member.id, teamId: team.id, roleInTeam: 'member' },
  });

  const dev1 = await prisma.device.create({
    data: {
      lockId: '60500001',
      bleMac: 'AA:BB:CC:DD:EE:01',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const dev2 = await prisma.device.create({
    data: {
      lockId: '60500002',
      bleMac: 'AA:BB:CC:DD:EE:02',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  // dev1 → team scope; dev2 → user scope
  await prisma.deviceAssignment.create({
    data: {
      deviceId: dev1.id,
      companyId: u.companyId,
      scope: 'team',
      teamId: team.id,
    },
  });
  await prisma.deviceAssignment.create({
    data: {
      deviceId: dev2.id,
      companyId: u.companyId,
      scope: 'user',
      teamId: team.id,
      userId: member.id,
    },
  });
  // Expired grant must be filtered out
  const dev3 = await prisma.device.create({
    data: {
      lockId: '60500003',
      bleMac: 'AA:BB:CC:DD:EE:03',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  await prisma.deviceAssignment.create({
    data: {
      deviceId: dev3.id,
      companyId: u.companyId,
      scope: 'team',
      teamId: team.id,
      validUntil: new Date(Date.now() - 1000),
    },
  });

  // Login as the member
  const token = await app
    .inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone: '13800000099', password: 'worker-pass' },
    })
    .then((r) => JSON.parse(r.body).accessToken as string);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/users/me/devices',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  const ids = body.items.map((i: { lockId: string }) => i.lockId).sort();
  assert.deepEqual(ids, ['60500001', '60500002']);
});

test('GET /devices/:id/status surfaces last state + battery', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await prisma.device.create({
    data: {
      lockId: '60500004',
      bleMac: 'AA:BB:CC:DD:EE:04',
      modelId: m.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
      lastBattery: 73,
      lastState: 'closed',
      lastSeenAt: new Date('2026-05-01T08:00:00Z'),
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/devices/${d.id}/status`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.lastBattery, 73);
  assert.equal(body.lastState, 'closed');
  assert.equal(body.status, 'active');
});

test('GET /devices/:id/deployment returns null when never deployed, then the latest after deploy', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const d = await prisma.device.create({
    data: {
      lockId: '60500005',
      bleMac: 'AA:BB:CC:DD:EE:05',
      modelId: m.id,
      status: 'assigned',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: u.companyId,
    },
  });
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const empty = await app.inject({
    method: 'GET',
    url: `/api/v1/devices/${d.id}/deployment`,
    headers: bearer(token),
  });
  assert.equal(empty.statusCode, 200);
  assert.equal(JSON.parse(empty.body).current, null);

  await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/deploy`,
    headers: bearer(token),
    payload: { lat: 23.1, lng: 113.3, doorLabel: 'A1' },
  });

  const filled = await app.inject({
    method: 'GET',
    url: `/api/v1/devices/${d.id}/deployment`,
    headers: bearer(token),
  });
  assert.equal(filled.statusCode, 200);
  const body = JSON.parse(filled.body);
  assert.equal(body.current.doorLabel, 'A1');
  assert.equal(body.current.lat, '23.1');
});

test('POST /devices/:id/bind fills MAC/IMEI on a partially-registered device', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  // Device created without IMEI
  const d = await prisma.device.create({
    data: {
      lockId: '60500006',
      bleMac: 'AA:BB:CC:DD:EE:06',
      modelId: m.id,
      status: 'manufactured',
      qcStatus: 'pending',
      ownerType: 'vendor',
    },
  });
  const token = await login(app, '13800000001', u.vendorPassword);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/bind`,
    headers: bearer(token),
    payload: { imei: '861234567890123', firmwareVersion: '1.2.3' },
  });
  assert.equal(res.statusCode, 200);
  const reload = await prisma.device.findUnique({ where: { id: d.id } });
  assert.equal(reload?.imei, '861234567890123');
  assert.equal(reload?.firmwareVersion, '1.2.3');
});

test('POST /devices/:id/bind rejects MAC clash', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  await prisma.device.create({
    data: {
      lockId: '60500007',
      bleMac: 'AA:BB:CC:DD:EE:07',
      modelId: m.id,
      status: 'manufactured',
      qcStatus: 'pending',
      ownerType: 'vendor',
    },
  });
  const d = await prisma.device.create({
    data: {
      lockId: '60500008',
      bleMac: 'AA:BB:CC:DD:EE:08',
      modelId: m.id,
      status: 'manufactured',
      qcStatus: 'pending',
      ownerType: 'vendor',
    },
  });
  const token = await login(app, '13800000001', u.vendorPassword);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${d.id}/bind`,
    headers: bearer(token),
    payload: { bleMac: 'AA:BB:CC:DD:EE:07' },
  });
  assert.equal(res.statusCode, 409);
});

test('GET /production-batches/:id/lock-numbers — empty for a fresh batch', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605', modelId: m.id, quantity: 100 },
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/production-batches/${batch.id}/lock-numbers`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.batchNo, 'B-2605');
  assert.equal(body.items.length, 0);
});

test('GET /notifications/unread-count returns count', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000003', u.companyAdminPassword);

  await prisma.notification.createMany({
    data: [
      { userId: u.companyAdminId, kind: 'system', title: 't1', body: 'b1' },
      { userId: u.companyAdminId, kind: 'system', title: 't2', body: 'b2' },
      {
        userId: u.companyAdminId,
        kind: 'system',
        title: 't3',
        body: 'b3',
        readAt: new Date(),
      },
    ],
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications/unread-count',
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).unreadCount, 2);
});

test('PUT /notifications/:id/read flips a single notification to read', async () => {
  const u = await seedBasicUsers();
  const token = await login(app, '13800000003', u.companyAdminPassword);

  const n = await prisma.notification.create({
    data: { userId: u.companyAdminId, kind: 'system', title: 't', body: 'b' },
  });

  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/notifications/${n.id}/read`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 204);
  const reload = await prisma.notification.findUnique({ where: { id: n.id } });
  assert.ok(reload?.readAt);
});

test('POST /device-commands (body) is rejected for in_warehouse devices', async () => {
  const u = await seedBasicUsers();
  const m = await prisma.deviceModel.create({
    data: {
      code: 'PADLOCK-V26',
      name: 'V2.6 padlock',
      category: 'fourg_padlock',
      scene: 'security',
      hasBle: true,
      has4g: true,
      hasLora: true,
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60500099',
      bleMac: 'AA:BB:CC:DD:EE:99',
      modelId: m.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/device-commands',
    headers: bearer(token),
    payload: { deviceId: Number(dev.id), command: 'unlock' },
  });
  assert.equal(res.statusCode, 409);
});
