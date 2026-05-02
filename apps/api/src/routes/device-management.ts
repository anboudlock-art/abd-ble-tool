import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError } from '@abd/shared';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';

/**
 * Device-tree endpoint backing the /devices/manage page (v2.7 task 4).
 *
 * Returns a 3-level tree (公司 → 部门 → 班组) with rolled-up counts:
 *   - team: deviceCount + memberCount
 *   - department: sum of its teams' deviceCount
 *   - company: sum of all departments' deviceCount
 *
 * Scoping:
 *   - vendor_admin: must pass ?companyId= (no company => 400)
 *   - others: companyId is locked to the caller's own company; the query
 *     param, if any, is ignored
 */
export default async function deviceManagementRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/device-tree',
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
      const sc = scopeToCompany(ctx);
      const targetCompanyId =
        sc.companyId ?? (req.query.companyId ? BigInt(req.query.companyId) : null);
      if (targetCompanyId == null) {
        throw ApiError.conflict('companyId is required for vendor admin');
      }

      const company = await prisma.company.findUnique({
        where: { id: targetCompanyId },
        select: { id: true, name: true, deletedAt: true },
      });
      if (!company || company.deletedAt) throw ApiError.notFound('Company not found');

      // One-shot pull of departments + teams for the company. Pulling
      // counts in JS afterwards is cheaper than N+1 prisma calls.
      const [departments, deviceTeamCounts, memberCounts, unassignedCount] =
        await Promise.all([
          prisma.department.findMany({
            where: { companyId: targetCompanyId, deletedAt: null },
            select: {
              id: true,
              name: true,
              code: true,
              teams: {
                where: { deletedAt: null },
                select: { id: true, name: true },
                orderBy: { id: 'asc' },
              },
            },
            orderBy: { id: 'asc' },
          }),
          prisma.device.groupBy({
            by: ['currentTeamId'],
            where: {
              ownerCompanyId: targetCompanyId,
              deletedAt: null,
              currentTeamId: { not: null },
            },
            _count: { _all: true },
          }),
          prisma.userMembership.groupBy({
            by: ['teamId'],
            _count: { _all: true },
            where: { team: { companyId: targetCompanyId } },
          }),
          prisma.device.count({
            where: {
              ownerCompanyId: targetCompanyId,
              deletedAt: null,
              currentTeamId: null,
            },
          }),
        ]);

      const deviceByTeam = new Map(
        deviceTeamCounts.map((g) => [g.currentTeamId!.toString(), g._count._all]),
      );
      const memberByTeam = new Map(
        memberCounts.map((g) => [g.teamId.toString(), g._count._all]),
      );

      const depts = departments.map((d) => {
        const teams = d.teams.map((t) => {
          const tid = t.id.toString();
          return {
            id: tid,
            name: t.name,
            deviceCount: deviceByTeam.get(tid) ?? 0,
            memberCount: memberByTeam.get(tid) ?? 0,
          };
        });
        return {
          id: d.id.toString(),
          name: d.name,
          code: d.code,
          deviceCount: teams.reduce((s, t) => s + t.deviceCount, 0),
          teams,
        };
      });

      return {
        id: company.id.toString(),
        name: company.name,
        deviceCount:
          depts.reduce((s, d) => s + d.deviceCount, 0) + unassignedCount,
        unassignedCount,
        departments: depts,
      };
    },
  );
}
