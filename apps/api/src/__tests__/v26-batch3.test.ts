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

test('POST /lock-numbers/generate creates rows with the correct format', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605-A', modelId: m.id, quantity: 1000 },
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/lock-numbers/generate',
    headers: bearer(token),
    payload: {
      batchId: Number(batch.id),
      year: 2026,
      month: 5,
      startSeq: 1,
      count: 50,
    },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 50);
  assert.equal(body.firstLockId, '60500001');
  assert.equal(body.lastLockId, '60500050');

  const rows = await prisma.lockNumber.findMany({
    where: { batchId: batch.id },
    orderBy: { lockId: 'asc' },
  });
  assert.equal(rows.length, 50);
  assert.equal(rows[0]!.status, 'reserved');
});

test('POST /lock-numbers/generate is idempotent against duplicate seq ranges', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605-B', modelId: m.id, quantity: 1000 },
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  await app.inject({
    method: 'POST',
    url: '/api/v1/lock-numbers/generate',
    headers: bearer(token),
    payload: {
      batchId: Number(batch.id),
      year: 2026,
      month: 5,
      startSeq: 1,
      count: 10,
    },
  });
  // Re-running the same range must fail with 409
  const dup = await app.inject({
    method: 'POST',
    url: '/api/v1/lock-numbers/generate',
    headers: bearer(token),
    payload: {
      batchId: Number(batch.id),
      year: 2026,
      month: 5,
      startSeq: 5,
      count: 10,
    },
  });
  assert.equal(dup.statusCode, 409);
});

test('production scan flips matching lock_number from reserved to registered', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605-C', modelId: m.id, quantity: 100 },
  });
  await prisma.lockNumber.create({
    data: { lockId: '60500077', batchId: batch.id },
  });
  const opToken = await login(app, '13800000002', u.operatorPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(opToken),
    payload: {
      batchId: Number(batch.id),
      lockId: '60500077',
      bleMac: 'AA:BB:CC:DD:EE:77',
    },
  });
  assert.equal(res.statusCode, 201);
  const ln = await prisma.lockNumber.findUnique({ where: { lockId: '60500077' } });
  assert.equal(ln?.status, 'registered');
  assert.ok(ln?.deviceId);
  assert.ok(ln?.registeredAt);
});

test('B2 batch scan returns per-row results with mixed success', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605-D', modelId: m.id, quantity: 100 },
  });
  // Pre-seed one device so the second row collides on MAC
  await prisma.device.create({
    data: {
      lockId: '60500080',
      bleMac: 'AA:BB:CC:DD:EE:80',
      modelId: m.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });
  const opToken = await login(app, '13800000002', u.operatorPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/production-scans/batch',
    headers: bearer(opToken),
    payload: {
      scans: [
        {
          batchId: Number(batch.id),
          lockId: '60500081',
          bleMac: 'AA:BB:CC:DD:EE:81',
          qcResult: 'passed',
        },
        {
          // Same MAC as 60500080 above → should fail
          batchId: Number(batch.id),
          lockId: '60500082',
          bleMac: 'AA:BB:CC:DD:EE:80',
          qcResult: 'passed',
        },
        {
          batchId: Number(batch.id),
          lockId: '60500083',
          bleMac: 'AA:BB:CC:DD:EE:83',
          qcResult: 'passed',
          testItems: {
            ble_comm: { pass: true, value: 'ok' },
            battery_voltage: { pass: true, value: 3.84 },
          },
        },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.submitted, 3);
  assert.equal(body.succeeded, 2);
  assert.equal(body.failed, 1);
  assert.equal(body.results[1].ok, false);
  assert.match(body.results[1].error, /mac/i);
});

test('B4 summary aggregates qc + per-item passes across the batch', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605-E', modelId: m.id, quantity: 100 },
  });
  const opToken = await login(app, '13800000002', u.operatorPassword);
  for (const row of [
    {
      lockId: '60500090',
      mac: 'AA:BB:CC:DD:EE:90',
      qc: 'passed' as const,
      items: { ble_comm: { pass: true }, battery_voltage: { pass: true } },
    },
    {
      lockId: '60500091',
      mac: 'AA:BB:CC:DD:EE:91',
      qc: 'failed' as const,
      items: { ble_comm: { pass: false, note: 'no answer' } },
    },
    {
      lockId: '60500092',
      mac: 'AA:BB:CC:DD:EE:92',
      qc: 'passed' as const,
      items: { ble_comm: { pass: true } },
    },
  ]) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/production/scans',
      headers: bearer(opToken),
      payload: {
        batchId: Number(batch.id),
        lockId: row.lockId,
        bleMac: row.mac,
        qcResult: row.qc,
        testItems: row.items,
      },
    });
  }
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/production-scans/summary?batchId=${batch.id}`,
    headers: bearer(opToken),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.totalScans, 3);
  assert.equal(body.qc.passed, 2);
  assert.equal(body.qc.failed, 1);
  assert.equal(body.perItem.ble_comm.pass, 2);
  assert.equal(body.perItem.ble_comm.fail, 1);
  assert.equal(body.perItem.battery_voltage.pass, 1);
});

test('B3 GET /production-scans?deviceId returns scans for that device only', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-2605-F', modelId: m.id, quantity: 10 },
  });
  const opToken = await login(app, '13800000002', u.operatorPassword);
  const r1 = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(opToken),
    payload: {
      batchId: Number(batch.id),
      lockId: '60500095',
      bleMac: 'AA:BB:CC:DD:EE:95',
    },
  });
  const dev = JSON.parse(r1.body).device;
  // Re-scan to add a second row
  await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(opToken),
    payload: {
      batchId: Number(batch.id),
      lockId: '60500095',
      bleMac: 'AA:BB:CC:DD:EE:95',
      qcResult: 'passed',
      qcRemark: 'second pass',
    },
  });
  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/production-scans?deviceId=${dev.id}`,
    headers: bearer(opToken),
  });
  assert.equal(list.statusCode, 200);
  const body = JSON.parse(list.body);
  assert.equal(body.items.length, 2);
});

test('lock-numbers/export with format=excel returns an xlsx attachment', async () => {
  const u = await seedBasicUsers();
  const m = await seedDeviceModel();
  const batch = await prisma.productionBatch.create({
    data: { batchNo: 'B-EXPORT', modelId: m.id, quantity: 5 },
  });
  await prisma.lockNumber.createMany({
    data: [
      { lockId: '60500100', batchId: batch.id },
      { lockId: '60500101', batchId: batch.id },
    ],
  });
  const token = await login(app, '13800000001', u.vendorPassword);
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/lock-numbers/export?batchId=${batch.id}&format=excel`,
    headers: bearer(token),
  });
  assert.equal(res.statusCode, 200);
  assert.match(
    res.headers['content-type'] as string,
    /spreadsheet/,
  );
  assert.match(
    res.headers['content-disposition'] as string,
    /B-EXPORT\.xlsx/,
  );
});
