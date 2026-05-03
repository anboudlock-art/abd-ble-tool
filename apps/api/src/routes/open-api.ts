import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma } from '@abd/db';
import { ApiError, DeviceCommandRequestSchema } from '@abd/shared';
import { Lora } from '@abd/proto';
import { publishLoraCommand } from '../lib/downlink.js';

/**
 * The /openapi/v1/* slice is what third-party customers integrate with.
 * Auth: HMAC-SHA256 (X-Abd-Key, X-Abd-Timestamp, X-Abd-Nonce, X-Abd-Signature)
 * Scoping: every query is automatically tenant-restricted to the integration
 *          app's company.
 */
export default async function openApiRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/devices',
    {
      onRequest: [app.requireAppKey('device:read')],
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
          status: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const companyId = req.integrationApp!.companyId;
      const { page, pageSize, status } = req.query;
      const where: Prisma.DeviceWhereInput = {
        ownerCompanyId: companyId,
        deletedAt: null,
        ...(status ? { status: status as Prisma.EnumDeviceStatusFilter['equals'] } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.device.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.device.count({ where }),
      ]);
      return {
        items: items.map((d) => ({
          id: d.id.toString(),
          lockId: d.lockId,
          bleMac: d.bleMac,
          imei: d.imei,
          status: d.status,
          lastState: d.lastState,
          lastBattery: d.lastBattery,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          doorLabel: d.doorLabel,
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.get(
    '/events',
    {
      onRequest: [app.requireAppKey('event:read')],
      schema: {
        querystring: z.object({
          since: z.coerce.number().int().optional().describe('id cursor'),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (req) => {
      const companyId = req.integrationApp!.companyId;
      const { since, limit } = req.query;
      const items = await prisma.lockEvent.findMany({
        where: {
          companyId,
          ...(since ? { id: { gt: BigInt(since) } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit,
      });
      return {
        items: items.map((e) => ({
          id: e.id.toString(),
          deviceId: e.deviceId.toString(),
          eventType: e.eventType,
          source: e.source,
          battery: e.battery,
          lat: e.lat?.toString() ?? null,
          lng: e.lng?.toString() ?? null,
          createdAt: e.createdAt.toISOString(),
          receivedAt: e.receivedAt.toISOString(),
        })),
        nextSince: items.length > 0 ? items[items.length - 1]!.id.toString() : null,
      };
    },
  );

  typed.post(
    '/devices/:id/commands',
    {
      onRequest: [app.requireAppKey('device:command')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: DeviceCommandRequestSchema,
      },
    },
    async (req, reply) => {
      const companyId = req.integrationApp!.companyId;
      const id = BigInt(req.params.id);
      const device = await prisma.device.findUnique({
        where: { id },
        include: { model: true, gateway: true },
      });
      if (!device || device.ownerCompanyId !== companyId) {
        throw ApiError.notFound();
      }
      if (device.model.category === 'eseal') {
        throw ApiError.unsupportedOnDevice();
      }
      if (
        !device.model.hasLora ||
        !device.gatewayId ||
        !device.gateway ||
        !device.gateway.online
      ) {
        throw ApiError.offline('Gateway offline or device not LoRa-routed');
      }
      if (device.loraE220Addr == null || device.loraChannel == null) {
        throw ApiError.conflict('LoRa addr/channel missing');
      }
      const { commandType } = req.body;
      const cmd =
        commandType === 'unlock'
          ? Lora.LoraLockCommand.UNLOCK
          : commandType === 'lock'
            ? Lora.LoraLockCommand.LOCK
            : null;
      if (cmd == null) throw ApiError.unsupportedOnDevice();
      const macBytes = Lora.parseMac(device.bleMac);

      const row = await prisma.deviceCommand.create({
        data: {
          deviceId: device.id,
          commandType,
          issuedByUserId: null, // API-driven; no user
          source: 'api',
          gatewayId: device.gatewayId,
          status: 'pending',
          timeoutAt: new Date(Date.now() + 10_000),
        },
      });
      await publishLoraCommand({
        gatewayId: device.gatewayId,
        loraAddr: device.loraE220Addr,
        loraChannel: device.loraChannel,
        mac: macBytes,
        command: cmd,
      });
      await prisma.deviceCommand.update({
        where: { id: row.id },
        data: { status: 'sent', sentAt: new Date() },
      });
      reply.code(202);
      return { commandId: row.id.toString(), status: 'sent' };
    },
  );
}
