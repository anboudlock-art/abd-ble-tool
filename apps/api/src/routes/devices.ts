import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@abd/db';
import { prisma } from '@abd/db';
import { ApiError, DeviceListQuerySchema } from '@abd/shared';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';

export default async function deviceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/devices',
    {
      onRequest: [app.authenticate],
      schema: { querystring: DeviceListQuerySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize, status, modelId, ownerCompanyId, currentTeamId, search } = req.query;

      const scope = scopeToCompany(ctx);
      const where: Prisma.DeviceWhereInput = {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(modelId ? { modelId: BigInt(modelId) } : {}),
        ...(currentTeamId ? { currentTeamId: BigInt(currentTeamId) } : {}),
        ...(ownerCompanyId ? { ownerCompanyId: BigInt(ownerCompanyId) } : {}),
        ...(scope.companyId ? { ownerCompanyId: scope.companyId } : {}),
        ...(search
          ? {
              OR: [
                { lockId: { contains: search } },
                { bleMac: { contains: search.toUpperCase() } },
                { imei: { contains: search } },
                { doorLabel: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.device.findMany({
          where,
          include: { model: true, ownerCompany: true, currentTeam: true },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.device.count({ where }),
      ]);

      return {
        items: items.map(serialize),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.get(
    '/devices/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const device = await prisma.device.findUnique({
        where: { id: BigInt(req.params.id) },
        include: { model: true, ownerCompany: true, currentTeam: true, batch: true },
      });
      if (!device || device.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      return serialize(device);
    },
  );

  /**
   * Production APP's "look up before scan" endpoint — given a lockId (QR),
   * return whether the device is already registered.
   */
  typed.get(
    '/devices/lookup',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          lockId: z.string().regex(/^\d{8}$/).optional(),
          bleMac: z
            .string()
            .regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/)
            .optional(),
        }),
      },
    },
    async (req, reply) => {
      const { lockId, bleMac } = req.query;
      if (!lockId && !bleMac) throw ApiError.notFound();
      const device = await prisma.device.findFirst({
        where: {
          deletedAt: null,
          OR: [
            ...(lockId ? [{ lockId }] : []),
            ...(bleMac ? [{ bleMac: bleMac.toUpperCase() }] : []),
          ],
        },
        include: { model: true },
      });
      if (!device) {
        reply.code(404);
        return { code: 'NOT_FOUND', message: 'Device not registered yet' };
      }
      return serialize(device);
    },
  );
}

type Device = Prisma.DeviceGetPayload<Record<string, never>>;
type DeviceWithRelations = Device & {
  model?: { id: bigint; code: string; name: string } | null;
  ownerCompany?: { name: string } | null;
  currentTeam?: unknown | null;
  batch?: { batchNo: string } | null;
};

function serialize(d: DeviceWithRelations) {
  return {
    id: d.id.toString(),
    lockId: d.lockId,
    bleMac: d.bleMac,
    imei: d.imei,
    model: d.model
      ? { id: d.model.id.toString(), code: d.model.code, name: d.model.name }
      : null,
    firmwareVersion: d.firmwareVersion,
    qcStatus: d.qcStatus,
    status: d.status,
    ownerType: d.ownerType,
    ownerCompanyId: d.ownerCompanyId?.toString() ?? null,
    ownerCompanyName: d.ownerCompany?.name ?? null,
    currentTeamId: d.currentTeamId?.toString() ?? null,
    lastState: d.lastState,
    lastBattery: d.lastBattery,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    doorLabel: d.doorLabel,
    deployedAt: d.deployedAt?.toISOString() ?? null,
    batchId: d.batchId?.toString() ?? null,
    batchNo: d.batch?.batchNo ?? null,
    producedAt: d.producedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
