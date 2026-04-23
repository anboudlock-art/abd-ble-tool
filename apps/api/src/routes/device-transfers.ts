import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { ApiError, ShipToCompanySchema, DeliverSchema } from '@abd/shared';
import { getAuthContext, requireRole } from '../lib/auth.js';
import { assertTransition } from '../domain/device-state-machine.js';

export default async function deviceTransferRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Vendor ships a batch of devices to a customer company.
   * Transitions each device: in_warehouse → shipped, owner → company.
   */
  typed.post(
    '/devices/ship',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin')],
      schema: { body: ShipToCompanySchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { deviceIds, toCompanyId, reason, shipmentNo } = req.body;

      const company = await prisma.company.findUnique({ where: { id: BigInt(toCompanyId) } });
      if (!company) throw ApiError.notFound(`Company ${toCompanyId} not found`);

      const ids = deviceIds.map(BigInt);
      const devices = await prisma.device.findMany({ where: { id: { in: ids } } });
      if (devices.length !== ids.length) {
        throw ApiError.notFound('Some devices not found');
      }
      for (const d of devices) {
        assertTransition(d.status, 'shipped');
      }

      const shipped = await prisma.$transaction(async (tx) => {
        const updated = [];
        for (const d of devices) {
          const u = await tx.device.update({
            where: { id: d.id },
            data: {
              status: 'shipped',
              ownerType: 'company',
              ownerCompanyId: BigInt(toCompanyId),
            },
          });
          await tx.deviceTransfer.create({
            data: {
              deviceId: d.id,
              fromStatus: d.status,
              toStatus: 'shipped',
              fromOwnerType: d.ownerType,
              fromOwnerId: d.ownerCompanyId,
              toOwnerType: 'company',
              toOwnerId: BigInt(toCompanyId),
              operatorUserId: ctx.userId,
              reason: reason ?? 'ship',
              metadata: shipmentNo ? { shipmentNo } : undefined,
            },
          });
          updated.push(u);
        }
        return updated;
      });

      return {
        shippedCount: shipped.length,
        toCompanyId: toCompanyId.toString(),
        devices: shipped.map((d) => ({ id: d.id.toString(), lockId: d.lockId, status: d.status })),
      };
    },
  );

  /**
   * Company admin (or vendor on their behalf) confirms delivery of shipped devices.
   * Transitions: shipped → delivered.
   */
  typed.post(
    '/devices/deliver',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { body: DeliverSchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { deviceIds } = req.body;
      const ids = deviceIds.map(BigInt);

      const devices = await prisma.device.findMany({ where: { id: { in: ids } } });
      if (devices.length !== ids.length) throw ApiError.notFound('Some devices not found');
      for (const d of devices) {
        assertTransition(d.status, 'delivered');
        // Company admins can only confirm delivery for their own company
        if (ctx.role === 'company_admin' && d.ownerCompanyId !== ctx.companyId) {
          throw ApiError.forbidden();
        }
      }

      const delivered = await prisma.$transaction(async (tx) => {
        const updated = [];
        for (const d of devices) {
          const u = await tx.device.update({
            where: { id: d.id },
            data: { status: 'delivered' },
          });
          await tx.deviceTransfer.create({
            data: {
              deviceId: d.id,
              fromStatus: d.status,
              toStatus: 'delivered',
              operatorUserId: ctx.userId,
              reason: 'deliver',
            },
          });
          updated.push(u);
        }
        return updated;
      });

      return {
        deliveredCount: delivered.length,
        devices: delivered.map((d) => ({ id: d.id.toString(), lockId: d.lockId, status: d.status })),
      };
    },
  );

  typed.get(
    '/devices/:id/transfers',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const transfers = await prisma.deviceTransfer.findMany({
        where: { deviceId: BigInt(req.params.id) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return {
        items: transfers.map((t) => ({
          id: t.id.toString(),
          fromStatus: t.fromStatus,
          toStatus: t.toStatus,
          fromOwnerType: t.fromOwnerType,
          fromOwnerId: t.fromOwnerId?.toString() ?? null,
          toOwnerType: t.toOwnerType,
          toOwnerId: t.toOwnerId?.toString() ?? null,
          operatorUserId: t.operatorUserId?.toString() ?? null,
          reason: t.reason,
          metadata: t.metadata,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    },
  );
}
