import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma } from '@abd/db';
import {
  ApiError,
  CreateFirmwarePackageSchema,
  CreateFirmwareTaskSchema,
  FirmwarePackageListQuerySchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

/**
 * OTA endpoints.
 *
 * - vendor_admin: full control, can publish global packages (companyId null).
 * - company_admin: can publish + push packages scoped to their company.
 * - others: read-only.
 *
 * The actual delivery (packaging, signing, downlink) happens out-of-band; here
 * we only manage metadata + per-device task rows. A worker watches
 * device_firmware_task rows in 'queued' state and updates progress.
 */
export default async function firmwareRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // ----- Packages --------------------------------------------------------

  typed.get(
    '/firmware/packages',
    {
      onRequest: [app.authenticate],
      schema: { querystring: FirmwarePackageListQuerySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize, modelId, status } = req.query;

      // Visibility: vendor_admin sees everything; company users see global
      // packages (companyId null) PLUS their own company's packages.
      const visibilityWhere: Prisma.FirmwarePackageWhereInput =
        ctx.role === 'vendor_admin'
          ? {}
          : { OR: [{ companyId: null }, { companyId: ctx.companyId ?? -1n }] };

      const where: Prisma.FirmwarePackageWhereInput = {
        deletedAt: null,
        ...visibilityWhere,
        ...(modelId ? { modelId: BigInt(modelId) } : {}),
        ...(status ? { status } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.firmwarePackage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { model: { select: { id: true, code: true, name: true } } },
        }),
        prisma.firmwarePackage.count({ where }),
      ]);

      return {
        items: items.map(serializePackage),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.post(
    '/firmware/packages',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin'),
      ],
      schema: { body: CreateFirmwarePackageSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const body = req.body;

      // Resolve and validate company scope:
      //   vendor_admin: companyId is whatever they passed (incl. null = global)
      //   company_admin: forced to their own companyId; cannot publish global
      let companyId: bigint | null;
      if (ctx.role === 'vendor_admin') {
        companyId = body.companyId == null ? null : BigInt(body.companyId);
      } else {
        if (ctx.companyId == null) throw ApiError.forbidden('User has no company');
        companyId = ctx.companyId;
      }

      // Reject duplicate version for the same model.
      const dup = await prisma.firmwarePackage.findUnique({
        where: {
          modelId_version: {
            modelId: BigInt(body.modelId),
            version: body.version,
          },
        },
      });
      if (dup) throw ApiError.conflict(`Version ${body.version} already exists for this model`);

      const pkg = await prisma.firmwarePackage.create({
        data: {
          companyId,
          modelId: BigInt(body.modelId),
          version: body.version,
          url: body.url,
          sha256: body.sha256,
          sizeBytes: body.sizeBytes,
          changelog: body.changelog,
          uploadedByUserId: ctx.userId,
        },
        include: { model: { select: { id: true, code: true, name: true } } },
      });
      reply.code(201);
      return serializePackage(pkg);
    },
  );

  typed.post(
    '/firmware/packages/:id/release',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin'),
      ],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const pkg = await prisma.firmwarePackage.findUnique({ where: { id } });
      if (!pkg || pkg.deletedAt) throw ApiError.notFound();
      if (
        ctx.role !== 'vendor_admin' &&
        pkg.companyId !== ctx.companyId
      ) {
        throw ApiError.forbidden();
      }

      const updated = await prisma.firmwarePackage.update({
        where: { id },
        data: { status: 'released', releasedAt: new Date() },
        include: { model: { select: { id: true, code: true, name: true } } },
      });
      return serializePackage(updated);
    },
  );

  typed.post(
    '/firmware/packages/:id/archive',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin'),
      ],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const pkg = await prisma.firmwarePackage.findUnique({ where: { id } });
      if (!pkg || pkg.deletedAt) throw ApiError.notFound();
      if (
        ctx.role !== 'vendor_admin' &&
        pkg.companyId !== ctx.companyId
      ) {
        throw ApiError.forbidden();
      }
      const updated = await prisma.firmwarePackage.update({
        where: { id },
        data: { status: 'archived' },
        include: { model: { select: { id: true, code: true, name: true } } },
      });
      return serializePackage(updated);
    },
  );

  // ----- Tasks -----------------------------------------------------------

  typed.post(
    '/firmware/tasks',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin'),
      ],
      schema: { body: CreateFirmwareTaskSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { packageId, deviceIds, scheduledAt } = req.body;

      const pkg = await prisma.firmwarePackage.findUnique({
        where: { id: BigInt(packageId) },
      });
      if (!pkg || pkg.deletedAt) throw ApiError.notFound('package not found');
      if (pkg.status !== 'released') {
        throw ApiError.badRequest('package must be released before pushing');
      }
      if (
        ctx.role !== 'vendor_admin' &&
        pkg.companyId !== null &&
        pkg.companyId !== ctx.companyId
      ) {
        throw ApiError.forbidden('package not in your company scope');
      }

      // Verify devices: must exist, match package model, and be in scope.
      const scope = scopeToCompany(ctx);
      const devices = await prisma.device.findMany({
        where: {
          id: { in: deviceIds.map((n) => BigInt(n)) },
          deletedAt: null,
          modelId: pkg.modelId,
          ...(scope.companyId ? { ownerCompanyId: scope.companyId } : {}),
        },
        select: { id: true },
      });
      const found = new Set(devices.map((d) => d.id.toString()));
      const missing = deviceIds.filter((id) => !found.has(BigInt(id).toString()));
      if (missing.length > 0) {
        throw ApiError.badRequest(
          `${missing.length} device(s) invalid or model mismatch`,
        );
      }

      const sched = scheduledAt ? new Date(scheduledAt) : null;
      // Use createMany with skipDuplicates so re-pushing same package is idempotent.
      const result = await prisma.deviceFirmwareTask.createMany({
        data: devices.map((d) => ({
          packageId: pkg.id,
          deviceId: d.id,
          scheduledAt: sched,
          triggeredByUserId: ctx.userId,
        })),
        skipDuplicates: true,
      });

      reply.code(201);
      return { created: result.count, requested: deviceIds.length };
    },
  );

  typed.get(
    '/firmware/tasks',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          deviceId: z.coerce.number().int().positive().optional(),
          packageId: z.coerce.number().int().positive().optional(),
          status: z
            .enum(['queued', 'pushing', 'succeeded', 'failed', 'cancelled'])
            .optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { deviceId, packageId, status, page, pageSize } = req.query;
      const scope = scopeToCompany(ctx);

      // Restrict by company via the package's companyId or the device's
      // ownerCompanyId.
      const where: Prisma.DeviceFirmwareTaskWhereInput = {
        ...(deviceId ? { deviceId: BigInt(deviceId) } : {}),
        ...(packageId ? { packageId: BigInt(packageId) } : {}),
        ...(status ? { status } : {}),
        ...(scope.companyId
          ? {
              package: {
                OR: [{ companyId: null }, { companyId: scope.companyId }],
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.deviceFirmwareTask.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            package: {
              select: { id: true, version: true, modelId: true },
            },
          },
        }),
        prisma.deviceFirmwareTask.count({ where }),
      ]);
      return {
        items: items.map(serializeTask),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.post(
    '/firmware/tasks/:id/cancel',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin'),
      ],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const task = await prisma.deviceFirmwareTask.findUnique({
        where: { id },
        include: { package: true },
      });
      if (!task) throw ApiError.notFound();
      if (
        ctx.role !== 'vendor_admin' &&
        task.package.companyId !== null &&
        task.package.companyId !== ctx.companyId
      ) {
        throw ApiError.forbidden();
      }
      if (task.status === 'succeeded' || task.status === 'failed') {
        throw ApiError.badRequest('task already terminal');
      }
      const updated = await prisma.deviceFirmwareTask.update({
        where: { id },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
      return serializeTask({ ...updated, package: task.package });
    },
  );
}

type PackageWithModel = Prisma.FirmwarePackageGetPayload<{
  include: { model: { select: { id: true; code: true; name: true } } };
}>;
function serializePackage(p: PackageWithModel) {
  return {
    id: p.id.toString(),
    ulid: p.ulid,
    companyId: p.companyId?.toString() ?? null,
    modelId: p.modelId.toString(),
    modelCode: p.model.code,
    modelName: p.model.name,
    version: p.version,
    url: p.url,
    sha256: p.sha256,
    sizeBytes: p.sizeBytes,
    changelog: p.changelog,
    status: p.status,
    uploadedByUserId: p.uploadedByUserId?.toString() ?? null,
    releasedAt: p.releasedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

type TaskWithPackage = Prisma.DeviceFirmwareTaskGetPayload<{
  include: {
    package: { select: { id: true; version: true; modelId: true } };
  };
}>;
function serializeTask(t: TaskWithPackage) {
  return {
    id: t.id.toString(),
    packageId: t.packageId.toString(),
    deviceId: t.deviceId.toString(),
    status: t.status,
    progress: t.progress,
    errorMessage: t.errorMessage,
    scheduledAt: t.scheduledAt?.toISOString() ?? null,
    startedAt: t.startedAt?.toISOString() ?? null,
    finishedAt: t.finishedAt?.toISOString() ?? null,
    triggeredByUserId: t.triggeredByUserId?.toString() ?? null,
    createdAt: t.createdAt.toISOString(),
    packageVersion: t.package.version,
  };
}
