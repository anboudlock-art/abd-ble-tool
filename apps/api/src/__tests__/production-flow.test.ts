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

test('production flow: batch create → scan → rescan → ship → deliver', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();

  const vendorToken = await login(app, '13800000001', users.vendorPassword);
  const operatorToken = await login(app, '13800000002', users.operatorPassword);

  // 1. Vendor creates a batch
  const batchRes = await app.inject({
    method: 'POST',
    url: '/api/v1/production/batches',
    headers: bearer(vendorToken),
    payload: {
      batchNo: 'B-2026-001',
      modelId: Number(model.id),
      quantity: 100,
    },
  });
  assert.equal(batchRes.statusCode, 201);
  const batch = JSON.parse(batchRes.body);
  assert.equal(batch.batchNo, 'B-2026-001');
  assert.equal(batch.quantity, 100);
  assert.equal(batch.producedCount, 0);

  // 2. Operator submits a scan
  const scan1 = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(operatorToken),
    payload: {
      batchId: Number(batch.id),
      lockId: '60806001',
      bleMac: 'E1:6A:9C:F1:F8:7E',
      imei: '860041068503363',
      firmwareVersion: 'V10.0',
      qcResult: 'passed',
    },
  });
  assert.equal(scan1.statusCode, 201);
  const scanBody1 = JSON.parse(scan1.body);
  assert.equal(scanBody1.firstScan, true);
  assert.equal(scanBody1.device.lockId, '60806001');
  assert.equal(scanBody1.device.status, 'in_warehouse');

  // 3. Re-scan same device (e.g. fixed a flaw on the line) — should be 200, not 201
  const scan2 = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(operatorToken),
    payload: {
      batchId: Number(batch.id),
      lockId: '60806001',
      bleMac: 'E1:6A:9C:F1:F8:7E',
      imei: '860041068503363',
      firmwareVersion: 'V10.1',
      qcResult: 'passed',
    },
  });
  assert.equal(scan2.statusCode, 200);
  assert.equal(JSON.parse(scan2.body).firstScan, false);

  // 4. MAC-swap attempt is rejected
  const swap = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(operatorToken),
    payload: {
      batchId: Number(batch.id),
      lockId: '60806001',
      bleMac: 'AA:BB:CC:DD:EE:FF',
      qcResult: 'passed',
    },
  });
  assert.equal(swap.statusCode, 409);

  // 5. Batch progress reflects one produced device
  const batchGet = await app.inject({
    method: 'GET',
    url: `/api/v1/production/batches/${batch.id}`,
    headers: bearer(vendorToken),
  });
  const batchData = JSON.parse(batchGet.body);
  assert.equal(batchData.producedCount, 1);
  // 2 successful scans (scan1 + rescan), the MAC-swap attempt was rejected pre-transaction
  assert.equal(batchData.scannedCount, 2);

  // 6. Ship to a company
  const ship = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/ship',
    headers: bearer(vendorToken),
    payload: {
      deviceIds: [Number(scanBody1.device.id)],
      toCompanyId: Number(users.companyId),
      shipmentNo: 'SHIP-001',
    },
  });
  assert.equal(ship.statusCode, 200);
  const shipBody = JSON.parse(ship.body);
  assert.equal(shipBody.shippedCount, 1);
  assert.equal(shipBody.devices[0].status, 'shipped');

  // 7. Company admin confirms delivery
  const companyToken = await login(app, '13800000003', users.companyAdminPassword);
  const deliver = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/deliver',
    headers: bearer(companyToken),
    payload: { deviceIds: [Number(scanBody1.device.id)] },
  });
  assert.equal(deliver.statusCode, 200);
  assert.equal(JSON.parse(deliver.body).devices[0].status, 'delivered');

  // 8. Transfer history has the full trail
  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/devices/${scanBody1.device.id}/transfers`,
    headers: bearer(vendorToken),
  });
  const items = JSON.parse(history.body).items;
  assert.ok(items.length >= 3, `expected ≥3 transfer rows, got ${items.length}`);
});

test('production operator cannot ship devices (role check)', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const operatorToken = await login(app, '13800000002', users.operatorPassword);

  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-1', modelId: model.id, quantity: 1 },
  });
  const device = await prisma.device.create({
    data: {
      lockId: '60806099',
      bleMac: 'AA:BB:CC:DD:EE:FF',
      modelId: model.id,
      batchId: batch.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/ship',
    headers: bearer(operatorToken),
    payload: {
      deviceIds: [Number(device.id)],
      toCompanyId: Number(users.companyId),
    },
  });
  assert.equal(res.statusCode, 403);
});

test('company admin cannot view other company devices', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();

  // Create another company and admin
  const otherCompany = await prisma.company.create({
    data: { name: 'Other Co', shortCode: 'other-co', industry: 'logistics' },
  });
  const bcrypt = (await import('bcryptjs')).default;
  await prisma.user.create({
    data: {
      phone: '13800000004',
      name: 'Other Admin',
      role: 'company_admin',
      companyId: otherCompany.id,
      passwordHash: await bcrypt.hash('other-pass', 4),
    },
  });

  // A device in Test Co
  const device = await prisma.device.create({
    data: {
      lockId: '60806100',
      bleMac: 'AA:BB:CC:DD:EE:FE',
      modelId: model.id,
      status: 'delivered',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });

  const otherToken = await login(app, '13800000004', 'other-pass');
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/devices/${device.id}`,
    headers: bearer(otherToken),
  });
  assert.equal(res.statusCode, 403);
});

test('device lookup by lockId', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  await prisma.device.create({
    data: {
      lockId: '60806200',
      bleMac: 'AA:BB:CC:DD:EE:FD',
      modelId: model.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });

  const token = await login(app, '13800000001', users.vendorPassword);
  const found = await app.inject({
    method: 'GET',
    url: '/api/v1/devices/lookup?lockId=60806200',
    headers: bearer(token),
  });
  assert.equal(found.statusCode, 200);
  assert.equal(JSON.parse(found.body).lockId, '60806200');

  const notFound = await app.inject({
    method: 'GET',
    url: '/api/v1/devices/lookup?lockId=99999999',
    headers: bearer(token),
  });
  assert.equal(notFound.statusCode, 404);
});
