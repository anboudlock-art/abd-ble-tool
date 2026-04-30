import { Worker, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { notify, prisma } from '@abd/db';
import { signWebhookBody } from './hmac.js';

const ConfigSchema = z.object({
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const config = ConfigSchema.parse(process.env);
const log = pino({
  level: config.LOG_LEVEL,
  transport:
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
      : undefined,
});

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUE_WEBHOOK_DELIVERY = 'webhook-delivery';
export const QUEUE_COMMAND_TIMEOUT = 'command-timeout';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_OFFLINE_CHECK = 'offline-check';

export const queues = {
  webhookDelivery: new Queue(QUEUE_WEBHOOK_DELIVERY, { connection }),
  commandTimeout: new Queue(QUEUE_COMMAND_TIMEOUT, { connection }),
  notifications: new Queue(QUEUE_NOTIFICATIONS, { connection }),
  offlineCheck: new Queue(QUEUE_OFFLINE_CHECK, { connection }),
};

interface WebhookJob {
  subscriptionId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

const workers = [
  new Worker<WebhookJob>(
    QUEUE_WEBHOOK_DELIVERY,
    async (job) => {
      const { subscriptionId, eventId, payload, eventType } = job.data;
      const sub = await prisma.webhookSubscription.findUnique({
        where: { id: BigInt(subscriptionId) },
      });
      if (!sub || !sub.active) return;

      const body = JSON.stringify({
        id: eventId,
        type: eventType,
        deliveryAttempt: job.attemptsStarted ?? 1,
        timestamp: Math.floor(Date.now() / 1000),
        data: payload,
      });
      const signature = signWebhookBody(sub.secret, body);

      const start = Date.now();
      let httpStatus: number | null = null;
      let responseText = '';
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-abd-event': eventType,
            'x-abd-delivery': job.id ?? '',
            'x-abd-signature': signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        httpStatus = res.status;
        responseText = (await res.text()).slice(0, 2048);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } finally {
        const durationMs = Date.now() - start;
        await prisma.webhookDelivery.create({
          data: {
            subscriptionId: sub.id,
            eventId: BigInt(eventId),
            httpStatus,
            responseBody: responseText || null,
            durationMs,
            attempt: job.attemptsStarted ?? 1,
          },
        });
        const ok = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
        await prisma.webhookSubscription.update({
          where: { id: sub.id },
          data: ok
            ? { lastSuccessAt: new Date(), failureCount: 0 }
            : {
                lastFailureAt: new Date(),
                failureCount: { increment: 1 },
              },
        });
      }
    },
    {
      connection,
      concurrency: 8,
      limiter: { max: 50, duration: 1000 },
    },
  ),

  new Worker(
    QUEUE_COMMAND_TIMEOUT,
    async (job) => {
      const { commandId } = job.data as { commandId: string };
      const cmd = await prisma.deviceCommand.findUnique({
        where: { id: BigInt(commandId) },
        include: { device: true },
      });
      if (!cmd) return;
      if (cmd.status === 'pending' || cmd.status === 'sent') {
        await prisma.deviceCommand.update({
          where: { id: cmd.id },
          data: { status: 'timeout' },
        });
        const msg = `锁 ${cmd.device.lockId} 远程指令 ${cmd.commandType} 超时未响应`;
        await prisma.alarm.create({
          data: {
            deviceId: cmd.deviceId,
            companyId: cmd.device.ownerCompanyId,
            type: 'command_timeout',
            severity: 'warning',
            message: msg,
            payload: { commandId: cmd.id.toString() },
          },
        });
        await notify({
          companyId: cmd.device.ownerCompanyId,
          kind: 'alarm',
          title: '指令超时',
          body: msg,
          link: `/devices/${cmd.deviceId}`,
        });
      }
    },
    { connection },
  ),

  new Worker(
    QUEUE_NOTIFICATIONS,
    async (job) => {
      log.info({ jobId: job.id, data: job.data }, 'notification dispatch (stub)');
    },
    { connection },
  ),

  /**
   * Periodic offline check: any device whose lastSeenAt is older than the
   * threshold AND that we haven't already alerted for in the current
   * lastSeenAt window gets a single offline alarm.
   *
   * Threshold: 1 hour for devices that have ever reported (lastSeenAt set).
   * Devices that have never reported are NOT counted (might just be in
   * warehouse waiting to be installed).
   */
  new Worker(
    QUEUE_OFFLINE_CHECK,
    async () => {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      const stale = await prisma.device.findMany({
        where: {
          status: 'active',
          lastSeenAt: { lt: cutoff },
          deletedAt: null,
        },
        select: { id: true, lockId: true, ownerCompanyId: true, lastSeenAt: true },
      });
      let raised = 0;
      for (const d of stale) {
        // dedup by device + lastSeenAt (one alarm per offline window)
        const dedupKey = `${d.id}:offline:${d.lastSeenAt!.getTime()}`;
        const existing = await prisma.alarm.findFirst({
          where: { dedupKey },
          select: { id: true },
        });
        if (existing) continue;
        const msg = `锁 ${d.lockId} 已超过 60 分钟未上报`;
        await prisma.alarm.create({
          data: {
            deviceId: d.id,
            companyId: d.ownerCompanyId,
            type: 'offline',
            severity: 'warning',
            message: msg,
            payload: {
              lastSeenAt: d.lastSeenAt!.toISOString(),
              cutoff: cutoff.toISOString(),
            },
            dedupKey,
          },
        });
        await notify({
          companyId: d.ownerCompanyId,
          kind: 'alarm',
          title: '设备离线',
          body: msg,
          link: `/devices/${d.id}`,
        });
        raised++;
      }
      if (raised > 0) log.info({ raised }, 'offline alarms raised');
    },
    { connection, concurrency: 1 },
  ),
];

// Fan-out: subscribe to Redis 'abd:lock-event' pub/sub, look up matching
// webhook subscriptions, and enqueue one delivery job per match.
const subscriber = new Redis(config.REDIS_URL);
const CHAN_LOCK_EVENT = 'abd:lock-event';
subscriber.subscribe(CHAN_LOCK_EVENT).catch((err) =>
  log.warn({ err }, 'subscribe failed'),
);
subscriber.on('message', async (channel, raw) => {
  if (channel !== CHAN_LOCK_EVENT) return;
  try {
    const msg = JSON.parse(raw) as { eventId: string; deviceId: string };
    const event = await prisma.lockEvent.findUnique({
      where: { id: BigInt(msg.eventId) },
      include: { device: true },
    });
    if (!event || !event.companyId) return;

    const eventType = `lock.${event.eventType}`;
    const subs = await prisma.webhookSubscription.findMany({
      where: {
        active: true,
        integrationApp: { companyId: event.companyId, status: 'active' },
      },
    });
    const targets = subs.filter((s) => {
      const types = s.eventTypes as unknown as string[];
      return types.includes(eventType);
    });
    for (const sub of targets) {
      await queues.webhookDelivery.add(
        'deliver',
        {
          subscriptionId: sub.id.toString(),
          eventId: event.id.toString(),
          eventType,
          payload: {
            deviceId: event.deviceId.toString(),
            lockId: event.device.lockId,
            bleMac: event.device.bleMac,
            battery: event.battery,
            createdAt: event.createdAt.toISOString(),
          },
        },
        { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
      );
    }
  } catch (err) {
    log.warn({ err }, 'fan-out failed');
  }
});

// Recurring jobs
await queues.offlineCheck.add(
  'offline-sweep',
  {},
  {
    repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
    jobId: 'offline-sweep-singleton',
  },
);

log.info({ queues: workers.map((w) => w.name) }, 'worker started');

const shutdown = async (signal: string) => {
  log.info(`Received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
