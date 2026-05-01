import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma } from '@abd/db';
import {
  ApiError,
  CloseRepairSchema,
  CreateRepairIntakeSchema,
  RepairListQuerySchema,
  UpdateRepairStatusSchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';
import { assertTransition } from '../domain/device-state-machine.js';

/**
 * v2.6 §3.2 维修中库. Repair pool keeps a per-intake row that remembers
 * the device's prior_status so close-out can restore it cleanly. The
 * device row also flips to status='repairing' so it shows up in the
 * 维修中库 view and is hidden from "in stock" / "in use" queries.
 *
 *   POST /devices/:id/repair-intake        active|delivered|in_warehouse → repairing
 *   POST /repairs/:id/update-status        diagnosing / repairing / repaired / irreparable / awaiting_parts
 *   POST /repairs/:id/close                close + restore device.status (or retire)
 *   GET  /repairs                          list with filters
 *   GET  /devices/:id/repairs              per-device history
 */
export default async function repairRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // -------------------- intake --------------------

  typed.post(
    '/devices/:id/repair-intake',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'production_operator'),
      ],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: CreateRepairIntakeSchema,
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device || device.deletedAt) throw ApiError.notFound();

      // Company admins can only repair-intake their own devices.
      if (ctx.role === 'company_admin' && device.ownerCompanyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      if (device.status === 'repairing') {
        throw ApiError.conflict('Device is already in repair');
      }
      // Validate the transition into repairing.
      assertTransition(device.status, 'repairing');

      const sourceCompanyId =
        req.body.sourceCompanyId !== undefined
          ? BigInt(req.body.sourceCompanyId)
          : device.ownerCompanyId;

      const result = await prisma.$transaction(async (tx) => {
        const repair = await tx.deviceRepair.create({
          data: {
            deviceId: device.id,
            sourceCompanyId,
            priorStatus: device.status,
            faultReason: req.body.faultReason,
            notes: req.body.notes,
            intakeByUserId: ctx.userId,
          },
        });
        await tx.device.update({
          where: { id: device.id },
          data: { status: 'repairing' },
        });
        await tx.deviceTransfer.create({
          data: {
            deviceId: device.id,
            fromStatus: device.status,
            toStatus: 'repairing',
            operatorUserId: ctx.userId,
            reason: 'repair-intake',
            metadata: {
              repairId: repair.id.toString(),
              fault: req.body.faultReason.slice(0, 80),
            },
          },
        });
        return repair;
      });
      reply.code(201);
      return serialize(result);
    },
  );

  // -------------------- update status --------------------

  typed.post(
    '/repairs/:id/update-status',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'production_operator'),
      ],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateRepairStatusSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const r = await prisma.deviceRepair.findUnique({ where: { id } });
      if (!r) throw ApiError.notFound();
      if (r.closedAt) throw ApiError.conflict('Repair is closed');

      const isTerminal = req.body.status === 'repaired' || req.body.status === 'irreparable';
      const updated = await prisma.deviceRepair.update({
        where: { id },
        data: {
          status: req.body.status,
          notes: req.body.notes ?? r.notes,
          partsReplaced: (req.body.partsReplaced ?? undefined) as never,
          repairedAt: isTerminal ? new Date() : r.repairedAt,
          repairedByUserId: isTerminal ? ctx.userId : r.repairedByUserId,
        },
      });
      return serialize(updated);
    },
  );

  // -------------------- close --------------------

  typed.post(
    '/repairs/:id/close',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'production_operator'),
      ],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: CloseRepairSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const r = await prisma.deviceRepair.findUnique({
        where: { id },
        include: { device: true },
      });
      if (!r) throw ApiError.notFound();
      if (r.closedAt) throw ApiError.conflict('Already closed');
      if (r.status === 'intake' || r.status === 'diagnosing' || r.status === 'awaiting_parts') {
        throw ApiError.conflict(
          `Repair is in ${r.status}; mark it repaired or irreparable before closing`,
        );
      }

      const targetStatus = req.body.resolution === 'retire' ? 'retired' : r.priorStatus;
      // Ensure the transition is allowed by the state machine.
      assertTransition('repairing', targetStatus);

      const result = await prisma.$transaction(async (tx) => {
        const closed = await tx.deviceRepair.update({
          where: { id },
          data: {
            status: 'returned',
            closedAt: new Date(),
            notes: req.body.notes ?? r.notes,
          },
        });
        await tx.device.update({
          where: { id: r.deviceId },
          data: { status: targetStatus },
        });
        await tx.deviceTransfer.create({
          data: {
            deviceId: r.deviceId,
            fromStatus: 'repairing',
            toStatus: targetStatus,
            operatorUserId: ctx.userId,
            reason: req.body.resolution === 'retire' ? 'repair-retire' : 'repair-restore',
            metadata: { repairId: id.toString() },
          },
        });
        return closed;
      });
      return serialize(result);
    },
  );

  // -------------------- list --------------------

  typed.get(
    '/repairs',
    {
      onRequest: [app.authenticate],
      schema: { querystring: RepairListQuerySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const sc = scopeToCompany(ctx);
      const { page, pageSize, status, sourceCompanyId } = req.query;
      const where: Prisma.DeviceRepairWhereInput = {
        ...(status ? { status } : {}),
        ...(sourceCompanyId
          ? { sourceCompanyId: BigInt(sourceCompanyId) }
          : sc.companyId
            ? { sourceCompanyId: sc.companyId }
            : {}),
      };
      const [items, total] = await Promise.all([
        prisma.deviceRepair.findMany({
          where,
          orderBy: { intakeAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            device: { select: { id: true, lockId: true, bleMac: true } },
            sourceCompany: { select: { id: true, name: true } },
          },
        }),
        prisma.deviceRepair.count({ where }),
      ]);
      return {
        items: items.map((r) => ({
          ...serialize(r),
          device: {
            id: r.device.id.toString(),
            lockId: r.device.lockId,
            bleMac: r.device.bleMac,
          },
          sourceCompanyName: r.sourceCompany?.name ?? null,
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  // -------------------- per-device history --------------------

  typed.get(
    '/devices/:id/repairs',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) throw ApiError.notFound();
      const sc = scopeToCompany(ctx);
      if (sc.companyId && device.ownerCompanyId !== sc.companyId) {
        throw ApiError.forbidden();
      }
      const items = await prisma.deviceRepair.findMany({
        where: { deviceId: id },
        orderBy: { intakeAt: 'desc' },
        take: 50,
      });
      return { items: items.map(serialize) };
    },
  );
}

type Row = Prisma.DeviceRepairGetPayload<Record<string, never>>;
function serialize(r: Row) {
  return {
    id: r.id.toString(),
    ulid: r.ulid,
    deviceId: r.deviceId.toString(),
    sourceCompanyId: r.sourceCompanyId?.toString() ?? null,
    priorStatus: r.priorStatus,
    faultReason: r.faultReason,
    status: r.status,
    intakeByUserId: r.intakeByUserId?.toString() ?? null,
    repairedByUserId: r.repairedByUserId?.toString() ?? null,
    notes: r.notes,
    partsReplaced: r.partsReplaced,
    intakeAt: r.intakeAt.toISOString(),
    repairedAt: r.repairedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}
