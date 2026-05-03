import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
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

test('PUT /devices/:id updates mutable fields and writes audit row', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806001',
      bleMac: 'AA:BB:CC:DD:EE:01',
      modelId: model.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });
  const token = await login(app, '13800000001', users.vendorPassword);

  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/devices/${dev.id}`,
    headers: bearer(token),
    payload: {
      iccid: '89860121121234567890',
      hardwareVersion: 'HW1.2',
      firmwareVersion: 'V11.0',
      doorLabel: '机房A东门',
      loraE220Addr: 8,
      loraChannel: 6,
      loraDevAddr: 'DEADBEEF',
      secureChipSn: 'ATECC608A-12345',
    },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.iccid, '89860121121234567890');
  assert.equal(body.hardwareVersion, 'HW1.2');
  assert.equal(body.loraDevAddr, 'DEADBEEF');

  const reread = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.equal(reread!.iccid, '89860121121234567890');
  assert.equal(reread!.secureChipSn, 'ATECC608A-12345');

  // Audit row written (hook runs onResponse, may lag a few ms)
  await waitFor(async () => {
    const cnt = await prisma.auditLog.count({
      where: { action: 'devices.update', targetId: dev.id },
    });
    return cnt >= 1;
  });
  const audits = await prisma.auditLog.findMany({
    where: { action: 'devices.update', targetId: dev.id },
  });
  const log = audits[0]!;
  assert.equal(log.actorUserId, users.vendorAdminId);
  assert.ok(log.diff && typeof log.diff === 'object');
});

test('PUT /devices/:id strips secrets when caller is company_admin', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806002',
      bleMac: 'AA:BB:CC:DD:EE:02',
      modelId: model.id,
      status: 'delivered',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
      loraAppKey: '00000000000000000000000000000000',
    },
  });
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/devices/${dev.id}`,
    headers: bearer(cToken),
    payload: {
      doorLabel: '客户改的标签',
      loraAppKey: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', // should be stripped
    },
  });
  assert.equal(res.statusCode, 200);

  const reread = await prisma.device.findUnique({ where: { id: dev.id } });
  assert.equal(reread!.doorLabel, '客户改的标签');
  // company_admin's attempt to rotate the AppKey was silently dropped
  assert.equal(reread!.loraAppKey, '00000000000000000000000000000000');
});

test('DELETE /devices/:id rejects active devices', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806003',
      bleMac: 'AA:BB:CC:DD:EE:03',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const token = await login(app, '13800000001', users.vendorPassword);
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/v1/devices/${dev.id}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 409);
});

test('PUT /users/:id updates name; cannot delete self', async () => {
  const users = await seedBasicUsers();
  const token = await login(app, '13800000001', users.vendorPassword);

  // Edit
  const put = await app.inject({
    method: 'PUT',
    url: `/api/v1/users/${users.companyAdminId}`,
    headers: bearer(token),
    payload: { name: '新名字' },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(JSON.parse(put.body).name, '新名字');

  // Self-delete forbidden
  const selfDel = await app.inject({
    method: 'DELETE',
    url: `/api/v1/users/${users.vendorAdminId}`,
    headers: bearer(token),
  });
  assert.equal(selfDel.statusCode, 409);
});

test('DELETE /companies/:id refuses if active devices', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  await prisma.device.create({
    data: {
      lockId: '60806010',
      bleMac: 'AA:BB:CC:DD:EE:10',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const token = await login(app, '13800000001', users.vendorPassword);
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/v1/companies/${users.companyId}`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).message, /still owns 1 active device/);
});

test('Department/Team list + edit + delete', async () => {
  const users = await seedBasicUsers();
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  // Create
  const deptRes = await app.inject({
    method: 'POST',
    url: '/api/v1/departments',
    headers: bearer(cToken),
    payload: { companyId: Number(users.companyId), name: '运维部' },
  });
  const deptId = JSON.parse(deptRes.body).id;

  // List
  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/departments',
    headers: bearer(cToken),
  });
  assert.equal(list.statusCode, 200);
  assert.equal(JSON.parse(list.body).items.length, 1);

  // Edit
  const put = await app.inject({
    method: 'PUT',
    url: `/api/v1/departments/${deptId}`,
    headers: bearer(cToken),
    payload: { name: '运维一部', code: 'OPS-1' },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(JSON.parse(put.body).name, '运维一部');

  // Add a team, then delete should refuse the dept
  const teamRes = await app.inject({
    method: 'POST',
    url: '/api/v1/teams',
    headers: bearer(cToken),
    payload: { departmentId: Number(deptId), name: '一组' },
  });
  const teamId = JSON.parse(teamRes.body).id;

  const delDept = await app.inject({
    method: 'DELETE',
    url: `/api/v1/departments/${deptId}`,
    headers: bearer(cToken),
  });
  assert.equal(delDept.statusCode, 409);

  // Delete the team first then the department
  const delTeam = await app.inject({
    method: 'DELETE',
    url: `/api/v1/teams/${teamId}`,
    headers: bearer(cToken),
  });
  assert.equal(delTeam.statusCode, 204);
  const delDept2 = await app.inject({
    method: 'DELETE',
    url: `/api/v1/departments/${deptId}`,
    headers: bearer(cToken),
  });
  assert.equal(delDept2.statusCode, 204);
});

test('Audit log redacts password fields', async () => {
  const users = await seedBasicUsers();
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: bearer(cToken),
    payload: {
      phone: '13911100022',
      name: 'X',
      role: 'member',
      initialPassword: 'this-is-secret',
    },
  });
  assert.equal(create.statusCode, 201);

  // The audit hook runs onResponse, after the response body is sent.
  // app.inject() resolves at body-write time, so give the hook a tick
  // to finish its prisma write before we read the audit_log table.
  await waitFor(async () => {
    const cnt = await prisma.auditLog.count({
      where: { action: { startsWith: 'users' } },
    });
    return cnt >= 1;
  });

  const audits = await prisma.auditLog.findMany({
    where: { action: { startsWith: 'users' } },
    orderBy: { id: 'desc' },
  });
  const diff = audits[0]!.diff as Record<string, unknown>;
  assert.equal(diff.initialPassword, '[REDACTED]');
  assert.equal(diff.phone, '13911100022');
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

test('Batch update + delete refuses when devices exist', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-1', modelId: model.id, quantity: 100 },
  });
  const token = await login(app, '13800000001', users.vendorPassword);

  // Update remark + quantity
  const put = await app.inject({
    method: 'PUT',
    url: `/api/v1/production/batches/${batch.id}`,
    headers: bearer(token),
    payload: { remark: '改了备注', quantity: 200 },
  });
  assert.equal(put.statusCode, 200);

  // Add a device, then DELETE should fail
  await prisma.device.create({
    data: {
      lockId: '60806099',
      bleMac: 'AA:BB:CC:DD:EE:99',
      modelId: model.id,
      batchId: batch.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });
  const del = await app.inject({
    method: 'DELETE',
    url: `/api/v1/production/batches/${batch.id}`,
    headers: bearer(token),
  });
  assert.equal(del.statusCode, 409);
});
