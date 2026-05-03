import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import {
  ApiError,
  CreateDepartmentSchema,
  CreateTeamSchema,
  UpdateDepartmentSchema,
  UpdateTeamSchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

export default async function departmentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/departments',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          companyId: z.coerce.number().int().positive().optional(),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const scope = scopeToCompany(ctx);
      const companyId = scope.companyId
        ? scope.companyId
        : req.query.companyId
          ? BigInt(req.query.companyId)
          : undefined;
      if (!companyId) throw ApiError.conflict('companyId required');

      const items = await prisma.department.findMany({
        where: { companyId, deletedAt: null },
        include: {
          teams: {
            where: { deletedAt: null },
            include: { _count: { select: { memberships: true } } },
          },
        },
        orderBy: { id: 'asc' },
      });
      return {
        items: items.map((d) => ({
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

  typed.post(
    '/departments',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { body: CreateDepartmentSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { companyId, parentId, name, code } = req.body;

      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== BigInt(companyId)) {
        throw ApiError.forbidden();
      }

      const company = await prisma.company.findUnique({ where: { id: BigInt(companyId) } });
      if (!company) throw ApiError.notFound('Company not found');

      if (parentId) {
        const parent = await prisma.department.findUnique({ where: { id: BigInt(parentId) } });
        if (!parent || parent.companyId !== company.id) {
          throw ApiError.conflict('parentId does not belong to that company');
        }
      }

      const d = await prisma.department.create({
        data: {
          companyId: company.id,
          parentId: parentId ? BigInt(parentId) : null,
          name,
          code,
        },
      });
      reply.code(201);
      return { id: d.id.toString(), name: d.name, code: d.code };
    },
  );

  typed.post(
    '/teams',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin', 'dept_admin')],
      schema: { body: CreateTeamSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { departmentId, name, leaderUserId } = req.body;

      const dept = await prisma.department.findUnique({ where: { id: BigInt(departmentId) } });
      if (!dept) throw ApiError.notFound('Department not found');

      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== dept.companyId) throw ApiError.forbidden();

      if (leaderUserId) {
        const leader = await prisma.user.findUnique({ where: { id: BigInt(leaderUserId) } });
        if (!leader || leader.companyId !== dept.companyId) {
          throw ApiError.conflict('leaderUserId not in this company');
        }
      }

      const t = await prisma.team.create({
        data: {
          companyId: dept.companyId,
          departmentId: dept.id,
          name,
          leaderUserId: leaderUserId ? BigInt(leaderUserId) : null,
        },
      });
      reply.code(201);
      return { id: t.id.toString(), name: t.name };
    },
  );

  typed.get(
    '/teams/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const team = await prisma.team.findUnique({
        where: { id: BigInt(req.params.id) },
        include: {
          department: true,
          memberships: { include: { user: true } },
          _count: { select: { devices: true } },
        },
      });
      if (!team) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== team.companyId) throw ApiError.forbidden();

      return {
        id: team.id.toString(),
        name: team.name,
        leaderUserId: team.leaderUserId?.toString() ?? null,
        department: { id: team.department.id.toString(), name: team.department.name },
        members: team.memberships.map((m) => ({
          userId: m.userId.toString(),
          name: m.user.name,
          phone: m.user.phone,
          role: m.user.role,
          roleInTeam: m.roleInTeam,
        })),
        deviceCount: team._count.devices,
      };
    },
  );

  typed.put(
    '/departments/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateDepartmentSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const d = await prisma.department.findUnique({ where: { id } });
      if (!d || d.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== d.companyId) throw ApiError.forbidden();

      // Validate parent if changing
      if (req.body.parentId != null) {
        const parent = await prisma.department.findUnique({
          where: { id: BigInt(req.body.parentId) },
        });
        if (!parent || parent.companyId !== d.companyId) {
          throw ApiError.conflict('parentId must belong to the same company');
        }
        if (BigInt(req.body.parentId) === id) {
          throw ApiError.conflict('Cannot set self as parent');
        }
      }

      const updated = await prisma.department.update({
        where: { id },
        data: {
          name: req.body.name,
          code: req.body.code,
          parentId: req.body.parentId != null ? BigInt(req.body.parentId) : undefined,
        },
      });
      return {
        id: updated.id.toString(),
        name: updated.name,
        code: updated.code,
        parentId: updated.parentId?.toString() ?? null,
      };
    },
  );

  typed.delete(
    '/departments/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const d = await prisma.department.findUnique({ where: { id } });
      if (!d || d.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== d.companyId) throw ApiError.forbidden();

      const teamCount = await prisma.team.count({ where: { departmentId: id, deletedAt: null } });
      if (teamCount > 0) {
        throw ApiError.conflict(`Department still has ${teamCount} team(s); delete them first`);
      }
      const childCount = await prisma.department.count({
        where: { parentId: id, deletedAt: null },
      });
      if (childCount > 0) {
        throw ApiError.conflict(`Department has ${childCount} sub-department(s)`);
      }
      await prisma.department.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      reply.code(204);
    },
  );

  typed.put(
    '/teams/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin', 'dept_admin')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateTeamSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const t = await prisma.team.findUnique({ where: { id } });
      if (!t || t.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== t.companyId) throw ApiError.forbidden();

      if (req.body.leaderUserId != null) {
        const leader = await prisma.user.findUnique({
          where: { id: BigInt(req.body.leaderUserId) },
        });
        if (!leader || leader.companyId !== t.companyId) {
          throw ApiError.conflict('leader must be in the same company');
        }
      }

      const updated = await prisma.team.update({
        where: { id },
        data: {
          name: req.body.name,
          leaderUserId:
            req.body.leaderUserId !== undefined
              ? req.body.leaderUserId != null
                ? BigInt(req.body.leaderUserId)
                : null
              : undefined,
        },
      });
      return {
        id: updated.id.toString(),
        name: updated.name,
        leaderUserId: updated.leaderUserId?.toString() ?? null,
      };
    },
  );

  typed.delete(
    '/teams/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin', 'dept_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const t = await prisma.team.findUnique({ where: { id } });
      if (!t || t.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== t.companyId) throw ApiError.forbidden();

      const deviceCount = await prisma.device.count({ where: { currentTeamId: id, deletedAt: null } });
      if (deviceCount > 0) {
        throw ApiError.conflict(`Team still owns ${deviceCount} device(s); reassign first`);
      }
      await prisma.team.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      reply.code(204);
    },
  );
}
