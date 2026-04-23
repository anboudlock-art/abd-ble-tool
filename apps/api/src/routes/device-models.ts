import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError, CreateDeviceModelSchema } from '@abd/shared';
import { requireRole } from '../lib/auth.js';

export default async function deviceModelRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/device-models',
    { onRequest: [app.authenticate] },
    async () => {
      const models = await prisma.deviceModel.findMany({ orderBy: { code: 'asc' } });
      return { items: models.map(serialize) };
    },
  );

  typed.post(
    '/device-models',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { body: CreateDeviceModelSchema },
    },
    async (req, reply) => {
      const existing = await prisma.deviceModel.findUnique({ where: { code: req.body.code } });
      if (existing) throw ApiError.conflict(`Device model '${req.body.code}' already exists`);

      const model = await prisma.deviceModel.create({
        data: {
          ...req.body,
          capabilitiesJson: (req.body.capabilitiesJson as object | undefined) ?? undefined,
        },
      });
      reply.code(201);
      return serialize(model);
    },
  );

  typed.get(
    '/device-models/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const model = await prisma.deviceModel.findUnique({ where: { id: BigInt(req.params.id) } });
      if (!model) throw ApiError.notFound();
      return serialize(model);
    },
  );
}

type Model = Awaited<ReturnType<typeof prisma.deviceModel.findMany>>[number];
function serialize(m: Model) {
  return {
    id: m.id.toString(),
    code: m.code,
    name: m.name,
    category: m.category,
    scene: m.scene,
    hasBle: m.hasBle,
    has4g: m.has4g,
    hasGps: m.hasGps,
    hasLora: m.hasLora,
    firmwareDefault: m.firmwareDefault,
    capabilitiesJson: m.capabilitiesJson,
  };
}
