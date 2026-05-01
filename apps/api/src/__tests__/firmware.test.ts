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

const SHA = '0'.repeat(64);

test('vendor admin can create + release a firmware package', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const token = await login(app, '13800000001', users.vendorPassword);

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '1.0.0',
      url: 'https://oss/firmware-1.0.0.bin',
      sha256: SHA,
      sizeBytes: 245760,
      changelog: 'initial release',
    },
  });
  assert.equal(create.statusCode, 201);
  const pkg = JSON.parse(create.body);
  assert.equal(pkg.status, 'draft');
  assert.equal(pkg.companyId, null);

  const rel = await app.inject({
    method: 'POST',
    url: `/api/v1/firmware/packages/${pkg.id}/release`,
    headers: bearer(token),
  });
  assert.equal(rel.statusCode, 200);
  assert.equal(JSON.parse(rel.body).status, 'released');
});

test('duplicate version on same model returns 409', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const token = await login(app, '13800000001', users.vendorPassword);

  await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '1.0.0',
      url: 'https://oss/a.bin',
      sha256: SHA,
      sizeBytes: 100,
    },
  });
  const dup = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '1.0.0',
      url: 'https://oss/b.bin',
      sha256: SHA,
      sizeBytes: 100,
    },
  });
  assert.equal(dup.statusCode, 409);
});

test('non-admin cannot create packages (forbidden)', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const token = await login(app, '13800000002', users.operatorPassword);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '1.0.0',
      url: 'https://oss/a.bin',
      sha256: SHA,
      sizeBytes: 100,
    },
  });
  assert.equal(res.statusCode, 403);
});

test('cannot push tasks for a draft (un-released) package', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const token = await login(app, '13800000001', users.vendorPassword);

  const dev = await prisma.device.create({
    data: {
      lockId: '60800101',
      bleMac: 'AA:BB:CC:DD:EE:01',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '1.0.0',
      url: 'https://oss/a.bin',
      sha256: SHA,
      sizeBytes: 100,
    },
  });
  const pkg = JSON.parse(create.body);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/tasks',
    headers: bearer(token),
    payload: { packageId: Number(pkg.id), deviceIds: [Number(dev.id)] },
  });
  assert.equal(res.statusCode, 400);
});

test('happy path: release + push creates one task per device', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const token = await login(app, '13800000001', users.vendorPassword);

  // Two matching devices + one of a different model that should be rejected.
  const otherModel = await prisma.deviceModel.create({
    data: {
      code: 'ESEAL-99',
      name: 'Other model',
      category: 'eseal',
      scene: 'logistics',
    },
  });
  const dev1 = await prisma.device.create({
    data: {
      lockId: '60800201',
      bleMac: 'AA:BB:CC:DD:EE:11',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const dev2 = await prisma.device.create({
    data: {
      lockId: '60800202',
      bleMac: 'AA:BB:CC:DD:EE:12',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const wrongModelDev = await prisma.device.create({
    data: {
      lockId: '60800203',
      bleMac: 'AA:BB:CC:DD:EE:13',
      modelId: otherModel.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '2.0.0',
      url: 'https://oss/a.bin',
      sha256: SHA,
      sizeBytes: 100,
    },
  });
  const pkg = JSON.parse(created.body);
  await app.inject({
    method: 'POST',
    url: `/api/v1/firmware/packages/${pkg.id}/release`,
    headers: bearer(token),
  });

  // Pushing including the wrong-model device should reject the whole call.
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/tasks',
    headers: bearer(token),
    payload: {
      packageId: Number(pkg.id),
      deviceIds: [Number(dev1.id), Number(dev2.id), Number(wrongModelDev.id)],
    },
  });
  assert.equal(wrong.statusCode, 400);

  // Without the bad one it should create both tasks.
  const ok = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/tasks',
    headers: bearer(token),
    payload: {
      packageId: Number(pkg.id),
      deviceIds: [Number(dev1.id), Number(dev2.id)],
    },
  });
  assert.equal(ok.statusCode, 201);
  assert.equal(JSON.parse(ok.body).created, 2);

  const tasks = await prisma.deviceFirmwareTask.findMany({
    where: { packageId: BigInt(pkg.id) },
    orderBy: { deviceId: 'asc' },
  });
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((t) => t.status === 'queued'));
});

test('re-pushing same (package, device) is idempotent', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const token = await login(app, '13800000001', users.vendorPassword);

  const dev = await prisma.device.create({
    data: {
      lockId: '60800301',
      bleMac: 'AA:BB:CC:DD:EE:21',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/firmware/packages',
    headers: bearer(token),
    payload: {
      modelId: Number(model.id),
      version: '3.0.0',
      url: 'https://oss/a.bin',
      sha256: SHA,
      sizeBytes: 100,
    },
  });
  const pkg = JSON.parse(created.body);
  await app.inject({
    method: 'POST',
    url: `/api/v1/firmware/packages/${pkg.id}/release`,
    headers: bearer(token),
  });

  for (let i = 0; i < 3; i++) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/firmware/tasks',
      headers: bearer(token),
      payload: { packageId: Number(pkg.id), deviceIds: [Number(dev.id)] },
    });
  }
  const count = await prisma.deviceFirmwareTask.count({
    where: { packageId: BigInt(pkg.id), deviceId: dev.id },
  });
  assert.equal(count, 1);
});
