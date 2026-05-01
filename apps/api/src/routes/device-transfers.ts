import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import {
  ApiError,
  AssignDevicesSchema,
  DeliverSchema,
  ShipToCompanySchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';
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

  /**
   * Company admin / dept admin assigns devices to a team.
   * Transitions: delivered → assigned (or already-assigned → reassigned).
   */
  typed.post(
    '/devices/assign',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin'),
      ],
      schema: { body: AssignDevicesSchema },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { deviceIds, teamId, userId, validFrom, validUntil } = req.body;
      const ids = deviceIds.map(BigInt);

      const team = await prisma.team.findUnique({
        where: { id: BigInt(teamId) },
        include: { department: true },
      });
      if (!team) throw ApiError.notFound(`Team ${teamId} not found`);
      if (ctx.role !== 'vendor_admin' && team.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }

      // Optional user-scoped assignment: the user must already be a member
      // of the target team. Otherwise, the assignment would be unreachable.
      let targetUser: { id: bigint; name: string } | null = null;
      if (userId !== undefined) {
        const member = await prisma.userMembership.findUnique({
          where: { userId_teamId: { userId: BigInt(userId), teamId: team.id } },
          include: { user: { select: { id: true, name: true, deletedAt: true } } },
        });
        if (!member || member.user.deletedAt) {
          throw ApiError.conflict(
            `User ${userId} is not a member of team ${team.name}`,
          );
        }
        targetUser = { id: member.user.id, name: member.user.name };
      }

      const devices = await prisma.device.findMany({ where: { id: { in: ids } } });
      if (devices.length !== ids.length) throw ApiError.notFound('Some devices not found');

      for (const d of devices) {
        if (ctx.role !== 'vendor_admin' && d.ownerCompanyId !== ctx.companyId) {
          throw ApiError.forbidden(`Device ${d.lockId} belongs to another company`);
        }
        if (d.ownerCompanyId !== team.companyId) {
          throw ApiError.conflict(
            `Device ${d.lockId} not in target team's company`,
          );
        }
        // Allow re-assignment from `assigned` or `active` back to `assigned`
        if (
          d.status !== 'delivered' &&
          d.status !== 'assigned' &&
          d.status !== 'active'
        ) {
          throw ApiError.conflict(
            `Device ${d.lockId} is in status '${d.status}'; cannot assign`,
          );
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const out = [];
        for (const d of devices) {
          const newStatus = d.status === 'active' ? 'active' : 'assigned';
          if (d.status !== newStatus) assertTransition(d.status, newStatus);
          const u = await tx.device.update({
            where: { id: d.id },
            data: { status: newStatus, currentTeamId: team.id },
          });
          await tx.deviceTransfer.create({
            data: {
              deviceId: d.id,
              fromStatus: d.status,
              toStatus: newStatus,
              fromOwnerType: d.ownerType,
              fromOwnerId: d.currentTeamId,
              toOwnerType: 'company',
              toOwnerId: team.id,
              operatorUserId: ctx.userId,
              reason: d.status === newStatus ? 'reassign' : 'assign',
              metadata: targetUser
                ? {
                    teamId: team.id.toString(),
                    teamName: team.name,
                    userId: targetUser.id.toString(),
                    userName: targetUser.name,
                  }
                : { teamId: team.id.toString(), teamName: team.name },
            },
          });
          // When (re)assigning, retire any prior open assignment rows first
          // so the device only has one active grant at a time.
          await tx.deviceAssignment.updateMany({
            where: { deviceId: d.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.deviceAssignment.create({
            data: {
              deviceId: d.id,
              companyId: team.companyId,
              scope: targetUser ? 'user' : 'team',
              teamId: team.id,
              userId: targetUser?.id,
              grantedByUserId: ctx.userId,
              validFrom: validFrom ?? null,
              validUntil: validUntil ?? null,
            },
          });
          out.push(u);
        }
        return out;
      });

      return {
        assignedCount: updated.length,
        scope: targetUser ? 'user' : 'team',
        teamId: team.id.toString(),
        teamName: team.name,
        userId: targetUser?.id.toString() ?? null,
        userName: targetUser?.name ?? null,
        devices: updated.map((d) => ({
          id: d.id.toString(),
          lockId: d.lockId,
          status: d.status,
        })),
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
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);

      // Verify the caller can see this device before exposing its history.
      const device = await prisma.device.findUnique({ where: { id } });
      if (!device) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }

      const transfers = await prisma.deviceTransfer.findMany({
        where: { deviceId: id },
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
