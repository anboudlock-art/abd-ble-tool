import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError, CreateBatchSchema, PaginationSchema } from '@abd/shared';
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
    createdAt: b.createdAt.toISOString(),
  };
}
