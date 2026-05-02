import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import {
  ApiError,
  BatchProductionScanSchema,
  ProductionScanSchema,
  ProductionTestItemsSchema,
  type ProductionTestItems,
} from '@abd/shared';
import { getAuthContext, requireRole } from '../lib/auth.js';

export default async function productionScanRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Production-line operator submits one scan:
   *   QR (lockId) + BLE MAC + IMEI + firmware + QC + (optional) 12 test items
   * Idempotent per lockId: re-scan updates the existing row.
   */
  typed.post(
    '/production/scans',
    {
      onRequest: [app.authenticate, requireRole('production_operator', 'vendor_admin')],
      schema: {
        body: ProductionScanSchema.extend({
          testItems: ProductionTestItemsSchema.optional(),
        }),
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const {
        batchId,
        lockId,
        bleMac,
        imei,
        firmwareVersion,
        qcResult,
        qcRemark,
        durationMs,
        testItems,
      } = req.body;

      const macUpper = bleMac.toUpperCase();

      const batch = await prisma.productionBatch.findUnique({
        where: { id: BigInt(batchId) },
        include: { model: true },
      });
      if (!batch) throw ApiError.notFound(`Batch ${batchId} not found`);
      if (batch.completedAt) {
        throw ApiError.conflict(
          `Batch ${batch.batchNo} is completed; reopen it before adding more scans`,
        );
      }

      // Reject mismatched MAC for existing lockId (protects against QR-label swap)
      const existingByLock = await prisma.device.findUnique({ where: { lockId } });
      if (existingByLock && existingByLock.bleMac !== macUpper) {
        throw ApiError.conflict(
          `Lock ${lockId} already scanned with a different MAC (${existingByLock.bleMac})`,
        );
      }
      const existingByMac = await prisma.device.findUnique({ where: { bleMac: macUpper } });
      if (existingByMac && existingByMac.lockId !== lockId) {
        throw ApiError.conflict(
          `MAC ${macUpper} already bound to a different lock (${existingByMac.lockId})`,
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        const device = await tx.device.upsert({
          where: { lockId },
          create: {
            lockId,
            bleMac: macUpper,
            imei: imei ?? null,
            modelId: batch.modelId,
            batchId: batch.id,
            firmwareVersion,
            qcStatus: qcResult,
            producedAt: new Date(),
            status: qcResult === 'passed' ? 'in_warehouse' : 'manufactured',
            ownerType: 'vendor',
          },
          update: {
            bleMac: macUpper,
            imei: imei ?? null,
            firmwareVersion: firmwareVersion ?? undefined,
            qcStatus: qcResult,
            status: qcResult === 'passed' ? 'in_warehouse' : 'manufactured',
          },
        });

        const scan = await tx.productionScan.create({
          data: {
            batchId: batch.id,
            deviceId: device.id,
            operatorUserId: ctx.userId,
            qrScanned: lockId,
            bleMacRead: macUpper,
            imeiRead: imei ?? null,
            firmwareVersionRead: firmwareVersion ?? null,
            qcResult,
            qcRemark,
            durationMs,
            testItems: (testItems ?? undefined) as never,
          },
        });

        // Mark the pre-generated lock_number row as registered (if it exists).
        // We only do this on the *first* scan per lock so we don't keep
        // re-stamping registeredAt on retries.
        if (!existingByLock) {
          await tx.lockNumber.updateMany({
            where: { lockId, status: 'reserved' },
            data: { status: 'registered', deviceId: device.id, registeredAt: new Date() },
          });
        }

        // Sync counters on batch
        if (!existingByLock) {
          await tx.productionBatch.update({
            where: { id: batch.id },
            data: { producedCount: { increment: 1 } },
          });
        }

        // Record a transfer row on first scan so the lifecycle is auditable
        if (!existingByLock && qcResult === 'passed') {
          await tx.deviceTransfer.create({
            data: {
              deviceId: device.id,
              fromStatus: 'manufactured',
              toStatus: 'in_warehouse',
              toOwnerType: 'vendor',
              operatorUserId: ctx.userId,
              reason: 'production scan',
              metadata: { batchNo: batch.batchNo, scanId: scan.id.toString() },
            },
          });
        }

        return { device, scan, firstScan: !existingByLock };
      });

      reply.code(result.firstScan ? 201 : 200);
      return {
        scanId: result.scan.id.toString(),
        device: {
          id: result.device.id.toString(),
          lockId: result.device.lockId,
          bleMac: result.device.bleMac,
          imei: result.device.imei,
          status: result.device.status,
          qcStatus: result.device.qcStatus,
        },
        firstScan: result.firstScan,
      };
    },
  );

  typed.get(
    '/production/batches/:batchId/scans',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'production_operator')],
      schema: { params: z.object({ batchId: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const scans = await prisma.productionScan.findMany({
        where: { batchId: BigInt(req.params.batchId) },
        orderBy: { id: 'desc' },
        take: 500,
      });
      return {
        items: scans.map((s) => ({
          id: s.id.toString(),
          deviceId: s.deviceId?.toString() ?? null,
          qrScanned: s.qrScanned,
          bleMacRead: s.bleMacRead,
          imeiRead: s.imeiRead,
          firmwareVersionRead: s.firmwareVersionRead,
          qcResult: s.qcResult,
          qcRemark: s.qcRemark,
          testItems: s.testItems,
          scannedAt: s.scannedAt.toISOString(),
          durationMs: s.durationMs,
        })),
      };
    },
  );

  /**
   * B2: batch submit production scans. The APP buffers up to N scans
   * (e.g. when offline) and flushes them in one call. Each scan goes
   * through the same upsert path as the single-scan endpoint, so retries
   * are still safe. Errors on individual rows are reported per-index so
   * the APP can mark which entries to keep retrying.
   */
  typed.post(
    '/production-scans/batch',
    {
      onRequest: [
        app.authenticate,
        requireRole('production_operator', 'vendor_admin'),
      ],
      schema: { body: BatchProductionScanSchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const results: Array<
        | { index: number; ok: true; scanId: string; deviceId: string; firstScan: boolean }
        | { index: number; ok: false; error: string }
      > = [];

      for (const [index, scan] of req.body.scans.entries()) {
        try {
          const macUpper = scan.bleMac.toUpperCase();
          const batch = await prisma.productionBatch.findUnique({
            where: { id: BigInt(scan.batchId) },
          });
          if (!batch) {
            results.push({ index, ok: false, error: 'batch not found' });
            continue;
          }
          if (batch.completedAt) {
            results.push({ index, ok: false, error: 'batch closed' });
            continue;
          }

          const existingByLock = await prisma.device.findUnique({
            where: { lockId: scan.lockId },
          });
          if (existingByLock && existingByLock.bleMac !== macUpper) {
            results.push({ index, ok: false, error: 'mac mismatch' });
            continue;
          }
          const existingByMac = await prisma.device.findUnique({
            where: { bleMac: macUpper },
          });
          if (existingByMac && existingByMac.lockId !== scan.lockId) {
            results.push({ index, ok: false, error: 'mac in use by another lock' });
            continue;
          }

          const r = await prisma.$transaction(async (tx) => {
            const device = await tx.device.upsert({
              where: { lockId: scan.lockId },
              create: {
                lockId: scan.lockId,
                bleMac: macUpper,
                imei: scan.imei ?? null,
                modelId: batch.modelId,
                batchId: batch.id,
                firmwareVersion: scan.firmwareVersion,
                qcStatus: scan.qcResult,
                producedAt: new Date(),
                status: scan.qcResult === 'passed' ? 'in_warehouse' : 'manufactured',
                ownerType: 'vendor',
              },
              update: {
                bleMac: macUpper,
                imei: scan.imei ?? null,
                firmwareVersion: scan.firmwareVersion ?? undefined,
                qcStatus: scan.qcResult,
                status:
                  scan.qcResult === 'passed' ? 'in_warehouse' : 'manufactured',
              },
            });
            const created = await tx.productionScan.create({
              data: {
                batchId: batch.id,
                deviceId: device.id,
                operatorUserId: ctx.userId,
                qrScanned: scan.lockId,
                bleMacRead: macUpper,
                imeiRead: scan.imei ?? null,
                firmwareVersionRead: scan.firmwareVersion ?? null,
                qcResult: scan.qcResult,
                qcRemark: scan.qcRemark,
                durationMs: scan.durationMs,
                testItems: (scan.testItems ?? undefined) as never,
              },
            });
            if (!existingByLock) {
              await tx.lockNumber.updateMany({
                where: { lockId: scan.lockId, status: 'reserved' },
                data: {
                  status: 'registered',
                  deviceId: device.id,
                  registeredAt: new Date(),
                },
              });
              await tx.productionBatch.update({
                where: { id: batch.id },
                data: { producedCount: { increment: 1 } },
              });
            }
            return { device, scanId: created.id, firstScan: !existingByLock };
          });

          results.push({
            index,
            ok: true,
            scanId: r.scanId.toString(),
            deviceId: r.device.id.toString(),
            firstScan: r.firstScan,
          });
        } catch (err) {
          results.push({
            index,
            ok: false,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
      }

      const succeeded = results.filter((r) => r.ok).length;
      return {
        submitted: req.body.scans.length,
        succeeded,
        failed: req.body.scans.length - succeeded,
        results,
      };
    },
  );

  /** B3: list scans for a single device (latest-first). */
  typed.get(
    '/production-scans',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          deviceId: z.coerce.number().int().positive(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (req) => {
      const { deviceId, limit } = req.query;
      const items = await prisma.productionScan.findMany({
        where: { deviceId: BigInt(deviceId) },
        orderBy: { scannedAt: 'desc' },
        take: limit,
      });
      return {
        items: items.map((s) => ({
          id: s.id.toString(),
          batchId: s.batchId?.toString() ?? null,
          qrScanned: s.qrScanned,
          bleMacRead: s.bleMacRead,
          imeiRead: s.imeiRead,
          firmwareVersionRead: s.firmwareVersionRead,
          qcResult: s.qcResult,
          qcRemark: s.qcRemark,
          testItems: s.testItems,
          scannedAt: s.scannedAt.toISOString(),
          durationMs: s.durationMs,
        })),
      };
    },
  );

  /**
   * B4: per-batch test summary — total scans, pass/fail counts, and (when
   * testItems were submitted) a per-item pass/fail breakdown across all
   * scans in the batch.
   */
  typed.get(
    '/production-scans/summary',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'production_operator'),
      ],
      schema: {
        querystring: z.object({
          batchId: z.coerce.number().int().positive(),
        }),
      },
    },
    async (req) => {
      const { batchId } = req.query;
      const batch = await prisma.productionBatch.findUnique({
        where: { id: BigInt(batchId) },
      });
      if (!batch) throw ApiError.notFound('Batch not found');

      const scans = await prisma.productionScan.findMany({
        where: { batchId: BigInt(batchId) },
        select: { qcResult: true, deviceId: true, testItems: true },
      });

      const totalScans = scans.length;
      const distinctDevices = new Set(
        scans.filter((s) => s.deviceId).map((s) => s.deviceId!.toString()),
      ).size;
      const passed = scans.filter((s) => s.qcResult === 'passed').length;
      const failed = scans.filter((s) => s.qcResult === 'failed').length;
      const pending = scans.filter((s) => s.qcResult === 'pending').length;

      // Per-item aggregation across all scans that included testItems
      const itemAgg = new Map<string, { pass: number; fail: number }>();
      for (const s of scans) {
        const items = s.testItems as ProductionTestItems | null;
        if (!items) continue;
        for (const [k, v] of Object.entries(items)) {
          if (!itemAgg.has(k)) itemAgg.set(k, { pass: 0, fail: 0 });
          if (v.pass) itemAgg.get(k)!.pass++;
          else itemAgg.get(k)!.fail++;
        }
      }

      return {
        batchId: batch.id.toString(),
        batchNo: batch.batchNo,
        quantity: batch.quantity,
        producedCount: batch.producedCount,
        totalScans,
        distinctDevices,
        qc: { passed, failed, pending },
        perItem: Object.fromEntries(itemAgg),
      };
    },
  );
}
