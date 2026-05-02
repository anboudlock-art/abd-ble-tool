import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@abd/db';
import { prisma } from '@abd/db';
import {
  ApiError,
  BulkAuthorizeSchema,
  CreateTestDeviceSchema,
  DeployDeviceSchema,
  DeviceListQuerySchema,
  UpdateDeviceSchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';
import { assertTransition } from '../domain/device-state-machine.js';

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
      const {
        page,
        pageSize,
        status,
        modelId,
        ownerCompanyId,
        currentTeamId,
        currentDepartmentId,
        batchId,
        search,
      } = req.query;

      const scope = scopeToCompany(ctx);
      const where: Prisma.DeviceWhereInput = {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(modelId ? { modelId: BigInt(modelId) } : {}),
        ...(currentTeamId ? { currentTeamId: BigInt(currentTeamId) } : {}),
        ...(currentDepartmentId
          ? { currentTeam: { departmentId: BigInt(currentDepartmentId) } }
          : {}),
        ...(batchId ? { batchId: BigInt(batchId) } : {}),
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
          include: {
            model: true,
            ownerCompany: true,
            currentTeam: true,
            gateway: { select: { online: true } },
          },
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
        include: {
          model: true,
          ownerCompany: true,
          currentTeam: true,
          batch: true,
          gateway: { select: { online: true } },
        },
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
      const {
        status,
        modelId,
        ownerCompanyId,
        currentTeamId,
        currentDepartmentId,
        batchId,
        search,
      } = req.query;
      const scope = scopeToCompany(ctx);

      const where: Prisma.DeviceWhereInput = {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(modelId ? { modelId: BigInt(modelId) } : {}),
        ...(currentTeamId ? { currentTeamId: BigInt(currentTeamId) } : {}),
        ...(currentDepartmentId
          ? { currentTeam: { departmentId: BigInt(currentDepartmentId) } }
          : {}),
        ...(batchId ? { batchId: BigInt(batchId) } : {}),
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

  /**
   * Field deployment — operator on-site marks a device as installed at a
   * physical location. Transitions: assigned → active.
   */
  typed.post(
    '/devices/:id/deploy',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: DeployDeviceSchema,
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device || device.deletedAt) throw ApiError.notFound();

      // Company scoping (vendor_admin bypasses).
      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      // Only roles that operate physical hardware should be deploying.
      if (
        ctx.role !== 'vendor_admin' &&
        ctx.role !== 'company_admin' &&
        ctx.role !== 'dept_admin' &&
        ctx.role !== 'team_leader' &&
        ctx.role !== 'member' &&
        ctx.role !== 'production_operator'
      ) {
        throw ApiError.forbidden();
      }

      // Allow re-deploying an already-active device (relocations) without
      // bouncing through assigned again.
      if (device.status !== 'assigned' && device.status !== 'active') {
        throw ApiError.conflict(
          `Device must be assigned/active to deploy (current: ${device.status})`,
        );
      }

      const { lat, lng, accuracyM, doorLabel, photoUrls, teamId } = req.body;
      const targetTeamId = teamId ? BigInt(teamId) : device.currentTeamId;
      if (targetTeamId) {
        const t = await prisma.team.findUnique({ where: { id: targetTeamId } });
        if (!t) throw ApiError.notFound('Team not found');
        if (scope.companyId && t.companyId !== scope.companyId) {
          throw ApiError.forbidden();
        }
      }

      const now = new Date();
      const updated = await prisma.$transaction(async (tx) => {
        if (device.status === 'assigned') assertTransition('assigned', 'active');
        const u = await tx.device.update({
          where: { id },
          data: {
            status: 'active',
            locationLat: lat,
            locationLng: lng,
            locationAccuracyM: accuracyM ?? null,
            doorLabel: doorLabel ?? device.doorLabel,
            deployedAt: now,
            deployedByUserId: ctx.userId,
          },
        });
        await tx.deviceDeployment.create({
          data: {
            deviceId: id,
            operatorUserId: ctx.userId,
            teamId: targetTeamId,
            lat,
            lng,
            accuracyM,
            doorLabel,
            photoUrls: photoUrls as never,
            deployedAt: now,
          },
        });
        if (device.status === 'assigned') {
          await tx.deviceTransfer.create({
            data: {
              deviceId: id,
              fromStatus: 'assigned',
              toStatus: 'active',
              operatorUserId: ctx.userId,
              reason: 'deploy',
              metadata: { lat, lng, doorLabel: doorLabel ?? null },
            },
          });
        }
        return u;
      });

      reply.code(200);
      return {
        id: updated.id.toString(),
        status: updated.status,
        deployedAt: updated.deployedAt?.toISOString() ?? null,
        locationLat: updated.locationLat?.toString() ?? null,
        locationLng: updated.locationLng?.toString() ?? null,
        doorLabel: updated.doorLabel,
      };
    },
  );

  /**
   * Latest assignment for a device — returns the most recent non-revoked
   * assignment row, with the team / user it points to. Used by the device
   * detail page to show "currently authorised: 张三 (工程班 1 组)".
   */
  typed.get(
    '/devices/:id/assignment',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      const a = await prisma.deviceAssignment.findFirst({
        where: { deviceId: id, revokedAt: null },
        orderBy: { id: 'desc' },
        include: {
          team: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, phone: true } },
        },
      });
      if (!a) return { current: null };
      return {
        current: {
          id: a.id.toString(),
          scope: a.scope,
          teamId: a.teamId?.toString() ?? null,
          teamName: a.team?.name ?? null,
          userId: a.userId?.toString() ?? null,
          userName: a.user?.name ?? null,
          userPhone: a.user?.phone ?? null,
          validFrom: a.validFrom?.toISOString() ?? null,
          validUntil: a.validUntil?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        },
      };
    },
  );

  /**
   * v2.6 §3.6 授权管理. List all device_assignment rows in the caller's
   * scope, computing one of:
   *   active   — no validUntil, or validUntil in the future
   *   expiring — validUntil within the next 7 days
   *   expired  — validUntil already in the past
   *   revoked  — revokedAt set
   * Filtered server-side by `state` query.
   */
  typed.get(
    '/authorizations',
    {
      // Management view — never exposed to plain members. Admin roles only.
      // scopeToCompany() below also filters by companyId so a company_admin
      // can only see their own company's authorizations, never anyone else's.
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin', 'team_leader'),
      ],
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(50),
          state: z.enum(['active', 'expiring', 'expired', 'revoked']).optional(),
          deviceId: z.coerce.number().int().positive().optional(),
          userId: z.coerce.number().int().positive().optional(),
          teamId: z.coerce.number().int().positive().optional(),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const sc = scopeToCompany(ctx);
      const { page, pageSize, state, deviceId, userId, teamId } = req.query;
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

      const where: Prisma.DeviceAssignmentWhereInput = {
        ...(sc.companyId ? { companyId: sc.companyId } : {}),
        ...(deviceId ? { deviceId: BigInt(deviceId) } : {}),
        ...(userId ? { userId: BigInt(userId) } : {}),
        ...(teamId ? { teamId: BigInt(teamId) } : {}),
      };

      if (state === 'revoked') {
        where.revokedAt = { not: null };
      } else if (state === 'expired') {
        where.revokedAt = null;
        where.validUntil = { lte: now };
      } else if (state === 'expiring') {
        where.revokedAt = null;
        where.validUntil = { gt: now, lte: soon };
      } else if (state === 'active') {
        where.revokedAt = null;
        where.OR = [{ validUntil: null }, { validUntil: { gt: now } }];
      }

      const [items, total] = await Promise.all([
        prisma.deviceAssignment.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            device: { select: { id: true, lockId: true, doorLabel: true } },
            team: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, phone: true } },
          },
        }),
        prisma.deviceAssignment.count({ where }),
      ]);

      const computeState = (
        a: { revokedAt: Date | null; validUntil: Date | null },
      ): 'active' | 'expiring' | 'expired' | 'revoked' => {
        if (a.revokedAt) return 'revoked';
        if (!a.validUntil) return 'active';
        if (a.validUntil <= now) return 'expired';
        if (a.validUntil <= soon) return 'expiring';
        return 'active';
      };

      return {
        items: items.map((a) => ({
          id: a.id.toString(),
          deviceId: a.device.id.toString(),
          lockId: a.device.lockId,
          doorLabel: a.device.doorLabel,
          scope: a.scope,
          teamId: a.team?.id.toString() ?? null,
          teamName: a.team?.name ?? null,
          userId: a.user?.id.toString() ?? null,
          userName: a.user?.name ?? null,
          userPhone: a.user?.phone ?? null,
          validFrom: a.validFrom?.toISOString() ?? null,
          validUntil: a.validUntil?.toISOString() ?? null,
          revokedAt: a.revokedAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          state: computeState(a),
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  /**
   * v2.7 QA P0: bulk N×M authorisation (deviceIds × userIds → one
   * user-scope device_assignment per pair).
   *
   * Existing open user-scope grants for the same (device, user) pair
   * are revoked first so calling this with overlapping inputs just
   * "extends" or "shifts" the validity window cleanly. Team-scope
   * rows are left untouched — they're a different broader grant the
   * admin may have intentionally set up.
   *
   * For the simpler "single team" case the existing
   * POST /devices/assign is more ergonomic and does the same thing
   * for a team-scope grant. This endpoint is for the picker UX
   * where the admin selected N devices and M people on a single
   * page and wants one-shot N×M.
   */
  typed.post(
    '/authorizations',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin'),
      ],
      schema: { body: BulkAuthorizeSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { deviceIds, userIds, validFrom, validUntil, reason } = req.body;

      const vf = validFrom ? new Date(validFrom) : null;
      const vu = validUntil ? new Date(validUntil) : null;
      if (vf && vu && vf >= vu) {
        throw ApiError.badRequest('validFrom must be before validUntil');
      }
      if (vu && vu < new Date()) {
        throw ApiError.badRequest('validUntil is already in the past');
      }

      const dIds = deviceIds.map((n) => BigInt(n));
      const uIds = userIds.map((n) => BigInt(n));

      const scope = scopeToCompany(ctx);
      // Devices: must exist + belong to caller's company scope.
      const devices = await prisma.device.findMany({
        where: {
          id: { in: dIds },
          deletedAt: null,
          ...(scope.companyId ? { ownerCompanyId: scope.companyId } : {}),
        },
        select: { id: true, ownerCompanyId: true, lockId: true },
      });
      if (devices.length !== dIds.length) {
        throw ApiError.conflict(
          `${dIds.length - devices.length} device(s) not found or out of scope`,
        );
      }
      // Devices may legitimately span multiple companies for a vendor
      // admin, but for company/dept admin everything must be in the
      // caller's own company; scope filter above already enforces that.

      // Users: must exist + share a company with the device they're
      // being granted on. We pre-fetch them all and pair-match below.
      const users = await prisma.user.findMany({
        where: {
          id: { in: uIds },
          deletedAt: null,
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
        },
        select: { id: true, companyId: true, name: true, phone: true },
      });
      if (users.length !== uIds.length) {
        throw ApiError.conflict(
          `${uIds.length - users.length} user(s) not found or out of scope`,
        );
      }
      const userById = new Map(users.map((u) => [u.id.toString(), u]));

      const now = new Date();
      const result = await prisma.$transaction(async (tx) => {
        const created: Array<{
          id: bigint;
          deviceId: bigint;
          userId: bigint;
        }> = [];
        let revokedCount = 0;

        for (const device of devices) {
          for (const userId of uIds) {
            const user = userById.get(userId.toString())!;
            // Cross-company check: device must belong to the user's
            // company. Vendor admins might mix devices across
            // companies; in that case skip pairs that don't match
            // rather than throwing — the response surfaces the count.
            if (device.ownerCompanyId !== user.companyId) {
              continue;
            }
            // Revoke any open user-scope grant for this (device, user)
            // so re-granting is idempotent (updates the window).
            const revoked = await tx.deviceAssignment.updateMany({
              where: {
                deviceId: device.id,
                userId,
                scope: 'user',
                revokedAt: null,
              },
              data: { revokedAt: now },
            });
            revokedCount += revoked.count;
            const a = await tx.deviceAssignment.create({
              data: {
                deviceId: device.id,
                companyId: user.companyId!,
                scope: 'user',
                userId,
                grantedByUserId: ctx.userId,
                validFrom: vf,
                validUntil: vu,
              },
            });
            created.push({ id: a.id, deviceId: device.id, userId });
          }
        }
        return { created, revokedCount };
      });

      reply.code(201);
      return {
        createdCount: result.created.length,
        revokedCount: result.revokedCount,
        skippedCount:
          devices.length * uIds.length - result.created.length,
        items: result.created.map((c) => ({
          id: c.id.toString(),
          deviceId: c.deviceId.toString(),
          userId: c.userId.toString(),
        })),
        reason: reason ?? null,
        validFrom: vf?.toISOString() ?? null,
        validUntil: vu?.toISOString() ?? null,
      };
    },
  );

  /** Revoke a single device_assignment row. company_admin scope. */
  typed.post(
    '/authorizations/:id/revoke',
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
      const a = await prisma.deviceAssignment.findUnique({ where: { id } });
      if (!a) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && a.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      if (a.revokedAt) throw ApiError.conflict('Already revoked');
      const updated = await prisma.deviceAssignment.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      return { id: updated.id.toString(), revokedAt: updated.revokedAt!.toISOString() };
    },
  );

  /** APP convenience: device current state (last reported) + battery. */
  typed.get(
    '/devices/:id/status',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const d = await prisma.device.findUnique({
        where: { id },
        select: {
          id: true,
          lockId: true,
          status: true,
          lastState: true,
          lastBattery: true,
          lastSeenAt: true,
          ownerCompanyId: true,
          gatewayId: true,
          gateway: { select: { online: true } },
        },
      });
      if (!d) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && d.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      return {
        id: d.id.toString(),
        lockId: d.lockId,
        status: d.status,
        lastState: d.lastState,
        lastBattery: d.lastBattery,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        gatewayOnline: d.gateway?.online ?? null,
      };
    },
  );

  /** Latest deployment for the device — place + photos + when. */
  typed.get(
    '/devices/:id/deployment',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const d = await prisma.device.findUnique({ where: { id } });
      if (!d) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && d.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      const dep = await prisma.deviceDeployment.findFirst({
        where: { deviceId: id },
        orderBy: { deployedAt: 'desc' },
        include: { team: { select: { id: true, name: true } } },
      });
      if (!dep) return { current: null };
      return {
        current: {
          id: dep.id.toString(),
          deviceId: dep.deviceId.toString(),
          lat: dep.lat?.toString() ?? null,
          lng: dep.lng?.toString() ?? null,
          accuracyM: dep.accuracyM,
          doorLabel: dep.doorLabel,
          photoUrls: dep.photoUrls,
          teamId: dep.team?.id.toString() ?? null,
          teamName: dep.team?.name ?? null,
          deployedAt: dep.deployedAt.toISOString(),
          operatorUserId: dep.operatorUserId.toString(),
        },
      };
    },
  );

  /** A3: bind/补绑 MAC + IMEI on a device that was registered without them
   *  (e.g. lock id created but BLE failed at register time). */
  typed.post(
    '/devices/:id/bind',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({
          bleMac: z
            .string()
            .regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/)
            .optional(),
          imei: z.string().regex(/^\d{15}$/).optional(),
          firmwareVersion: z.string().max(32).optional(),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const d = await prisma.device.findUnique({ where: { id } });
      if (!d || d.deletedAt) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && d.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      // Anyone who can see the device can finish its binding (factory line +
      // company admin + operator). No role gate beyond visibility.

      const { bleMac, imei, firmwareVersion } = req.body;
      if (!bleMac && !imei && !firmwareVersion) {
        throw ApiError.conflict('Nothing to bind');
      }

      // Uniqueness checks for non-null incoming values.
      if (bleMac) {
        const dup = await prisma.device.findFirst({
          where: { bleMac, NOT: { id } },
          select: { id: true },
        });
        if (dup) throw ApiError.conflict(`MAC ${bleMac} already bound to another device`);
      }
      if (imei) {
        const dup = await prisma.device.findFirst({
          where: { imei, NOT: { id } },
          select: { id: true },
        });
        if (dup) throw ApiError.conflict(`IMEI ${imei} already bound to another device`);
      }

      const updated = await prisma.device.update({
        where: { id },
        data: {
          ...(bleMac ? { bleMac } : {}),
          ...(imei ? { imei } : {}),
          ...(firmwareVersion ? { firmwareVersion } : {}),
        },
      });
      return {
        id: updated.id.toString(),
        lockId: updated.lockId,
        bleMac: updated.bleMac,
        imei: updated.imei,
        firmwareVersion: updated.firmwareVersion,
      };
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
  model?: {
    id: bigint;
    code: string;
    name: string;
    /** v2.8 Ask 7: capabilities for the APP to render per-device buttons. */
    category?: string | null;
    hasBle?: boolean;
    has4g?: boolean;
    hasGps?: boolean;
    hasLora?: boolean;
    capabilitiesJson?: unknown;
  } | null;
  ownerCompany?: { name: string } | null;
  currentTeam?: unknown | null;
  batch?: { batchNo: string } | null;
  gateway?: { online: boolean } | null;
};
// (Prisma model already includes the new fields via DeviceGetPayload<>)


function serialize(d: DeviceWithRelations) {
  return {
    id: d.id.toString(),
    lockId: d.lockId,
    bleMac: d.bleMac,
    imei: d.imei,
    model: d.model
      ? {
          id: d.model.id.toString(),
          code: d.model.code,
          name: d.model.name,
          category: d.model.category ?? null,
          hasBle: d.model.hasBle ?? null,
          has4g: d.model.has4g ?? null,
          hasGps: d.model.hasGps ?? null,
          hasLora: d.model.hasLora ?? null,
          capabilitiesJson: d.model.capabilitiesJson ?? null,
        }
      : null,
    gatewayId: d.gatewayId?.toString() ?? null,
    gatewayOnline: d.gateway?.online ?? null,
    firmwareVersion: d.firmwareVersion,
    hardwareVersion: d.hardwareVersion,
    qcStatus: d.qcStatus,
    status: d.status,
    ownerType: d.ownerType,
    ownerCompanyId: d.ownerCompanyId?.toString() ?? null,
    ownerCompanyName: d.ownerCompany?.name ?? null,
    currentTeamId: d.currentTeamId?.toString() ?? null,
    currentTeamName: (d.currentTeam as { name?: string } | null)?.name ?? null,
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
    locationLat: d.locationLat ? Number(d.locationLat) : null,
    locationLng: d.locationLng ? Number(d.locationLng) : null,
    createdAt: d.createdAt.toISOString(),
  };
}
