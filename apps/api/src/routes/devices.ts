import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@abd/db';
import { prisma } from '@abd/db';
import {
  ApiError,
  CreateTestDeviceSchema,
  DeviceListQuerySchema,
  UpdateDeviceSchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

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

  /**
   * Create a test device — bypasses the production-scan / ship / deliver
   * / assign workflow and lands the device directly in `active` (or
   * `in_warehouse` if activate=false). Vendor-admin only. Useful for
   * testing BLE / LoRa / remote-command paths without staging a full
   * fake batch.
   */
  typed.post(
    '/devices/test-create',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { body: CreateTestDeviceSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const {
        lockId,
        bleMac,
        imei,
        modelId,
        firmwareVersion,
        ownerCompanyId,
        doorLabel,
        loraE220Addr,
        loraChannel,
        gatewayId,
        activate,
      } = req.body;

      const macUpper = bleMac.toUpperCase();

      const dupLock = await prisma.device.findUnique({ where: { lockId } });
      if (dupLock) throw ApiError.conflict(`lockId ${lockId} already exists`);
      const dupMac = await prisma.device.findUnique({ where: { bleMac: macUpper } });
      if (dupMac) throw ApiError.conflict(`MAC ${macUpper} already in use`);

      const model = await prisma.deviceModel.findUnique({ where: { id: BigInt(modelId) } });
      if (!model) throw ApiError.notFound(`Device model ${modelId} not found`);

      let companyId: bigint | null = null;
      if (ownerCompanyId) {
        const company = await prisma.company.findUnique({
          where: { id: BigInt(ownerCompanyId) },
        });
        if (!company) throw ApiError.notFound(`Company ${ownerCompanyId} not found`);
        companyId = company.id;
      }

      let gw: { id: bigint; companyId: bigint | null } | null = null;
      if (gatewayId) {
        const found = await prisma.gateway.findUnique({ where: { id: BigInt(gatewayId) } });
        if (!found) throw ApiError.notFound(`Gateway ${gatewayId} not found`);
        gw = { id: found.id, companyId: found.companyId };
        if (companyId && gw.companyId && gw.companyId !== companyId) {
          throw ApiError.conflict('Gateway belongs to a different company');
        }
      }

      const status = activate ? 'active' : 'in_warehouse';
      const ownerType = companyId ? 'company' : 'vendor';

      const created = await prisma.$transaction(async (tx) => {
        const d = await tx.device.create({
          data: {
            lockId,
            bleMac: macUpper,
            imei: imei ?? null,
            modelId: model.id,
            firmwareVersion: firmwareVersion ?? null,
            qcStatus: 'passed',
            producedAt: new Date(),
            status,
            ownerType,
            ownerCompanyId: companyId,
            doorLabel: doorLabel ?? null,
            loraE220Addr: loraE220Addr ?? null,
            loraChannel: loraChannel ?? null,
            gatewayId: gw?.id ?? null,
          },
        });
        await tx.deviceTransfer.create({
          data: {
            deviceId: d.id,
            fromStatus: 'manufactured',
            toStatus: status,
            toOwnerType: ownerType,
            toOwnerId: companyId,
            operatorUserId: ctx.userId,
            reason: 'test-create',
            metadata: { gatewayId: gw?.id?.toString() ?? null },
          },
        });
        return d;
      });

      reply.code(201);
      return {
        id: created.id.toString(),
        lockId: created.lockId,
        bleMac: created.bleMac,
        imei: created.imei,
        status: created.status,
        ownerType: created.ownerType,
        ownerCompanyId: created.ownerCompanyId?.toString() ?? null,
        gatewayId: created.gatewayId?.toString() ?? null,
        loraE220Addr: created.loraE220Addr,
        loraChannel: created.loraChannel,
      };
    },
  );

  /**
   * Edit mutable device fields. Identity (lockId, bleMac) and lifecycle
   * (status, ownerCompanyId) are NOT editable via this route — those go
   * through the production / ship / deliver / assign flow.
   *
   * Vendor admins can edit any device. Company admins can edit fields
   * on devices their company owns. Note: Company admins cannot rotate
   * LoRa keys (they're set at production), so we strip those.
   */
  typed.put(
    '/devices/:id',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin'),
      ],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateDeviceSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device || device.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }

      const data: Record<string, unknown> = { ...req.body };

      // Restrict secret rotation to vendor_admin
      if (ctx.role !== 'vendor_admin') {
        delete data.loraAppKey;
        delete data.loraAppSKey;
        delete data.loraNwkSKey;
        delete data.secureChipSn;
        delete data.serverIp;
        delete data.serverPort;
      }

      // Sanity-check that gatewayId, if changed, points to an existing gateway
      // in the right company.
      if (data.gatewayId != null) {
        const gw = await prisma.gateway.findUnique({
          where: { id: BigInt(data.gatewayId as number) },
        });
        if (!gw) throw ApiError.notFound('Gateway not found');
        if (
          device.ownerCompanyId &&
          gw.companyId &&
          gw.companyId !== device.ownerCompanyId
        ) {
          throw ApiError.conflict('Gateway belongs to a different company');
        }
      }

      const updated = await prisma.device.update({
        where: { id },
        data: data as never,
      });

      return {
        id: updated.id.toString(),
        lockId: updated.lockId,
        bleMac: updated.bleMac,
        imei: updated.imei,
        firmwareVersion: updated.firmwareVersion,
        hardwareVersion: updated.hardwareVersion,
        doorLabel: updated.doorLabel,
        notes: updated.notes,
        iccid: updated.iccid,
        fourgMac: updated.fourgMac,
        loraE220Addr: updated.loraE220Addr,
        loraChannel: updated.loraChannel,
        loraDevAddr: updated.loraDevAddr,
        loraDevEui: updated.loraDevEui,
        gatewayId: updated.gatewayId?.toString() ?? null,
      };
    },
  );

  /**
   * Soft-delete a device. Allowed only when status is in
   * [manufactured, in_warehouse, returned, retired] — active fleet
   * must be retired first to keep the audit story straight.
   */
  typed.delete(
    '/devices/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device || device.deletedAt) throw ApiError.notFound();
      const allowed = ['manufactured', 'in_warehouse', 'returned', 'retired'];
      if (!allowed.includes(device.status)) {
        throw ApiError.conflict(
          `Device must be in ${allowed.join(' / ')} (current: ${device.status})`,
        );
      }
      await prisma.device.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'retired' },
      });
      reply.code(204);
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
// (Prisma model already includes the new fields via DeviceGetPayload<>)


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
    hardwareVersion: d.hardwareVersion,
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
    notes: d.notes,
    iccid: d.iccid,
    fourgMac: d.fourgMac,
    loraE220Addr: d.loraE220Addr,
    loraChannel: d.loraChannel,
    loraDevAddr: d.loraDevAddr,
    loraDevEui: d.loraDevEui,
    deployedAt: d.deployedAt?.toISOString() ?? null,
    batchId: d.batchId?.toString() ?? null,
    batchNo: d.batch?.batchNo ?? null,
    producedAt: d.producedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
