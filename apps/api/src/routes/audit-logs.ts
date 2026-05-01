import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma } from '@abd/db';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

export default async function auditLogRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Read-only listing of recent mutations recorded by the audit hook.
   *   - vendor_admin sees everything
   *   - company_admin sees rows for their company
   *   - other roles forbidden (audit data is operationally sensitive)
   */
  typed.get(
    '/audit-logs',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
          action: z.string().max(64).optional(),
          targetType: z.string().max(32).optional(),
          actorUserId: z.coerce.number().int().positive().optional(),
          since: z.string().datetime().optional(),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const scope = scopeToCompany(ctx);
      const { page, pageSize, action, targetType, actorUserId, since } = req.query;

      const where: Prisma.AuditLogWhereInput = {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(action ? { action: { contains: action } } : {}),
        ...(targetType ? { targetType } : {}),
        ...(actorUserId ? { actorUserId: BigInt(actorUserId) } : {}),
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { actor: { select: { id: true, name: true, phone: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);

      return {
        items: items.map((a) => ({
          id: a.id.toString(),
          companyId: a.companyId?.toString() ?? null,
          actor: a.actor
            ? {
                id: a.actor.id.toString(),
                name: a.actor.name,
                phone: a.actor.phone,
              }
            : null,
          actorIp: a.actorIp,
          action: a.action,
          targetType: a.targetType,
          targetId: a.targetId?.toString() ?? null,
          diff: a.diff,
          createdAt: a.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    },
  );
}
