import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma, alarmFanout } from '@abd/db';
import {
  ApiError,
  ApproveTemporaryUnlockSchema,
  CreateTemporaryUnlockSchema,
  TemporaryUnlockListQuerySchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

/**
 * E + H3/H4/H5 of v2.6.
 *
 *   E1 POST /temporary-unlock          create (single device, 60/120/240/480 min)
 *   E2 GET  /temporary-unlock          my list
 *   E3 GET  /temporary-unlock/:id      detail incl. remaining seconds
 *   H3 GET  /temporary-unlock/pending  admin: emergency-first
 *   H4 POST /temporary-unlock/:id/approve  approve / reject
 *   H5 POST /temporary-unlock/:id/revoke   admin yanks an active grant early
 *
 * Approval: when status flips to `approved` we
 *   - set valid_until = approved_at + duration_minutes
 *   - create a user-scoped device_assignment with that window
 *   - record the assignment id on the unlock row
 * Auto-expiry is the worker's job (separate sweep job).
 */
export default async function temporaryUnlockRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // -------------------- E1 create --------------------

  typed.post(
    '/temporary-unlock',
    {
      onRequest: [app.authenticate],
      schema: { body: CreateTemporaryUnlockSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      if (ctx.companyId == null)
        throw ApiError.forbidden('Vendor admins do not request unlocks');

      const { deviceId, reason, durationMinutes, emergency } = req.body;
      const device = await prisma.device.findUnique({
        where: { id: BigInt(deviceId) },
      });
      if (!device || device.deletedAt) throw ApiError.notFound('Device not found');
      if (device.ownerCompanyId !== ctx.companyId) throw ApiError.forbidden();

      const created = await prisma.temporaryUnlock.create({
        data: {
          applicantUserId: ctx.userId,
          companyId: ctx.companyId,
          deviceId: device.id,
          reason,
          durationMinutes,
          emergency,
        },
      });

      // Emergency requests page admins via SMS (when configured); regular
      // requests just hit the in-app queue.
      await alarmFanout({
        companyId: ctx.companyId,
        severity: emergency ? 'critical' : 'info',
        title: emergency ? '🚨 紧急临开申请' : '临开申请',
        body: `${device.lockId} · ${durationMinutes} 分钟 · ${reason.slice(0, 60)}`,
        link: `/temporary-approvals/${created.id}`,
      });

      reply.code(201);
      return serialize(created);
    },
  );

  // -------------------- E2 list --------------------

  typed.get(
    '/temporary-unlock',
    {
      onRequest: [app.authenticate],
      schema: { querystring: TemporaryUnlockListQuerySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize, status, scope } = req.query;
      const isCompanyScope = scope === 'company';
      if (isCompanyScope) {
        if (
          ctx.role !== 'vendor_admin' &&
          ctx.role !== 'company_admin' &&
          ctx.role !== 'dept_admin'
        ) {
          throw ApiError.forbidden('company-scope listing requires admin role');
        }
      }
      const sc = scopeToCompany(ctx);
      const where: Prisma.TemporaryUnlockWhereInput = {
        ...(status ? { status } : {}),
        ...(isCompanyScope
          ? sc.companyId
            ? { companyId: sc.companyId }
            : {}
          : { applicantUserId: ctx.userId }),
      };
      const [items, total] = await Promise.all([
        prisma.temporaryUnlock.findMany({
          where,
          orderBy: [{ emergency: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.temporaryUnlock.count({ where }),
      ]);
      return {
        items: items.map(serialize),
        total,
        page,
        pageSize,
      };
    },
  );

  // -------------------- H3 pending (admin) --------------------

  typed.get(
    '/temporary-unlock/pending',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin'),
      ],
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const sc = scopeToCompany(ctx);
      const items = await prisma.temporaryUnlock.findMany({
        where: {
          status: 'pending',
          ...(sc.companyId ? { companyId: sc.companyId } : {}),
        },
        // Emergency first, then FIFO inside each tier.
        orderBy: [{ emergency: 'desc' }, { createdAt: 'asc' }],
        include: {
          applicant: { select: { id: true, name: true, phone: true } },
          device: { select: { id: true, lockId: true, doorLabel: true } },
        },
      });
      return {
        items: items.map((t) => ({
          ...serialize(t),
          applicant: {
            id: t.applicant.id.toString(),
            name: t.applicant.name,
            phone: t.applicant.phone,
          },
          device: {
            id: t.device.id.toString(),
            lockId: t.device.lockId,
            doorLabel: t.device.doorLabel,
          },
        })),
        total: items.length,
      };
    },
  );

  // -------------------- E3 detail --------------------

  typed.get(
    '/temporary-unlock/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const t = await prisma.temporaryUnlock.findUnique({
        where: { id },
        include: {
          applicant: { select: { id: true, name: true, phone: true } },
          device: { select: { id: true, lockId: true, doorLabel: true } },
        },
      });
      if (!t) throw ApiError.notFound();
      assertCanSee(ctx, t);
      return {
        ...serialize(t),
        applicant: {
          id: t.applicant.id.toString(),
          name: t.applicant.name,
          phone: t.applicant.phone,
        },
        device: {
          id: t.device.id.toString(),
          lockId: t.device.lockId,
          doorLabel: t.device.doorLabel,
        },
      };
    },
  );

  // -------------------- H4 approve / reject --------------------

  typed.post(
    '/temporary-unlock/:id/approve',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin', 'team_leader'),
      ],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: ApproveTemporaryUnlockSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const t = await prisma.temporaryUnlock.findUnique({ where: { id } });
      if (!t) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && t.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      if (t.status !== 'pending') {
        throw ApiError.conflict(`Already ${t.status}`);
      }

      const now = new Date();
      const updated = await prisma.$transaction(async (tx) => {
        if (req.body.decision === 'reject') {
          return tx.temporaryUnlock.update({
            where: { id },
            data: {
              status: 'rejected',
              decidedByUserId: ctx.userId,
              decisionNote: req.body.decisionNote,
            },
          });
        }
        // Approve: open a user-scoped grant for the requested duration.
        const validUntil = new Date(now.getTime() + t.durationMinutes * 60_000);
        const assignment = await tx.deviceAssignment.create({
          data: {
            deviceId: t.deviceId,
            companyId: t.companyId,
            scope: 'user',
            userId: t.applicantUserId,
            grantedByUserId: ctx.userId,
            validFrom: now,
            validUntil,
          },
        });
        return tx.temporaryUnlock.update({
          where: { id },
          data: {
            status: 'approved',
            approvedAt: now,
            validUntil,
            decidedByUserId: ctx.userId,
            decisionNote: req.body.decisionNote,
            assignmentId: assignment.id,
          },
        });
      });

      await alarmFanout({
        companyId: t.companyId,
        severity: 'info',
        title:
          req.body.decision === 'approve' ? '临开申请已批准' : '临开申请被拒绝',
        body: `锁 ${t.deviceId.toString()} · ${t.durationMinutes} 分钟`,
        link: `/temporary-unlock/${id}`,
      });

      return serialize(updated);
    },
  );

  // -------------------- H5 revoke (admin yanks early) --------------------

  typed.post(
    '/temporary-unlock/:id/revoke',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin'),
      ],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const t = await prisma.temporaryUnlock.findUnique({ where: { id } });
      if (!t) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && t.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      if (t.status !== 'approved') {
        throw ApiError.conflict(`Cannot revoke — current status ${t.status}`);
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (t.assignmentId) {
          await tx.deviceAssignment.update({
            where: { id: t.assignmentId },
            data: { revokedAt: new Date() },
          });
        }
        return tx.temporaryUnlock.update({
          where: { id },
          data: { status: 'revoked' },
        });
      });

      await alarmFanout({
        companyId: t.companyId,
        severity: 'info',
        title: '临开授权已被撤销',
        body: `操作员撤销了已批准的临开 — ${updated.id.toString()}`,
        link: `/temporary-unlock/${id}`,
      });
      return serialize(updated);
    },
  );
}

// ----------------------------------------------------------------------

type Row = Prisma.TemporaryUnlockGetPayload<Record<string, never>>;
function serialize(t: Row) {
  const remainingSeconds =
    t.status === 'approved' && t.validUntil
      ? Math.max(0, Math.floor((t.validUntil.getTime() - Date.now()) / 1000))
      : null;
  return {
    id: t.id.toString(),
    ulid: t.ulid,
    applicantUserId: t.applicantUserId.toString(),
    companyId: t.companyId.toString(),
    deviceId: t.deviceId.toString(),
    reason: t.reason,
    durationMinutes: t.durationMinutes,
    emergency: t.emergency,
    status: t.status,
    approvedAt: t.approvedAt?.toISOString() ?? null,
    validUntil: t.validUntil?.toISOString() ?? null,
    decidedByUserId: t.decidedByUserId?.toString() ?? null,
    decisionNote: t.decisionNote,
    assignmentId: t.assignmentId?.toString() ?? null,
    remainingSeconds,
    createdAt: t.createdAt.toISOString(),
  };
}

function assertCanSee(
  ctx: { userId: bigint; role: string; companyId: bigint | null },
  t: { applicantUserId: bigint; companyId: bigint },
) {
  if (t.applicantUserId === ctx.userId) return;
  if (
    ctx.role !== 'vendor_admin' &&
    ctx.role !== 'company_admin' &&
    ctx.role !== 'dept_admin' &&
    ctx.role !== 'team_leader'
  ) {
    throw ApiError.forbidden();
  }
  if (ctx.role !== 'vendor_admin' && t.companyId !== ctx.companyId) {
    throw ApiError.forbidden();
  }
}
