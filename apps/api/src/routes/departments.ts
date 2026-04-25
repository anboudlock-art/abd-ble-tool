import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError, CreateDepartmentSchema, CreateTeamSchema } from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

export default async function departmentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

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
}
