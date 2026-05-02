import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Prisma } from '@abd/db';
import { prisma } from '@abd/db';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';

export default async function dashboardRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Lightweight summary for the home dashboard. One round-trip, role-scoped.
   *   - device counts by status
   *   - online rate (devices with lastSeenAt within 5 min) over active devices
   *   - open-alarm count by severity
   *   - last 7 days lock_event volume by day
   */
  typed.get(
    '/dashboard/summary',
    { onRequest: [app.authenticate] },
    async (req) => {
      const ctx = getAuthContext(req);
      const scope = scopeToCompany(ctx);

      const deviceWhere: Prisma.DeviceWhereInput = {
        deletedAt: null,
        ...(scope.companyId ? { ownerCompanyId: scope.companyId } : {}),
      };
      const alarmWhere: Prisma.AlarmWhereInput = {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
      };
      const eventWhere: Prisma.LockEventWhereInput = {
        ...(scope.companyId ? { companyId: scope.companyId } : {}),
      };

      const [
        statusGroups,
        totalDevices,
        activeOnline,
        activeTotal,
        openCritical,
        openWarning,
        openInfo,
        recentEventCount,
        recentDevices,
      ] = await Promise.all([
        prisma.device.groupBy({
          by: ['status'],
          where: deviceWhere,
          _count: { _all: true },
        }),
        prisma.device.count({ where: deviceWhere }),
        prisma.device.count({
          where: {
            ...deviceWhere,
            status: 'active',
            lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
          },
        }),
        prisma.device.count({ where: { ...deviceWhere, status: 'active' } }),
        prisma.alarm.count({ where: { ...alarmWhere, status: 'open', severity: 'critical' } }),
        prisma.alarm.count({ where: { ...alarmWhere, status: 'open', severity: 'warning' } }),
        prisma.alarm.count({ where: { ...alarmWhere, status: 'open', severity: 'info' } }),
        prisma.lockEvent.count({
          where: {
            ...eventWhere,
            receivedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
        // Recent devices for the "活跃设备" mini list. Prefer lastSeenAt
        // when set; fall back to updatedAt so freshly-registered devices
        // (e.g. seeds/virtual locks that haven't reported yet) still show.
        prisma.device.findMany({
          where: deviceWhere,
          orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
          take: 6,
          select: {
            id: true,
            lockId: true,
            status: true,
            lastState: true,
            lastBattery: true,
            lastSeenAt: true,
          },
        }),
      ]);

      // Per-day event histogram for the past 7 days. Done in Postgres so
      // it's one round-trip and not 7.
      type Bucket = { day: string; count: bigint };
      const histogram = scope.companyId
        ? await prisma.$queryRaw<Bucket[]>`
            SELECT to_char(date_trunc('day', received_at), 'YYYY-MM-DD') AS day,
                   COUNT(*)::bigint AS count
              FROM lock_event
             WHERE received_at >= NOW() - INTERVAL '7 days'
               AND company_id = ${scope.companyId}
             GROUP BY 1
             ORDER BY 1`
        : await prisma.$queryRaw<Bucket[]>`
            SELECT to_char(date_trunc('day', received_at), 'YYYY-MM-DD') AS day,
                   COUNT(*)::bigint AS count
              FROM lock_event
             WHERE received_at >= NOW() - INTERVAL '7 days'
             GROUP BY 1
             ORDER BY 1`;

      const byStatus: Record<string, number> = {};
      for (const g of statusGroups) byStatus[g.status] = g._count._all;

      return {
        deviceCounts: {
          total: totalDevices,
          byStatus,
        },
        online: {
          // % of active devices that have reported in the last 5 min
          active: activeTotal,
          online: activeOnline,
          rate: activeTotal > 0 ? activeOnline / activeTotal : null,
        },
        alarms: {
          open: openCritical + openWarning + openInfo,
          byCritical: openCritical,
          byWarning: openWarning,
          byInfo: openInfo,
        },
        events: {
          recent7d: recentEventCount,
          histogram: histogram.map((b) => ({ day: b.day, count: Number(b.count) })),
        },
        recentDevices: recentDevices.map((d) => ({
          id: d.id.toString(),
          lockId: d.lockId,
          status: d.status,
          lastState: d.lastState,
          lastBattery: d.lastBattery,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        })),
      };
    },
  );
}
