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

async function createDeliveredDevice(opts: {
  companyId: bigint;
  modelId: bigint;
  withGateway?: { hasLora: boolean; online: boolean };
}) {
  const dev = await prisma.device.create({
    data: {
      lockId: '60806001',
      bleMac: 'E1:6A:9C:F1:F8:7E',
      modelId: opts.modelId,
      status: 'delivered',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: opts.companyId,
      loraE220Addr: 8,
      loraChannel: 6,
    },
  });
  if (opts.withGateway) {
    const gw = await prisma.gateway.create({
      data: {
        gwId: '00000017',
        token: 'TOKEN12345678',
        companyId: opts.companyId,
        status: 'active',
        online: opts.withGateway.online,
      },
    });
    await prisma.device.update({
      where: { id: dev.id },
      data: { gatewayId: gw.id },
    });
  }
  return dev;
}

test('assign devices to a team', async () => {
  const users = await seedBasicUsers();
  const model = await prisma.deviceModel.create({
    data: {
      code: 'PADLOCK-T',
      name: 'Padlock',
      category: 'fourg_padlock',
      scene: 'security',
      hasBle: true,
      has4g: true,
      hasLora: true,
    },
  });
  const dept = await prisma.department.create({
    data: { companyId: users.companyId, name: '运维部' },
  });
  const team = await prisma.team.create({
    data: { companyId: users.companyId, departmentId: dept.id, name: '一组' },
  });
  const device = await createDeliveredDevice({
    companyId: users.companyId,
    modelId: model.id,
  });

  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(cToken),
    payload: { deviceIds: [Number(device.id)], teamId: Number(team.id) },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.assignedCount, 1);
  assert.equal(body.devices[0].status, 'assigned');

  // device assignment row created (team scope)
  const assigns = await prisma.deviceAssignment.findMany({
    where: { deviceId: device.id },
  });
  assert.equal(assigns.length, 1);
  assert.equal(assigns[0]!.scope, 'team');
});

test('cannot assign device from another company', async () => {
  const users = await seedBasicUsers();
  const otherCo = await prisma.company.create({
    data: { name: 'Other', shortCode: 'other-2', industry: 'logistics' },
  });
  const model = await seedDeviceModel();
  const dept = await prisma.department.create({
    data: { companyId: users.companyId, name: 'D' },
  });
  const team = await prisma.team.create({
    data: { companyId: users.companyId, departmentId: dept.id, name: 'T' },
  });
  // Device belongs to OTHER company
  const dev = await createDeliveredDevice({
    companyId: otherCo.id,
    modelId: model.id,
  });

  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/assign',
    headers: bearer(cToken),
    payload: { deviceIds: [Number(dev.id)], teamId: Number(team.id) },
  });
  assert.equal(res.statusCode, 403);
});

test('remote command rejected for eseal', async () => {
  const users = await seedBasicUsers();
  const model = await prisma.deviceModel.create({
    data: {
      code: 'ESEAL',
      name: 'Eseal',
      category: 'eseal',
      scene: 'logistics',
    },
  });
  const dev = await prisma.device.create({
    data: {
      lockId: '60806099',
      bleMac: 'AA:BB:CC:DD:EE:FF',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
    },
  });
  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(cToken),
    payload: { commandType: 'unlock' },
  });
  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).code, 'DEVICE_FEATURE_UNSUPPORTED');
});

test('remote command rejected when gateway offline', async () => {
  const users = await seedBasicUsers();
  const model = await prisma.deviceModel.create({
    data: {
      code: 'PADLOCK-OFF',
      name: 'P',
      category: 'fourg_padlock',
      scene: 'security',
      hasLora: true,
      has4g: true,
    },
  });
  // Make device active so it's eligible
  const dev = await prisma.device.create({
    data: {
      lockId: '60806001',
      bleMac: 'E1:6A:9C:F1:F8:7E',
      modelId: model.id,
      status: 'active',
      qcStatus: 'passed',
      ownerType: 'company',
      ownerCompanyId: users.companyId,
      loraE220Addr: 8,
      loraChannel: 6,
    },
  });
  const gw = await prisma.gateway.create({
    data: {
      gwId: '00000018',
      token: 'TOKEN',
      companyId: users.companyId,
      status: 'active',
      online: false,
    },
  });
  await prisma.device.update({
    where: { id: dev.id },
    data: { gatewayId: gw.id },
  });

  const cToken = await login(app, '13800000003', users.companyAdminPassword);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${dev.id}/commands`,
    headers: bearer(cToken),
    payload: { commandType: 'unlock' },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).code, 'DEVICE_OFFLINE');
});
