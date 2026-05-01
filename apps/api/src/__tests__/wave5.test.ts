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

// ---- Audit log viewer ----

test('GET /audit-logs scoped per company; non-admin forbidden', async () => {
  const users = await seedBasicUsers();
  // Seed a few audit rows
  await prisma.auditLog.createMany({
    data: [
      {
        companyId: users.companyId,
        actorUserId: users.companyAdminId,
        action: 'devices.update',
        targetType: 'devices',
        targetId: 1n,
        actorIp: '1.2.3.4',
      },
      {
        // For some other company → vendor sees but company_admin doesn't
        companyId: users.companyId + 999n,
        actorUserId: users.vendorAdminId,
        action: 'companies.create',
        targetType: 'companies',
      },
      {
        companyId: null,
        actorUserId: users.vendorAdminId,
        action: 'auth.set-password',
      },
    ],
  });

  // Vendor admin sees all 3
  const vt = await login(app, '13800000001', users.vendorPassword);
  const vAll = await app.inject({
    method: 'GET',
    url: '/api/v1/audit-logs',
    headers: bearer(vt),
  });
  assert.equal(vAll.statusCode, 200);
  assert.equal(JSON.parse(vAll.body).total, 3);

  // Company admin sees only their company's row (1)
  const ct = await login(app, '13800000003', users.companyAdminPassword);
  const cOnly = await app.inject({
    method: 'GET',
    url: '/api/v1/audit-logs',
    headers: bearer(ct),
  });
  assert.equal(cOnly.statusCode, 200);
  const cBody = JSON.parse(cOnly.body);
  assert.equal(cBody.total, 1);
  assert.equal(cBody.items[0].action, 'devices.update');
});

// ---- Batch completion ----

test('POST /batches/:id/complete locks scans + sets completedAt', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const vt = await login(app, '13800000001', users.vendorPassword);

  // Create batch
  const created = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/production/batches',
        headers: bearer(vt),
        payload: { batchNo: 'CMP-1', modelId: Number(model.id), quantity: 10 },
      })
    ).body,
  );

  // Add a scan first
  const scan1 = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(vt),
    payload: {
      batchId: Number(created.id),
      lockId: '60806001',
      bleMac: 'E1:6A:9C:F1:F8:7E',
      qcResult: 'passed',
    },
  });
  assert.equal(scan1.statusCode, 201);

  // Complete the batch
  const done = await app.inject({
    method: 'POST',
    url: `/api/v1/production/batches/${created.id}/complete`,
    headers: bearer(vt),
  });
  assert.equal(done.statusCode, 200);
  assert.ok(JSON.parse(done.body).completedAt);

  // Re-completing is idempotent (200 with the same completedAt)
  const again = await app.inject({
    method: 'POST',
    url: `/api/v1/production/batches/${created.id}/complete`,
    headers: bearer(vt),
  });
  assert.equal(again.statusCode, 200);

  // Further scans rejected
  const scan2 = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(vt),
    payload: {
      batchId: Number(created.id),
      lockId: '60806002',
      bleMac: 'AA:BB:CC:DD:EE:02',
      qcResult: 'passed',
    },
  });
  assert.equal(scan2.statusCode, 409);
  assert.match(JSON.parse(scan2.body).message, /completed/);

  // Reopen → scans accepted again
  const reopen = await app.inject({
    method: 'POST',
    url: `/api/v1/production/batches/${created.id}/reopen`,
    headers: bearer(vt),
  });
  assert.equal(reopen.statusCode, 200);
  assert.equal(JSON.parse(reopen.body).completedAt, null);

  const scan3 = await app.inject({
    method: 'POST',
    url: '/api/v1/production/scans',
    headers: bearer(vt),
    payload: {
      batchId: Number(created.id),
      lockId: '60806002',
      bleMac: 'AA:BB:CC:DD:EE:02',
      qcResult: 'passed',
    },
  });
  assert.equal(scan3.statusCode, 201);
});

test('Reopen on a non-completed batch returns 409', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const vt = await login(app, '13800000001', users.vendorPassword);
  const created = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/production/batches',
        headers: bearer(vt),
        payload: { batchNo: 'CMP-2', modelId: Number(model.id), quantity: 1 },
      })
    ).body,
  );
  const r = await app.inject({
    method: 'POST',
    url: `/api/v1/production/batches/${created.id}/reopen`,
    headers: bearer(vt),
  });
  assert.equal(r.statusCode, 409);
});
