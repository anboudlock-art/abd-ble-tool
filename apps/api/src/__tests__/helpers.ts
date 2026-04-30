import { prisma } from '@abd/db';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

/**
 * Wipe all business tables between tests. Order matters for FK integrity.
 * Raw SQL is much faster than Prisma deleteMany in a loop.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      notification,
      refresh_token,
      alarm,
      webhook_delivery,
      webhook_subscription,
      integration_app,
      audit_log,
      device_command,
      lock_event,
      device_deployment,
      device_assignment,
      device_transfer,
      production_scan,
      device,
      production_batch,
      gateway_session,
      gateway,
      user_membership,
      "user",
      team,
      department,
      company,
      device_model
    RESTART IDENTITY CASCADE
  `);
}

export async function seedBasicUsers(): Promise<{
  vendorAdminId: bigint;
  vendorPassword: string;
  operatorId: bigint;
  operatorPassword: string;
  companyId: bigint;
  companyAdminId: bigint;
  companyAdminPassword: string;
}> {
  const vendorPassword = 'vendor-pass-1';
  const operatorPassword = 'operator-pass-1';
  const companyAdminPassword = 'company-pass-1';

  const vendorAdmin = await prisma.user.create({
    data: {
      phone: '13800000001',
      name: 'Vendor Admin',
      role: 'vendor_admin',
      passwordHash: await bcrypt.hash(vendorPassword, 4),
    },
  });

  const operator = await prisma.user.create({
    data: {
      phone: '13800000002',
      name: 'Production Operator',
      role: 'production_operator',
      passwordHash: await bcrypt.hash(operatorPassword, 4),
    },
  });

  const company = await prisma.company.create({
    data: { name: 'Test Co', shortCode: 'test-co', industry: 'security' },
  });

  const companyAdmin = await prisma.user.create({
    data: {
      phone: '13800000003',
      name: 'Company Admin',
      role: 'company_admin',
      companyId: company.id,
      passwordHash: await bcrypt.hash(companyAdminPassword, 4),
    },
  });

  return {
    vendorAdminId: vendorAdmin.id,
    vendorPassword,
    operatorId: operator.id,
    operatorPassword,
    companyId: company.id,
    companyAdminId: companyAdmin.id,
    companyAdminPassword,
  };
}

export async function seedDeviceModel() {
  return prisma.deviceModel.create({
    data: {
      code: 'GPS-TEST-01',
      name: 'Test GPS Lock',
      category: 'gps_lock',
      scene: 'logistics',
      hasBle: true,
      has4g: true,
      hasGps: true,
    },
  });
}

export async function login(
  app: FastifyInstance,
  phone: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { phone, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed ${res.statusCode} ${res.body}`);
  }
  return (JSON.parse(res.body) as { accessToken: string }).accessToken;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
