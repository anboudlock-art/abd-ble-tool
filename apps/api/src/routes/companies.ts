import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@abd/db';
import {
  ApiError,
  CreateCompanySchema,
  PaginationSchema,
  UpdateCompanySchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

export default async function companyRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/companies',
    {
      onRequest: [app.authenticate],
      schema: { querystring: PaginationSchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize } = req.query;
      const scope = scopeToCompany(ctx);
      // Non-vendor admins can only see their own company
      const where = scope.companyId ? { id: scope.companyId, deletedAt: null } : { deletedAt: null };

      const [items, total] = await Promise.all([
        prisma.company.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            _count: {
              select: { devices: true, departments: true, users: true },
            },
          },
        }),
        prisma.company.count({ where }),
      ]);

      return {
        items: items.map((c) => ({
          id: c.id.toString(),
          name: c.name,
          shortCode: c.shortCode,
          industry: c.industry,
          contactName: c.contactName,
          contactPhone: c.contactPhone,
          status: c.status,
          plan: c.plan,
          maxDevices: c.maxDevices,
          deviceCount: c._count.devices,
          departmentCount: c._count.departments,
          userCount: c._count.users,
          createdAt: c.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.post(
    '/companies',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { body: CreateCompanySchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const {
        name,
        shortCode,
        industry,
        contactName,
        contactPhone,
        adminPhone,
        adminName,
        adminPassword,
      } = req.body;

      if (shortCode) {
        const dup = await prisma.company.findUnique({ where: { shortCode } });
        if (dup) throw ApiError.conflict(`shortCode '${shortCode}' already in use`);
      }
      // Pre-flight phone check so we don't half-create a company and then
      // fail on the user.
      if (adminPhone) {
        const dupUser = await prisma.user.findUnique({ where: { phone: adminPhone } });
        if (dupUser) {
          throw ApiError.conflict(`Phone ${adminPhone} already registered`);
        }
      }

      const tempPassword = adminPhone
        ? adminPassword?.trim() || generateTempPassword()
        : null;

      const result = await prisma.$transaction(async (tx) => {
        const c = await tx.company.create({
          data: {
            name,
            shortCode,
            industry,
            contactName,
            contactPhone,
            createdByUserId: ctx.userId,
          },
        });

        let admin: { id: bigint; name: string; phone: string } | null = null;
        if (adminPhone && tempPassword) {
          const hash = await bcrypt.hash(tempPassword, 12);
          const u = await tx.user.create({
            data: {
              companyId: c.id,
              phone: adminPhone,
              name: adminName ?? `${name} 管理员`,
              role: 'company_admin',
              passwordHash: hash,
              status: 'active',
              mustChangePassword: true,
            },
          });
          admin = { id: u.id, name: u.name, phone: u.phone };
        }
        return { c, admin };
      });

      reply.code(201);
      return {
        id: result.c.id.toString(),
        name: result.c.name,
        shortCode: result.c.shortCode,
        // Returned ONCE so the vendor can pass it on to the customer.
        // First-login flow will force a change so the temp value is
        // single-use anyway.
        adminAccount: result.admin
          ? {
              id: result.admin.id.toString(),
              name: result.admin.name,
              phone: result.admin.phone,
              initialPassword: tempPassword!,
            }
          : null,
      };
    },
  );

  /** Same temp-password generator used by /users — duplicated here to keep
   *  companies.ts self-contained. Moves once we have a shared util module. */
  function generateTempPassword(): string {
    const digits = '0123456789';
    const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
    const symbols = '!@#$';
    const pick = (alphabet: string, n: number) =>
      Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');
    const raw = pick(digits, 4) + pick(letters, 4) + pick(symbols, 2);
    return raw.split('').sort(() => randomInt(2) - 0.5).join('');
  }

  typed.get(
    '/companies/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== id) throw ApiError.forbidden();

      const c = await prisma.company.findUnique({
        where: { id },
        include: {
          departments: {
            where: { deletedAt: null },
            include: {
              teams: { where: { deletedAt: null }, include: { _count: { select: { memberships: true } } } },
            },
            orderBy: { id: 'asc' },
          },
          _count: { select: { devices: true, users: true } },
        },
      });
      if (!c) throw ApiError.notFound();

      return {
        id: c.id.toString(),
        name: c.name,
        shortCode: c.shortCode,
        industry: c.industry,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        status: c.status,
        plan: c.plan,
        deviceCount: c._count.devices,
        userCount: c._count.users,
        departments: c.departments.map((d) => ({
          id: d.id.toString(),
          name: d.name,
          code: d.code,
          parentId: d.parentId?.toString() ?? null,
          teams: d.teams.map((t) => ({
            id: t.id.toString(),
            name: t.name,
            leaderUserId: t.leaderUserId?.toString() ?? null,
            memberCount: t._count.memberships,
          })),
        })),
      };
    },
  );

  typed.put(
    '/companies/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateCompanySchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      if (ctx.role === 'company_admin' && ctx.companyId !== id) {
        throw ApiError.forbidden();
      }
      const c = await prisma.company.findUnique({ where: { id } });
      if (!c || c.deletedAt) throw ApiError.notFound();

      // Only vendor_admin can change company status / plan / quota
      const data: Record<string, unknown> = { ...req.body };
      if (ctx.role !== 'vendor_admin') {
        delete data.status;
        delete data.maxDevices;
      }

      const updated = await prisma.company.update({
        where: { id },
        data: data as never,
      });
      return {
        id: updated.id.toString(),
        name: updated.name,
        shortCode: updated.shortCode,
        industry: updated.industry,
        status: updated.status,
      };
    },
  );

  /** Soft-delete a company. Refuses if any non-deleted devices remain. */
  typed.delete(
    '/companies/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const id = BigInt(req.params.id);
      const c = await prisma.company.findUnique({ where: { id } });
      if (!c || c.deletedAt) throw ApiError.notFound();

      const liveDevices = await prisma.device.count({
        where: { ownerCompanyId: id, deletedAt: null },
      });
      if (liveDevices > 0) {
        throw ApiError.conflict(
          `Company still owns ${liveDevices} active device(s); transfer or retire them first`,
        );
      }
      await prisma.company.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'suspended' },
      });
      reply.code(204);
    },
  );
}
