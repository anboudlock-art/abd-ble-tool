import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import {
  ApiError,
  CreateBatchSchema,
  PaginationSchema,
  UpdateBatchSchema,
} from '@abd/shared';
import { getAuthContext, requireRole } from '../lib/auth.js';

export default async function productionBatchRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/production/batches',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'production_operator')],
      schema: { querystring: PaginationSchema },
    },
    async (req) => {
      const { page, pageSize } = req.query;
      const [items, total] = await Promise.all([
        prisma.productionBatch.findMany({
          include: { model: true, _count: { select: { devices: true, scans: true } } },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.productionBatch.count(),
      ]);
      return {
        items: items.map(serialize),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.post(
    '/production/batches',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { body: CreateBatchSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { batchNo, modelId, quantity, producedAt, remark } = req.body;

      const model = await prisma.deviceModel.findUnique({ where: { id: BigInt(modelId) } });
      if (!model) throw ApiError.notFound(`Device model ${modelId} not found`);

      const existing = await prisma.productionBatch.findUnique({ where: { batchNo } });
      if (existing) throw ApiError.conflict(`Batch ${batchNo} already exists`);

      const batch = await prisma.productionBatch.create({
        data: {
          batchNo,
          modelId: BigInt(modelId),
          quantity,
          producedAt: producedAt ? new Date(producedAt) : undefined,
          remark,
          operatorUserId: ctx.userId,
        },
        include: { model: true, _count: { select: { devices: true, scans: true } } },
      });
      reply.code(201);
      return serialize(batch);
    },
  );

  typed.get(
    '/production/batches/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'production_operator')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const batch = await prisma.productionBatch.findUnique({
        where: { id: BigInt(req.params.id) },
        include: { model: true, _count: { select: { devices: true, scans: true } } },
      });
      if (!batch) throw ApiError.notFound();
      return serialize(batch);
    },
  );

  typed.put(
    '/production/batches/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateBatchSchema,
      },
    },
    async (req) => {
      const id = BigInt(req.params.id);
      const b = await prisma.productionBatch.findUnique({ where: { id } });
      if (!b) throw ApiError.notFound();

      // Refuse shrinking below already-produced count
      if (req.body.quantity != null && req.body.quantity < b.producedCount) {
        throw ApiError.conflict(
          `quantity (${req.body.quantity}) cannot be less than already-produced count (${b.producedCount})`,
        );
      }

      const updated = await prisma.productionBatch.update({
        where: { id },
        data: { remark: req.body.remark, quantity: req.body.quantity },
        include: {
          model: true,
          _count: { select: { devices: true, scans: true } },
        },
      });
      return serialize(updated);
    },
  );

  typed.delete(
    '/production/batches/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const id = BigInt(req.params.id);
      const b = await prisma.productionBatch.findUnique({
        where: { id },
        include: { _count: { select: { devices: true, scans: true } } },
      });
      if (!b) throw ApiError.notFound();
      if (b._count.devices > 0) {
        throw ApiError.conflict(
          `Batch has ${b._count.devices} device(s); reassign or delete them first`,
        );
      }
      // Delete dependent scans first if any
      if (b._count.scans > 0) {
        await prisma.productionScan.deleteMany({ where: { batchId: id } });
      }
      await prisma.productionBatch.delete({ where: { id } });
      reply.code(204);
    },
  );

  /**
   * Mark a batch completed. Locks further scans and stamps the actor.
   * Idempotent: re-completing a finished batch returns 200 with the
   * existing completedAt.
   */
  typed.post(
    '/production/batches/:id/complete',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const b = await prisma.productionBatch.findUnique({
        where: { id },
        include: { model: true, _count: { select: { devices: true, scans: true } } },
      });
      if (!b) throw ApiError.notFound();
      if (b.completedAt) {
        return serialize(b);
      }
      const updated = await prisma.productionBatch.update({
        where: { id },
        data: {
          completedAt: new Date(),
          completedByUserId: ctx.userId,
        },
        include: { model: true, _count: { select: { devices: true, scans: true } } },
      });
      return serialize(updated);
    },
  );

  typed.post(
    '/production/batches/:id/reopen',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const id = BigInt(req.params.id);
      const b = await prisma.productionBatch.findUnique({ where: { id } });
      if (!b) throw ApiError.notFound();
      if (!b.completedAt) throw ApiError.conflict('Batch is not completed');
      const updated = await prisma.productionBatch.update({
        where: { id },
        data: { completedAt: null, completedByUserId: null },
        include: { model: true, _count: { select: { devices: true, scans: true } } },
      });
      return serialize(updated);
    },
  );

  /**
   * A2: list pre-generated lock numbers in a batch — used by the APP
   * to drive the "scan QR → confirm" registration flow, and by the PC
   * end to render the printable label list.
   */
  typed.get(
    '/production/batches/:id/lock-numbers',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: z.object({
          status: z.enum(['reserved', 'registered', 'voided']).optional(),
        }),
      },
    },
    async (req) => {
      const id = BigInt(req.params.id);
      const b = await prisma.productionBatch.findUnique({ where: { id } });
      if (!b) throw ApiError.notFound('Batch not found');
      const items = await prisma.lockNumber.findMany({
        where: { batchId: id, ...(req.query.status ? { status: req.query.status } : {}) },
        orderBy: { lockId: 'asc' },
      });
      return {
        batchId: b.id.toString(),
        batchNo: b.batchNo,
        items: items.map((ln) => ({
          id: ln.id.toString(),
          lockId: ln.lockId,
          status: ln.status,
          deviceId: ln.deviceId?.toString() ?? null,
          createdAt: ln.createdAt.toISOString(),
          registeredAt: ln.registeredAt?.toISOString() ?? null,
        })),
        total: items.length,
      };
    },
  );
}

type BatchWithRelations = Awaited<ReturnType<typeof prisma.productionBatch.findMany>>[number] & {
  model: Awaited<ReturnType<typeof prisma.deviceModel.findUnique>>;
  _count: { devices: number; scans: number };
};

function serialize(b: BatchWithRelations) {
  return {
    id: b.id.toString(),
    batchNo: b.batchNo,
    modelId: b.modelId.toString(),
    modelCode: b.model?.code ?? null,
    modelName: b.model?.name ?? null,
    quantity: b.quantity,
    producedCount: b.producedCount,
    scannedCount: b._count.scans,
    actualDeviceCount: b._count.devices,
    producedAt: b.producedAt?.toISOString() ?? null,
    remark: b.remark,
    completedAt: b.completedAt?.toISOString() ?? null,
    completedByUserId: b.completedByUserId?.toString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}
