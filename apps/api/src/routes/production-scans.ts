import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError, ProductionScanSchema } from '@abd/shared';
import { getAuthContext, requireRole } from '../lib/auth.js';

export default async function productionScanRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Production-line operator submits one scan:
   *   QR (lockId) + BLE MAC + IMEI + firmware + QC
   * Idempotent per lockId: re-scan updates the existing row.
   */
  typed.post(
    '/production/scans',
    {
      onRequest: [app.authenticate, requireRole('production_operator', 'vendor_admin')],
      schema: { body: ProductionScanSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { batchId, lockId, bleMac, imei, firmwareVersion, qcResult, qcRemark, durationMs } =
        req.body;

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
          },
        });

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
          scannedAt: s.scannedAt.toISOString(),
          durationMs: s.durationMs,
        })),
      };
    },
  );
}
