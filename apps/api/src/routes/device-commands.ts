import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { LockTcp, Lora } from '@abd/proto';
import { ApiError, DeviceCommandRequestSchema } from '@abd/shared';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';
import { publishLoraCommand, publishLockTcpDownlink } from '../lib/downlink.js';

const COMMAND_TIMEOUT_MS = 10_000;

/**
 * Parse the 8-digit `lockId` (e.g. "60806001") into the 32-bit unsigned
 * LockSN that the firmware embeds in every TCP frame. The mapping is just
 * decimal → u32 (the lockId fits in u27).
 */
function parseLockSnFromLockId(lockId: string): number {
  const n = Number.parseInt(lockId, 10);
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) {
    throw ApiError.conflict(`lockId '${lockId}' cannot be encoded as 32-bit SN`);
  }
  return n >>> 0;
}

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

      // Route by device capability:
      //   LoRa-relay  → publish to LoRa gateway channel
      //   4G-direct   → publish to lock-tcp downlink channel (gw-server's
      //                 lock-tcp listener pushes onto the open socket)
      const useLora =
        device.model.hasLora && device.gatewayId != null && device.gateway != null;
      const useFourG = device.model.has4g && !useLora;

      if (!useLora && !useFourG) {
        throw ApiError.unsupportedOnDevice(
          'Device has no remote-control transport (no LoRa gateway, no 4G modem)',
        );
      }

      // Build the appropriate downlink frame
      let frame: Buffer;
      let publish: () => Promise<void>;

      if (useLora) {
        if (!device.gateway!.online) throw ApiError.offline('Gateway is offline');
        if (device.loraE220Addr == null || device.loraChannel == null) {
          throw ApiError.conflict('Device has no LoRa addr/channel configured');
        }
        const loraCommand =
          commandType === 'unlock'
            ? Lora.LoraLockCommand.UNLOCK
            : commandType === 'lock'
              ? Lora.LoraLockCommand.LOCK
              : null;
        if (loraCommand == null)
          throw ApiError.unsupportedOnDevice('query_status not supported over LoRa');
        const macBytes = Lora.parseMac(device.bleMac);
        frame = Lora.encodeDownlink({
          addr: device.loraE220Addr,
          channel: device.loraChannel,
          mac: macBytes,
          command: loraCommand,
        });
        publish = () =>
          publishLoraCommand({
            gatewayId: device.gatewayId!,
            loraAddr: device.loraE220Addr!,
            loraChannel: device.loraChannel!,
            mac: macBytes,
            command: loraCommand,
          });
      } else {
        // 4G-direct path
        const lockSN = parseLockSnFromLockId(device.lockId);
        // Use deviceCommand.id as the report serial after we create the row.
        // Allocate a deterministic serial first via Date.now & 0xffff.
        const serial = (Date.now() & 0xffff) || 1;
        if (commandType === 'unlock') {
          frame = LockTcp.encodeUnlock({
            lockSN,
            password6: '000000', // TODO: per-device password
            ttlMinutes: 30,
            reportSerial: serial,
          });
        } else if (commandType === 'query_status') {
          frame = LockTcp.encodeQueryStatus(lockSN, serial);
        } else {
          throw ApiError.unsupportedOnDevice(
            'lock command not yet wired for 4G-direct (only unlock + query_status)',
          );
        }
        publish = () => publishLockTcpDownlink(device.id, frame);
      }

      const cmd = await prisma.deviceCommand.create({
        data: {
          deviceId: device.id,
          commandType,
          issuedByUserId: ctx.userId,
          source: 'web',
          gatewayId: useLora ? device.gatewayId : null,
          requestPayload: frame,
          status: 'pending',
          timeoutAt: new Date(Date.now() + COMMAND_TIMEOUT_MS),
        },
      });

      try {
        await publish();
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
        throw ApiError.offline('Failed to publish downlink');
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

  /**
   * APP-style alias: deviceId travels in the body. Calls into the same
   * handler as POST /devices/:id/commands. Adds `command` as an alternative
   * spelling to `commandType` since the v2.6 spec writes it that way.
   */
  typed.post(
    '/device-commands',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({
          deviceId: z.coerce.number().int().positive(),
          commandType: z.enum(['unlock', 'lock', 'query_status']).optional(),
          command: z.enum(['unlock', 'lock', 'query_status']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { deviceId, commandType, command } = req.body;
      const ct = commandType ?? command;
      if (!ct) throw ApiError.conflict('commandType (or command) is required');
      const inner = await app.inject({
        method: 'POST',
        url: `/api/v1/devices/${deviceId}/commands`,
        headers: { authorization: req.headers.authorization ?? '' },
        payload: { commandType: ct },
      });
      reply.code(inner.statusCode);
      return JSON.parse(inner.body);
    },
  );

  /** Path alias: /device-commands/:id → /commands/:id */
  typed.get(
    '/device-commands/:id',
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
        deviceId: cmd.deviceId.toString(),
        commandType: cmd.commandType,
        status: cmd.status,
        sentAt: cmd.sentAt?.toISOString() ?? null,
        ackedAt: cmd.ackedAt?.toISOString() ?? null,
        timeoutAt: cmd.timeoutAt?.toISOString() ?? null,
        errorMessage: cmd.errorMessage,
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
