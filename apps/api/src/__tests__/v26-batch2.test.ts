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

async function seedMember(companyId: bigint, phone = '13800000099', name = 'Worker') {
  return prisma.user.create({
    data: {
      phone,
      name,
      role: 'member',
      companyId,
      passwordHash: await bcrypt.hash('worker-pass', 4),
    },
  });
}

async function loginMember(phone: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone, password: 'worker-pass' },
  });
  return JSON.parse(r.body).accessToken as string;
}

async function seedDevice(companyId: bigint, modelId: bigint, lockId: string, mac: string) {
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

// ====================== D: long-term permission ======================

test('D1+D3: member can submit a multi-device request and read it back', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d1 = await seedDevice(u.companyId, m.id, '60500001', 'AA:BB:CC:DD:EE:01');
  const d2 = await seedDevice(u.companyId, m.id, '60500002', 'AA:BB:CC:DD:EE:02');

  const token = await loginMember(member.phone);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/permission-requests',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      deviceIds: [Number(d1.id), Number(d2.id)],
      reason: '4月28日例行巡检',
    },
  });
  assert.equal(create.statusCode, 201);
  const created = JSON.parse(create.body);
  assert.equal(created.status, 'pending');
  assert.equal(created.items.length, 2);

  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/permission-requests/${created.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(detail.statusCode, 200);
  const body = JSON.parse(detail.body);
  assert.equal(body.devices.length, 2);
  assert.equal(body.applicant.id, member.id.toString());
});

test('D1: requesting a device from another company is rejected', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const otherCo = await prisma.company.create({
    data: { name: 'Other', shortCode: 'other-x', industry: 'logistics' },
  });
  const otherDevice = await seedDevice(otherCo.id, m.id, '60500099', 'AA:BB:CC:DD:EE:99');
  const member = await seedMember(u.companyId);
  const token = await loginMember(member.phone);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/permission-requests',
    headers: { authorization: `Bearer ${token}` },
    payload: { deviceIds: [Number(otherDevice.id)], reason: 'x' },
  });
  assert.equal(res.statusCode, 409);
});

test('D4: applicant can withdraw while pending', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60500003', 'AA:BB:CC:DD:EE:03');
  const token = await loginMember(member.phone);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/permission-requests',
    headers: { authorization: `Bearer ${token}` },
    payload: { deviceIds: [Number(d.id)], reason: 'x' },
  });
  const id = JSON.parse(create.body).id;
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/v1/permission-requests/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(del.statusCode, 204);
  const r = await prisma.permissionRequest.findUnique({ where: { id: BigInt(id) } });
  assert.equal(r?.status, 'cancelled');
});

test('H1+H2: company_admin sees pending queue, partial-approves, status flips to partial', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d1 = await seedDevice(u.companyId, m.id, '60500004', 'AA:BB:CC:DD:EE:04');
  const d2 = await seedDevice(u.companyId, m.id, '60500005', 'AA:BB:CC:DD:EE:05');
  const d3 = await seedDevice(u.companyId, m.id, '60500006', 'AA:BB:CC:DD:EE:06');

  const memberToken = await loginMember(member.phone);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/permission-requests',
    headers: { authorization: `Bearer ${memberToken}` },
    payload: {
      deviceIds: [Number(d1.id), Number(d2.id), Number(d3.id)],
      reason: '巡检',
      validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    },
  });
  const id = JSON.parse(create.body).id;

  const adminToken = await login(app, '13800000003', u.companyAdminPassword);
  const pending = await app.inject({
    method: 'GET',
    url: '/api/v1/permission-requests/pending',
    headers: bearer(adminToken),
  });
  assert.equal(pending.statusCode, 200);
  const queue = JSON.parse(pending.body);
  assert.equal(queue.total, 1);

  // Approve d1+d2, leave d3 pending → aggregate becomes "partial"
  const decided = await app.inject({
    method: 'POST',
    url: `/api/v1/permission-requests/${id}/approve`,
    headers: bearer(adminToken),
    payload: {
      decisions: [
        { deviceId: Number(d1.id), decision: 'approve' },
        { deviceId: Number(d2.id), decision: 'reject' },
      ],
      decisionNote: '只批 d1',
    },
  });
  assert.equal(decided.statusCode, 200);
  const body = JSON.parse(decided.body);
  assert.equal(body.status, 'partial');

  // Approval created exactly one user-scoped assignment for d1
  const grants = await prisma.deviceAssignment.findMany({
    where: { userId: member.id, scope: 'user', revokedAt: null },
  });
  assert.equal(grants.length, 1);
  assert.equal(grants[0]!.deviceId.toString(), d1.id.toString());
});

test('H2: cannot approve a request after it is fully resolved', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d1 = await seedDevice(u.companyId, m.id, '60500011', 'AA:BB:CC:DD:EE:11');
  const memberToken = await loginMember(member.phone);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/permission-requests',
    headers: { authorization: `Bearer ${memberToken}` },
    payload: { deviceIds: [Number(d1.id)], reason: 'r' },
  });
  const id = JSON.parse(create.body).id;
  const adminToken = await login(app, '13800000003', u.companyAdminPassword);
  await app.inject({
    method: 'POST',
    url: `/api/v1/permission-requests/${id}/approve`,
    headers: bearer(adminToken),
    payload: { decisions: [{ deviceId: Number(d1.id), decision: 'approve' }] },
  });
  const second = await app.inject({
    method: 'POST',
    url: `/api/v1/permission-requests/${id}/approve`,
    headers: bearer(adminToken),
    payload: { decisions: [{ deviceId: Number(d1.id), decision: 'approve' }] },
  });
  assert.equal(second.statusCode, 409);
});

// ====================== E: temporary unlock ======================

test('E1+E3: member submits 1h temp unlock, sees remainingSeconds null while pending', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60500020', 'AA:BB:CC:DD:EE:20');
  const token = await loginMember(member.phone);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/temporary-unlock',
    headers: { authorization: `Bearer ${token}` },
    payload: { deviceId: Number(d.id), reason: '紧急维修', durationMinutes: 60 },
  });
  assert.equal(create.statusCode, 201);
  const created = JSON.parse(create.body);
  assert.equal(created.status, 'pending');
  assert.equal(created.remainingSeconds, null);

  const detail = await app.inject({
    method: 'GET',
    url: `/api/v1/temporary-unlock/${created.id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(detail.statusCode, 200);
});

test('H3+H4: emergency requests are sorted to top; approval creates time-bounded grant', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d1 = await seedDevice(u.companyId, m.id, '60500021', 'AA:BB:CC:DD:EE:21');
  const d2 = await seedDevice(u.companyId, m.id, '60500022', 'AA:BB:CC:DD:EE:22');
  const token = await loginMember(member.phone);

  // Submit normal first, then emergency — emergency should sort above
  await app.inject({
    method: 'POST',
    url: '/api/v1/temporary-unlock',
    headers: { authorization: `Bearer ${token}` },
    payload: { deviceId: Number(d1.id), reason: 'normal', durationMinutes: 60 },
  });
  const eRes = await app.inject({
    method: 'POST',
    url: '/api/v1/temporary-unlock',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      deviceId: Number(d2.id),
      reason: 'emergency',
      durationMinutes: 60,
      emergency: true,
    },
  });
  const eId = JSON.parse(eRes.body).id;

  const adminToken = await login(app, '13800000003', u.companyAdminPassword);
  const pending = await app.inject({
    method: 'GET',
    url: '/api/v1/temporary-unlock/pending',
    headers: bearer(adminToken),
  });
  const items = JSON.parse(pending.body).items;
  assert.equal(items[0].id, eId);
  assert.equal(items[0].emergency, true);

  // Approve emergency → 60min grant
  const decided = await app.inject({
    method: 'POST',
    url: `/api/v1/temporary-unlock/${eId}/approve`,
    headers: bearer(adminToken),
    payload: { decision: 'approve' },
  });
  assert.equal(decided.statusCode, 200);
  const body = JSON.parse(decided.body);
  assert.equal(body.status, 'approved');
  assert.ok(body.validUntil);
  assert.ok(body.remainingSeconds !== null && body.remainingSeconds > 3500);

  // Underlying assignment exists with the same window
  const a = await prisma.deviceAssignment.findUnique({
    where: { id: BigInt(body.assignmentId) },
  });
  assert.equal(a?.userId?.toString(), member.id.toString());
  assert.equal(a?.scope, 'user');
});

test('H5: revoke an approved temporary unlock yanks the assignment immediately', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60500030', 'AA:BB:CC:DD:EE:30');
  const memberToken = await loginMember(member.phone);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/temporary-unlock',
    headers: { authorization: `Bearer ${memberToken}` },
    payload: { deviceId: Number(d.id), reason: 'x', durationMinutes: 240 },
  });
  const id = JSON.parse(create.body).id;
  const adminToken = await login(app, '13800000003', u.companyAdminPassword);
  await app.inject({
    method: 'POST',
    url: `/api/v1/temporary-unlock/${id}/approve`,
    headers: bearer(adminToken),
    payload: { decision: 'approve' },
  });
  const rev = await app.inject({
    method: 'POST',
    url: `/api/v1/temporary-unlock/${id}/revoke`,
    headers: bearer(adminToken),
  });
  assert.equal(rev.statusCode, 200);
  const t = await prisma.temporaryUnlock.findUnique({ where: { id: BigInt(id) } });
  assert.equal(t?.status, 'revoked');
  const a = await prisma.deviceAssignment.findUnique({
    where: { id: t!.assignmentId! },
  });
  assert.ok(a?.revokedAt);
});

test('E1: rejects invalid duration (e.g. 30 min)', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const member = await seedMember(u.companyId);
  const d = await seedDevice(u.companyId, m.id, '60500040', 'AA:BB:CC:DD:EE:40');
  const token = await loginMember(member.phone);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/temporary-unlock',
    headers: { authorization: `Bearer ${token}` },
    payload: { deviceId: Number(d.id), reason: 'r', durationMinutes: 30 },
  });
  assert.equal(res.statusCode, 400);
});
