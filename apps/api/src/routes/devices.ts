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

  /**
   * CSV export — same filters as GET /devices, no pagination.
   * Streams in 500-row chunks so multi-thousand-device companies don't
   * blow up server memory.
   */
  typed.get(
    '/devices/export.csv',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: DeviceListQuerySchema.partial({ page: true, pageSize: true }),
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { status, modelId, ownerCompanyId, currentTeamId, search } = req.query;
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

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="devices-${new Date().toISOString().slice(0, 10)}.csv"`,
      );

      const cols = [
        'lockId',
        'bleMac',
        'imei',
        'modelCode',
        'modelName',
        'status',
        'qcStatus',
        'firmwareVersion',
        'ownerCompany',
        'currentTeamId',
        'doorLabel',
        'lat',
        'lng',
        'lastBattery',
        'lastSeenAt',
        'batchNo',
        'producedAt',
        'createdAt',
      ];

      // UTF-8 BOM so Excel auto-detects encoding
      const out: string[] = ['﻿' + cols.join(',')];

      const PAGE = 500;
      let cursor: bigint | undefined;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const rows = await prisma.device.findMany({
          where,
          include: { model: true, ownerCompany: true, batch: true },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) break;
        for (const d of rows) {
          out.push(
            [
              d.lockId,
              d.bleMac,
              d.imei ?? '',
              d.model?.code ?? '',
              d.model?.name ?? '',
              d.status,
              d.qcStatus,
              d.firmwareVersion ?? '',
              d.ownerCompany?.name ?? (d.ownerType === 'vendor' ? '厂商' : ''),
              d.currentTeamId?.toString() ?? '',
              d.doorLabel ?? '',
              d.locationLat?.toString() ?? '',
              d.locationLng?.toString() ?? '',
              d.lastBattery?.toString() ?? '',
              d.lastSeenAt?.toISOString() ?? '',
              d.batch?.batchNo ?? '',
              d.producedAt?.toISOString() ?? '',
              d.createdAt.toISOString(),
            ]
              .map(csvEscape)
              .join(','),
          );
        }
        cursor = rows[rows.length - 1]!.id;
        if (rows.length < PAGE) break;
      }
      return out.join('\n') + '\n';
    },
  );
}

function csvEscape(v: string): string {
  if (v === '') return '';
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
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
