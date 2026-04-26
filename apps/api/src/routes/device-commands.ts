import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { Lora } from '@abd/proto';
import { ApiError, DeviceCommandRequestSchema } from '@abd/shared';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';
import { publishLoraCommand } from '../lib/downlink.js';

const COMMAND_TIMEOUT_MS = 10_000;

export default async function deviceCommandRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Issue a remote command to a device.
   * Currently supports LoRa-routed devices (4G padlock with LoRa relay).
   * 4G-direct devices and BLE-only seals are NOT supported here.
   */
  typed.post(
    '/devices/:id/commands',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: DeviceCommandRequestSchema,
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { commandType } = req.body;
      const id = BigInt(req.params.id);

      const device = await prisma.device.findUnique({
        where: { id },
        include: { model: true, gateway: true },
      });
      if (!device || device.deletedAt) throw ApiError.notFound();

      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }

      if (device.model.category === 'eseal') {
        throw ApiError.unsupportedOnDevice('Eseal cannot be controlled remotely');
      }
      if (device.status !== 'active' && device.status !== 'assigned') {
        throw ApiError.conflict(
          `Device must be assigned/active to receive commands (current: ${device.status})`,
        );
      }

      // For now we only route via LoRa. 4G TCP path is the same idea but
      // requires a separate "device session" registry that isn't built yet.
      if (!device.model.hasLora || !device.gatewayId || !device.gateway) {
        throw ApiError.unsupportedOnDevice(
          'Remote control over 4G-direct path not yet implemented; this device has no LoRa gateway',
        );
      }
      if (!device.gateway.online) {
        throw ApiError.offline('Gateway is offline');
      }
      if (device.loraE220Addr == null || device.loraChannel == null) {
        throw ApiError.conflict('Device has no LoRa addr/channel configured');
      }

      const loraCommand =
        commandType === 'unlock'
          ? Lora.LoraLockCommand.UNLOCK
          : commandType === 'lock'
            ? Lora.LoraLockCommand.LOCK
            : null;
      if (loraCommand == null) {
        throw ApiError.unsupportedOnDevice('query_status not supported over LoRa');
      }

      const macBytes = Lora.parseMac(device.bleMac);
      const frame = Lora.encodeDownlink({
        addr: device.loraE220Addr,
        channel: device.loraChannel,
        mac: macBytes,
        command: loraCommand,
      });

      const cmd = await prisma.deviceCommand.create({
        data: {
          deviceId: device.id,
          commandType,
          issuedByUserId: ctx.userId,
          source: 'web',
          gatewayId: device.gatewayId,
          requestPayload: frame,
          status: 'pending',
          timeoutAt: new Date(Date.now() + COMMAND_TIMEOUT_MS),
        },
      });

      try {
        await publishLoraCommand({
          gatewayId: device.gatewayId,
          loraAddr: device.loraE220Addr,
          loraChannel: device.loraChannel,
          mac: macBytes,
          command: loraCommand,
        });
        await prisma.deviceCommand.update({
          where: { id: cmd.id },
          data: { status: 'sent', sentAt: new Date() },
        });
      } catch (err) {
        await prisma.deviceCommand.update({
          where: { id: cmd.id },
          data: {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : 'unknown',
          },
        });
        throw ApiError.offline('Failed to publish to gateway channel');
      }

      reply.code(202);
      return {
        commandId: cmd.id.toString(),
        status: 'sent',
        timeoutAt: cmd.timeoutAt?.toISOString() ?? null,
      };
    },
  );

  typed.get(
    '/devices/:id/commands',
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

      const commands = await prisma.deviceCommand.findMany({
        where: { deviceId: id },
        orderBy: { id: 'desc' },
        take: 100,
      });
      return {
        items: commands.map((c) => ({
          id: c.id.toString(),
          commandType: c.commandType,
          status: c.status,
          source: c.source,
          retries: c.retries,
          issuedByUserId: c.issuedByUserId?.toString() ?? null,
          sentAt: c.sentAt?.toISOString() ?? null,
          ackedAt: c.ackedAt?.toISOString() ?? null,
          timeoutAt: c.timeoutAt?.toISOString() ?? null,
          resultEventId: c.resultEventId?.toString() ?? null,
          errorMessage: c.errorMessage,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    },
  );

  typed.get(
    '/commands/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const cmd = await prisma.deviceCommand.findUnique({
        where: { id: BigInt(req.params.id) },
        include: { device: true },
      });
      if (!cmd) throw ApiError.notFound();
      const scope = scopeToCompany(ctx);
      if (scope.companyId && cmd.device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      return {
        id: cmd.id.toString(),
        commandType: cmd.commandType,
        status: cmd.status,
        sentAt: cmd.sentAt?.toISOString() ?? null,
        ackedAt: cmd.ackedAt?.toISOString() ?? null,
        timeoutAt: cmd.timeoutAt?.toISOString() ?? null,
        errorMessage: cmd.errorMessage,
      };
    },
  );
}
