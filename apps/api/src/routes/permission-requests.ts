import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma, alarmFanout } from '@abd/db';
import {
  ApiError,
  ApprovePermissionRequestSchema,
  CreatePermissionRequestSchema,
  PermissionRequestListQuerySchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

/**
 * D + H1/H2 of the v2.6 APP API plan.
 *
 *   D1 POST   /permission-requests              create with N device items
 *   D2 GET    /permission-requests              my list (or company list)
 *   D3 GET    /permission-requests/:id          detail with items
 *   D4 DELETE /permission-requests/:id          withdraw if pending
 *   H1 GET    /permission-requests/pending      admin: company pending
 *   H2 POST   /permission-requests/:id/approve  partial-decision endpoint
 *
 * Approval semantics (v2.6 §3.7): the approver decides per device — some
 * approved, some rejected. The aggregate status is `approved` when every
 * item is approved, `rejected` when every item is rejected, `partial` when
 * mixed. Approving an item creates a `user`-scoped device_assignment with
 * the requested validFrom/validUntil window. Withdrawing or expiring later
 * revokes those rows.
 */
export default async function permissionRequestRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // -------------------- D1 create --------------------

  typed.post(
    '/permission-requests',
    {
      onRequest: [app.authenticate],
      schema: { body: CreatePermissionRequestSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      if (ctx.companyId == null) throw ApiError.forbidden('Vendor admins do not request permissions');
      const { deviceIds, reason, validFrom, validUntil } = req.body;

      // Validate the requested window
      const vf = validFrom ? new Date(validFrom) : null;
      const vu = validUntil ? new Date(validUntil) : null;
      if (vf && vu && vf >= vu) {
        throw ApiError.conflict('validFrom must be before validUntil');
      }
      if (vu && vu < new Date()) {
        throw ApiError.conflict('validUntil is already in the past');
      }

      // All requested devices must be in the requester's company.
      const ids = deviceIds.map(BigInt);
      const devices = await prisma.device.findMany({
        where: { id: { in: ids }, deletedAt: null, ownerCompanyId: ctx.companyId },
        select: { id: true, lockId: true },
      });
      if (devices.length !== ids.length) {
        throw ApiError.conflict(
          `${ids.length - devices.length} device(s) not in your company or not found`,
        );
      }

      const created = await prisma.permissionRequest.create({
        data: {
          applicantUserId: ctx.userId,
          companyId: ctx.companyId,
          reason,
          validFrom: vf,
          validUntil: vu,
          items: {
            create: devices.map((d) => ({ deviceId: d.id })),
          },
        },
        include: { items: true },
      });

      // Notify company admins so the request shows up in their queue.
      await alarmFanout({
        companyId: ctx.companyId,
        severity: 'info',
        title: '新的开锁权限申请',
        body: `${devices.length} 台设备 — ${reason.slice(0, 60)}`,
        link: `/permission-approvals/${created.id}`,
      });

      reply.code(201);
      return serializeRequest(created);
    },
  );

  // -------------------- D2 list --------------------

  typed.get(
    '/permission-requests',
    {
      onRequest: [app.authenticate],
      schema: { querystring: PermissionRequestListQuerySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize, status, scope } = req.query;

      // Default to "mine"; "company" requires admin role.
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
      const where: Prisma.PermissionRequestWhereInput = {
        ...(status ? { status } : {}),
        ...(isCompanyScope
          ? sc.companyId
            ? { companyId: sc.companyId }
            : {}
          : { applicantUserId: ctx.userId }),
      };

      const [items, total] = await Promise.all([
        prisma.permissionRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { items: true },
        }),
        prisma.permissionRequest.count({ where }),
      ]);
      return {
        items: items.map(serializeRequest),
        total,
        page,
        pageSize,
      };
    },
  );

  // -------------------- H1 pending (admin queue) --------------------

  typed.get(
    '/permission-requests/pending',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin'),
      ],
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const sc = scopeToCompany(ctx);
      const items = await prisma.permissionRequest.findMany({
        where: {
          status: 'pending',
          ...(sc.companyId ? { companyId: sc.companyId } : {}),
        },
        orderBy: { createdAt: 'asc' }, // FIFO for admins
        include: {
          items: { include: { device: { select: { id: true, lockId: true } } } },
          applicant: { select: { id: true, name: true, phone: true } },
        },
      });
      return {
        items: items.map((r) => ({
          ...serializeRequest(r),
          applicant: {
            id: r.applicant.id.toString(),
            name: r.applicant.name,
            phone: r.applicant.phone,
          },
          devices: r.items.map((it) => ({
            deviceId: it.deviceId.toString(),
            lockId: it.device.lockId,
            status: it.status,
          })),
        })),
        total: items.length,
      };
    },
  );

  // -------------------- D3 detail --------------------

  typed.get(
    '/permission-requests/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const r = await prisma.permissionRequest.findUnique({
        where: { id },
        include: {
          items: { include: { device: { select: { id: true, lockId: true } } } },
          applicant: { select: { id: true, name: true, phone: true } },
        },
      });
      if (!r) throw ApiError.notFound();
      assertCanSeeRequest(ctx, r);
      return {
        ...serializeRequest(r),
        applicant: {
          id: r.applicant.id.toString(),
          name: r.applicant.name,
          phone: r.applicant.phone,
        },
        devices: r.items.map((it) => ({
          deviceId: it.deviceId.toString(),
          lockId: it.device.lockId,
          status: it.status,
          assignmentId: it.assignmentId?.toString() ?? null,
        })),
      };
    },
  );

  // -------------------- D4 withdraw --------------------

  typed.delete(
    '/permission-requests/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const r = await prisma.permissionRequest.findUnique({ where: { id } });
      if (!r) throw ApiError.notFound();
      // Only the applicant can withdraw, and only while still pending.
      if (r.applicantUserId !== ctx.userId) throw ApiError.forbidden();
      if (r.status !== 'pending') {
        throw ApiError.conflict(`Cannot withdraw — already ${r.status}`);
      }
      await prisma.permissionRequest.update({
        where: { id },
        data: { status: 'cancelled', decidedAt: new Date() },
      });
      reply.code(204);
    },
  );

  // -------------------- H2 approve (partial) --------------------

  typed.post(
    '/permission-requests/:id/approve',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin'),
      ],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: ApprovePermissionRequestSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const r = await prisma.permissionRequest.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!r) throw ApiError.notFound();
      assertCanDecide(ctx, r);
      if (r.status !== 'pending' && r.status !== 'partial') {
        throw ApiError.conflict(`Already ${r.status}`);
      }

      // Validate that every decision references an item on this request.
      const itemByDeviceId = new Map(
        r.items.map((it) => [it.deviceId.toString(), it] as const),
      );
      for (const d of req.body.decisions) {
        if (!itemByDeviceId.has(BigInt(d.deviceId).toString())) {
          throw ApiError.conflict(
            `device ${d.deviceId} is not part of request ${id}`,
          );
        }
      }

      const now = new Date();
      const result = await prisma.$transaction(async (tx) => {
        for (const d of req.body.decisions) {
          const item = itemByDeviceId.get(BigInt(d.deviceId).toString())!;
          if (item.status !== 'pending') continue; // skip already-decided
          if (d.decision === 'approve') {
            const created = await tx.deviceAssignment.create({
              data: {
                deviceId: item.deviceId,
                companyId: r.companyId,
                scope: 'user',
                userId: r.applicantUserId,
                grantedByUserId: ctx.userId,
                validFrom: r.validFrom,
                validUntil: r.validUntil,
              },
            });
            await tx.permissionRequestItem.update({
              where: { id: item.id },
              data: { status: 'approved', assignmentId: created.id },
            });
          } else {
            await tx.permissionRequestItem.update({
              where: { id: item.id },
              data: { status: 'rejected' },
            });
          }
        }
        // Recompute aggregate status from the fresh item rows.
        const items = await tx.permissionRequestItem.findMany({
          where: { requestId: id },
          select: { status: true },
        });
        const allApproved = items.every((i) => i.status === 'approved');
        const allRejected = items.every((i) => i.status === 'rejected');
        const stillPending = items.some((i) => i.status === 'pending');
        const aggregate = stillPending
          ? 'partial'
          : allApproved
            ? 'approved'
            : allRejected
              ? 'rejected'
              : 'partial';
        return tx.permissionRequest.update({
          where: { id },
          data: {
            status: aggregate,
            decidedByUserId: ctx.userId,
            decidedAt: now,
            decisionNote: req.body.decisionNote,
          },
          include: { items: true },
        });
      });

      // Tell the applicant the verdict (in-app only).
      await alarmFanout({
        companyId: r.companyId,
        severity: 'info',
        title: '开锁权限申请审批结果',
        body: `状态：${result.status}`,
        link: `/permission-requests/${id}`,
      });

      return serializeRequest(result);
    },
  );
}

// ----------------------------------------------------------------------

type RequestRow = Prisma.PermissionRequestGetPayload<{
  include: { items: true };
}>;
function serializeRequest(r: RequestRow) {
  return {
    id: r.id.toString(),
    ulid: r.ulid,
    applicantUserId: r.applicantUserId.toString(),
    companyId: r.companyId.toString(),
    reason: r.reason,
    validFrom: r.validFrom?.toISOString() ?? null,
    validUntil: r.validUntil?.toISOString() ?? null,
    status: r.status,
    decidedByUserId: r.decidedByUserId?.toString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    items: r.items.map((it) => ({
      deviceId: it.deviceId.toString(),
      status: it.status,
      assignmentId: it.assignmentId?.toString() ?? null,
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

function assertCanSeeRequest(
  ctx: { userId: bigint; role: string; companyId: bigint | null },
  r: { applicantUserId: bigint; companyId: bigint },
) {
  if (r.applicantUserId === ctx.userId) return; // own request
  // Otherwise admin in same company.
  if (
    ctx.role !== 'vendor_admin' &&
    ctx.role !== 'company_admin' &&
    ctx.role !== 'dept_admin'
  ) {
    throw ApiError.forbidden();
  }
  if (ctx.role !== 'vendor_admin' && r.companyId !== ctx.companyId) {
    throw ApiError.forbidden();
  }
}

function assertCanDecide(
  ctx: { role: string; companyId: bigint | null },
  r: { companyId: bigint },
) {
  if (ctx.role === 'vendor_admin') return;
  if (r.companyId !== ctx.companyId) throw ApiError.forbidden();
}
