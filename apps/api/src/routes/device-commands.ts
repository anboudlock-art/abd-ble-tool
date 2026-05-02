import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@abd/db';
import { LockTcp, Lora } from '@abd/proto';
import {
  AckDeviceCommandSchema,
  ApiError,
  DeviceCommandRequestSchema,
} from '@abd/shared';
import { getAuthContext, scopeToCompany } from '../lib/auth.js';
import { publishLoraCommand, publishLockTcpDownlink } from '../lib/downlink.js';
import { bleCmdIdFor, resolveOccurredAt } from '../lib/occurred-at.js';

const COMMAND_TIMEOUT_MS = 10_000;
/** Window the APP has to actually run the BLE write + POST /ack. After
 *  this, the command silently expires (status remains 'pending'; the
 *  worker's command-timeout sweep will close it). */
const BLE_PRECHECK_TIMEOUT_MS = 60_000;

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
   * Issue a command to a device. v2.8 supports three transports:
   *   link='lora'  → publish to LoRa gateway channel (existing)
   *   link='fourg' → publish to lock-tcp downlink channel (existing)
   *   link='ble'   → BLE precheck: server records intent + permission,
   *                  no downlink. APP forwards over BLE then POSTs
   *                  /device-commands/:id/ack with the result.
   *   link='auto'  → server picks LoRa if reachable, else 4G (legacy
   *                  behaviour, default).
   *
   * BLE-precheck response carries `expectedCmdId` (1-byte derived from
   * the row id) — the APP MUST use this in the BLE frame's cmdId slot
   * so request/response correlation works.
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
      const { commandType, link, phoneLat, phoneLng, phoneAccuracyM } = req.body;
      const id = BigInt(req.params.id);

      // Throws 400 if occurredAt is too far in the future; otherwise
      // returns the timestamp to use + audit note for any clamp.
      const { occurredAt, serverNote } = resolveOccurredAt(req.body.occurredAt);

      const device = await prisma.device.findUnique({
        where: { id },
        include: { model: true, gateway: true },
      });
      if (!device || device.deletedAt) throw ApiError.notFound();

      const scope = scopeToCompany(ctx);
      if (scope.companyId && device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }

      if (device.status !== 'active' && device.status !== 'assigned') {
        throw ApiError.conflict(
          `Device must be assigned/active to receive commands (current: ${device.status})`,
        );
      }

      // Resolve effective transport. For 'auto' we keep the legacy
      // server-picks-best behaviour. For an explicit link we honour it
      // when the model supports it; otherwise 405.
      type Effective = 'ble' | 'lora' | 'fourg';
      const supportsLora =
        device.model.hasLora && device.gatewayId != null && device.gateway != null;
      const supportsFourG = device.model.has4g;
      const supportsBle = device.model.hasBle;
      let effective: Effective;
      switch (link) {
        case 'ble':
          if (!supportsBle)
            throw ApiError.unsupportedOnDevice('Device has no BLE');
          effective = 'ble';
          break;
        case 'lora':
          if (!device.model.hasLora)
            throw ApiError.unsupportedOnDevice('Device has no LoRa');
          if (!supportsLora) throw ApiError.offline('No LoRa gateway bound');
          effective = 'lora';
          break;
        case 'fourg':
          if (!supportsFourG)
            throw ApiError.unsupportedOnDevice('Device has no 4G');
          effective = 'fourg';
          break;
        case 'auto':
        default:
          // eseal can't go remote — historic guard preserved for 'auto'.
          if (device.model.category === 'eseal') {
            throw ApiError.unsupportedOnDevice(
              'Eseal cannot be controlled remotely (use link=ble)',
            );
          }
          if (supportsLora) effective = 'lora';
          else if (supportsFourG) effective = 'fourg';
          else
            throw ApiError.unsupportedOnDevice(
              'Device has no remote-control transport (no LoRa gateway, no 4G modem)',
            );
          break;
      }

      // ---------------- BLE precheck path ----------------
      if (effective === 'ble') {
        // For non-admin callers the device must already be granted to
        // them or one of their teams (long-term assignment OR an
        // approved temporary unlock both materialise the same
        // device_assignment row).
        const isAdmin =
          ctx.role === 'vendor_admin' || ctx.role === 'company_admin';
        if (!isAdmin) {
          const memberships = await prisma.userMembership.findMany({
            where: { userId: ctx.userId },
            select: { teamId: true },
          });
          const teamIds = memberships.map((m) => m.teamId);
          const now = new Date();
          const grant = await prisma.deviceAssignment.findFirst({
            where: {
              deviceId: device.id,
              revokedAt: null,
              AND: [
                { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
                { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
              ],
              OR: [
                { scope: 'user', userId: ctx.userId },
                ...(teamIds.length
                  ? [{ scope: 'team' as const, teamId: { in: teamIds } }]
                  : []),
              ],
            },
            select: { id: true, validUntil: true },
          });
          if (!grant) {
            throw ApiError.forbidden(
              'No active grant on this device. Apply via /permission-requests or /temporary-unlock first.',
            );
          }
        }

        const cmd = await prisma.deviceCommand.create({
          data: {
            deviceId: device.id,
            commandType,
            issuedByUserId: ctx.userId,
            source: 'app',
            link: 'ble',
            status: 'pending',
            timeoutAt: new Date(Date.now() + BLE_PRECHECK_TIMEOUT_MS),
            phoneLat: phoneLat ?? null,
            phoneLng: phoneLng ?? null,
            phoneAccuracyM: phoneAccuracyM ?? null,
            occurredAt,
            serverNote,
          },
        });
        // Find the most recently-active grant's validUntil so the APP
        // can decide whether to also revalidate before opening.
        const liveGrant = await prisma.deviceAssignment.findFirst({
          where: {
            deviceId: device.id,
            revokedAt: null,
            OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }],
          },
          orderBy: { id: 'desc' },
          select: { validUntil: true },
        });

        reply.code(201);
        return {
          commandId: cmd.id.toString(),
          deviceId: device.id.toString(),
          lockId: device.lockId,
          bleMac: device.bleMac,
          link: 'ble' as const,
          // 1-byte cmdId derived from the DB row; APP must echo it in
          // the BLE frame's cmdId slot so the lock's reply can be
          // matched back to this command.
          expectedCmdId: bleCmdIdFor(cmd.id),
          timeoutAt: cmd.timeoutAt!.toISOString(),
          validUntil: liveGrant?.validUntil?.toISOString() ?? null,
          serverNote,
        };
      }

      // ---------------- LoRa / 4G downlink path (legacy) ----------------
      let frame: Buffer;
      let publish: () => Promise<void>;

      if (effective === 'lora') {
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
          link: effective,
          gatewayId: effective === 'lora' ? device.gatewayId : null,
          requestPayload: frame,
          status: 'pending',
          timeoutAt: new Date(Date.now() + COMMAND_TIMEOUT_MS),
          phoneLat: phoneLat ?? null,
          phoneLng: phoneLng ?? null,
          phoneAccuracyM: phoneAccuracyM ?? null,
          occurredAt,
          serverNote,
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
        link: effective,
        timeoutAt: cmd.timeoutAt?.toISOString() ?? null,
        serverNote,
      };
    },
  );

  /**
   * v2.8 BLE precheck: APP completes the unlock then posts the result
   * here. We
   *   - clamp/validate occurredAt (same rules as command creation)
   *   - flip the DeviceCommand row to acked|failed
   *   - persist the ack-time GPS
   *   - create a lock_event row (source='ble') so the device's audit
   *     timeline matches the LoRa/4G code path
   */
  typed.post(
    '/device-commands/:id/ack',
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: AckDeviceCommandSchema,
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const cmd = await prisma.deviceCommand.findUnique({
        where: { id },
        include: { device: true },
      });
      if (!cmd) throw ApiError.notFound();
      // Caller must be in scope of the device's company. For non-
      // admin members, also require that they were the original
      // requester so a different team-mate can't ack someone else's
      // BLE op.
      const scope = scopeToCompany(ctx);
      if (scope.companyId && cmd.device.ownerCompanyId !== scope.companyId) {
        throw ApiError.forbidden();
      }
      const isAdmin =
        ctx.role === 'vendor_admin' || ctx.role === 'company_admin';
      if (!isAdmin && cmd.issuedByUserId !== ctx.userId) {
        throw ApiError.forbidden('Only the original requester may ack');
      }
      if (cmd.status !== 'pending' && cmd.status !== 'sent') {
        throw ApiError.conflict(`Command already ${cmd.status}`);
      }
      if (cmd.link !== 'ble') {
        throw ApiError.conflict(
          'ack endpoint is for BLE-link commands; LoRa/4G paths are auto-resolved by gateway uplinks',
        );
      }

      const { occurredAt, serverNote: ackNote } = resolveOccurredAt(
        req.body.occurredAt,
      );

      // Stitch the ack note onto whatever was already on the row at
      // creation, separated by " | " so both annotations survive.
      const mergedNote =
        cmd.serverNote && ackNote
          ? `${cmd.serverNote} | ack: ${ackNote}`
          : ackNote
            ? `ack: ${ackNote}`
            : cmd.serverNote;

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.deviceCommand.update({
          where: { id },
          data: {
            status: req.body.ok ? 'acked' : 'failed',
            ackedAt: new Date(),
            errorMessage: req.body.ok ? null : (req.body.errorMessage ?? 'BLE failure'),
            ackPhoneLat: req.body.phoneLat ?? null,
            ackPhoneLng: req.body.phoneLng ?? null,
            ackPhoneAccuracyM: req.body.phoneAccuracyM ?? null,
            occurredAt,
            serverNote: mergedNote,
          },
        });

        // Always write a lock_event row so the audit timeline has the
        // same shape as a LoRa/4G uplink. eventType is derived from
        // the command, source is 'ble'. Failures still get logged as
        // an event so we know an attempt was made.
        const eventType =
          cmd.commandType === 'unlock'
            ? 'opened'
            : cmd.commandType === 'lock'
              ? 'closed'
              : 'heartbeat';
        if (req.body.ok) {
          const event = await tx.lockEvent.create({
            data: {
              deviceId: cmd.deviceId,
              companyId: cmd.device.ownerCompanyId,
              eventType,
              source: 'ble',
              operatorUserId: ctx.userId,
              lat: req.body.phoneLat ?? null,
              lng: req.body.phoneLng ?? null,
              createdAt: occurredAt,
            },
          });
          await tx.deviceCommand.update({
            where: { id },
            data: { resultEventId: event.id },
          });
          // Reflect the new state on device.lastState so the UI mirrors
          // what just happened over BLE.
          if (eventType === 'opened' || eventType === 'closed') {
            await tx.device.update({
              where: { id: cmd.deviceId },
              data: {
                lastState: eventType,
                lastSeenAt: occurredAt,
              },
            });
          }
        }
        return updated;
      });

      reply.code(200);
      return {
        commandId: result.id.toString(),
        status: result.status,
        ackedAt: result.ackedAt?.toISOString() ?? null,
        occurredAt: result.occurredAt?.toISOString() ?? null,
        serverNote: result.serverNote,
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
