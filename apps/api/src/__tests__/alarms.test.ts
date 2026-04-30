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

async function seedAlarm(deviceId: bigint, companyId: bigint | null, type: 'low_battery' | 'tampered' = 'tampered') {
  return prisma.alarm.create({
    data: {
      deviceId,
      companyId,
      type,
      severity: type === 'tampered' ? 'critical' : 'warning',
      message: `测试 ${type}`,
    },
  });
}

test('alarm list is company-scoped', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();

  // Two devices in different companies
  const otherCo = await prisma.company.create({
    data: { name: 'Other', shortCode: 'other-3', industry: 'logistics' },
  });

  const myDev = await prisma.device.create({
    data: {
      lockId: '60806100',
      bleMac: 'AA:BB:CC:DD:EE:11',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const otherDev = await prisma.device.create({
    data: {
      lockId: '60806200',
      bleMac: 'AA:BB:CC:DD:EE:22',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });

  await seedAlarm(myDev.id, users.companyId);
  await seedAlarm(otherDev.id, otherCo.id);

  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/alarms',
    headers: bearer(cToken),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].deviceId, myDev.id.toString());

  // Vendor admin sees both
  const vToken = await login(app, '13800000001', users.vendorPassword);
  const vRes = await app.inject({
    method: 'GET',
    url: '/api/v1/alarms',
    headers: bearer(vToken),
  });
  assert.equal(JSON.parse(vRes.body).total, 2);
});

test('alarm ack transitions to acknowledged', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();
  const dev = await prisma.device.create({
    data: {
      lockId: '60806300',
      bleMac: 'AA:BB:CC:DD:EE:33',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const a = await seedAlarm(dev.id, users.companyId);
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/alarms/${a.id}/ack`,
    headers: bearer(cToken),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'acknowledged');

  const reload = await prisma.alarm.findUnique({ where: { id: a.id } });
  assert.equal(reload!.status, 'acknowledged');
  assert.ok(reload!.acknowledgedAt);
  assert.equal(reload!.acknowledgedByUserId, users.companyAdminId);
});

test('cross-company alarm ack is forbidden', async () => {
  const users = await seedBasicUsers();
  const otherCo = await prisma.company.create({
    data: { name: 'Other', shortCode: 'other-4', industry: 'logistics' },
  });
  const model = await seedDeviceModel();
  const otherDev = await prisma.device.create({
    data: {
      lockId: '60806400',
      bleMac: 'AA:BB:CC:DD:EE:44',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: otherCo.id,
    },
  });
  const a = await seedAlarm(otherDev.id, otherCo.id);
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/alarms/${a.id}/ack`,
    headers: bearer(cToken),
  });
  assert.equal(res.statusCode, 403);
});

test('dashboard summary returns counts and histogram structure', async () => {
  const users = await seedBasicUsers();
  const model = await seedDeviceModel();

  // Devices in various states
  for (let i = 0; i < 3; i++) {
    await prisma.device.create({
      data: {
        lockId: `6080070${i}`,
        bleMac: `AA:BB:CC:DD:EE:5${i}`,
        modelId: model.id,
        status: 'active',
        qcStatus: 'passed',
        ownerType: 'company',
        ownerCompanyId: users.companyId,
        lastSeenAt: new Date(),
      },
    });
  }
  await prisma.device.create({
    data: {
      lockId: '60800800',
      bleMac: 'AA:BB:CC:DD:EE:60',
      modelId: model.id,
      status: 'in_warehouse',
      qcStatus: 'passed',
      ownerType: 'vendor',
    },
  });

  const vToken = await login(app, '13800000001', users.vendorPassword);
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/dashboard/summary',
    headers: bearer(vToken),
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.deviceCounts.total, 4);
  assert.equal(body.deviceCounts.byStatus.active, 3);
  assert.equal(body.deviceCounts.byStatus.in_warehouse, 1);
  assert.equal(body.online.active, 3);
  assert.equal(body.online.online, 3);
  assert.equal(body.online.rate, 1);
  assert.ok(Array.isArray(body.events.histogram));
  assert.ok(Array.isArray(body.recentDevices));
});
