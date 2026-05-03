import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@abd/db';
import { prisma } from '@abd/db';
import { AlarmListQuerySchema, ApiError } from '@abd/shared';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';

export default async function alarmRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/alarms',
    {
      onRequest: [app.authenticate],
      schema: { querystring: AlarmListQuerySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const scope = scopeToCompany(ctx);
      const { page, pageSize, status, severity, type, deviceId, since } = req.query;

      const where: Prisma.AlarmWhereInput = {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(type ? { type } : {}),
        ...(deviceId ? { deviceId: BigInt(deviceId) } : {}),
        ...(since ? { triggeredAt: { gte: new Date(since) } } : {}),
      };

      const [items, total, openCount] = await Promise.all([
        prisma.alarm.findMany({
          where,
          orderBy: { triggeredAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.alarm.count({ where }),
        prisma.alarm.count({
          where: { ...where, status: 'open' },
        }),
      ]);

      // Inline lookup of device.lockId for each alarm
      const deviceIds = Array.from(new Set(items.map((a) => a.deviceId)));
      const devices = await prisma.device.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, lockId: true, ownerCompanyId: true },
      });
      const lockIdById = new Map(devices.map((d) => [d.id.toString(), d.lockId]));

      return {
        items: items.map((a) => ({
          id: a.id.toString(),
          deviceId: a.deviceId.toString(),
          lockId: lockIdById.get(a.deviceId.toString()) ?? null,
          type: a.type,
          severity: a.severity,
          status: a.status,
          message: a.message,
          payload: a.payload,
          triggeredAt: a.triggeredAt.toISOString(),
          acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
          acknowledgedByUserId: a.acknowledgedByUserId?.toString() ?? null,
          resolvedAt: a.resolvedAt?.toISOString() ?? null,
        })),
        total,
        openCount,
        page,
        pageSize,
      };
    },
  );

  typed.post(
    '/alarms/:id/ack',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const a = await prisma.alarm.findUnique({ where: { id } });
      if (!a) throw ApiError.notFound();

      const scope = scopeToCompany(ctx);
      if (scope.companyId && a.companyId !== scope.companyId) throw ApiError.forbidden();

      const updated = await prisma.alarm.update({
        where: { id },
        data: {
          status: 'acknowledged',
          acknowledgedAt: new Date(),
          acknowledgedByUserId: ctx.userId,
        },
      });
      return {
        id: updated.id.toString(),
        status: updated.status,
        acknowledgedAt: updated.acknowledgedAt!.toISOString(),
      };
    },
  );

  typed.post(
    '/alarms/:id/resolve',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const a = await prisma.alarm.findUnique({ where: { id } });
      if (!a) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && a.companyId !== scope.companyId) throw ApiError.forbidden();

      const updated = await prisma.alarm.update({
        where: { id },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      return {
        id: updated.id.toString(),
        status: updated.status,
        resolvedAt: updated.resolvedAt!.toISOString(),
      };
    },
  );
}
