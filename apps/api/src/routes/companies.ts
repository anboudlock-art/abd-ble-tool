import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
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
      const { name, shortCode, industry, contactName, contactPhone } = req.body;

      if (shortCode) {
        const dup = await prisma.company.findUnique({ where: { shortCode } });
        if (dup) throw ApiError.conflict(`shortCode '${shortCode}' already in use`);
      }

      const c = await prisma.company.create({
        data: {
          name,
          shortCode,
          industry,
          contactName,
          contactPhone,
          createdByUserId: ctx.userId,
        },
      });
      reply.code(201);
      return { id: c.id.toString(), name: c.name, shortCode: c.shortCode };
    },
  );

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
