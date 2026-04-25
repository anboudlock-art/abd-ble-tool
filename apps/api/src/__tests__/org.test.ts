import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '@abd/db';
import { resetDb, seedBasicUsers, login, bearer } from './helpers.js';

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

test('vendor admin can create a company, dept, team, user', async () => {
  const users = await seedBasicUsers();
  const vToken = await login(app, '13800000001', users.vendorPassword);

  // Create company
  const company = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/companies',
        headers: bearer(vToken),
        payload: { name: '电网客户A', shortCode: 'cust-a', industry: 'security' },
      })
    ).body,
  );
  assert.equal(company.shortCode, 'cust-a');

  // Create dept
  const dept = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/departments',
        headers: bearer(vToken),
        payload: { companyId: Number(company.id), name: '运维部' },
      })
    ).body,
  );
  assert.ok(dept.id);

  // Create team
  const team = JSON.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: bearer(vToken),
        payload: { departmentId: Number(dept.id), name: '一组' },
      })
    ).body,
  );

  // Create a user in that company
  const userRes = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: bearer(vToken),
    payload: {
      companyId: Number(company.id),
      phone: '13900000001',
      name: 'Operator Zhang',
      role: 'member',
      initialPassword: 'pass1234',
      teamId: Number(team.id),
    },
  });
  assert.equal(userRes.statusCode, 201);

  // The new user can log in and see only their own company
  const newToken = await login(app, '13900000001', 'pass1234');
  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/companies',
    headers: bearer(newToken),
  });
  const body = JSON.parse(list.body);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].shortCode, 'cust-a');
});

test('company admin cannot create vendor admins', async () => {
  const users = await seedBasicUsers();
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: bearer(cToken),
    payload: {
      phone: '13900000099',
      name: 'Sneaky',
      role: 'vendor_admin',
      initialPassword: 'whatever',
    },
  });
  assert.equal(res.statusCode, 403);
});

test('company admin cannot create departments in another company', async () => {
  const users = await seedBasicUsers();
  const otherCompany = await prisma.company.create({
    data: { name: 'Other', shortCode: 'other', industry: 'logistics' },
  });
  const cToken = await login(app, '13800000003', users.companyAdminPassword);

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/departments',
    headers: bearer(cToken),
    payload: { companyId: Number(otherCompany.id), name: 'evil dept' },
  });
  assert.equal(res.statusCode, 403);
});

test('add team member happy path', async () => {
  const users = await seedBasicUsers();
  const vToken = await login(app, '13800000001', users.vendorPassword);

  const dept = await prisma.department.create({
    data: { companyId: users.companyId, name: '部门 A' },
  });
  const team = await prisma.team.create({
    data: { companyId: users.companyId, departmentId: dept.id, name: '组 1' },
  });
  const member = await prisma.user.create({
    data: {
      phone: '13900000050',
      name: 'M',
      role: 'member',
      companyId: users.companyId,
    },
  });

  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${team.id}/members`,
    headers: bearer(vToken),
    payload: { userId: Number(member.id), roleInTeam: 'member' },
  });
  assert.equal(res.statusCode, 201);

  const teamRes = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${team.id}`,
    headers: bearer(vToken),
  });
  const teamBody = JSON.parse(teamRes.body);
  assert.equal(teamBody.members.length, 1);
  assert.equal(teamBody.members[0].phone, '13900000050');
});
