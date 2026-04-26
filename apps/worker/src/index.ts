import { Worker, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { prisma } from '@abd/db';
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

export const queues = {
  webhookDelivery: new Queue(QUEUE_WEBHOOK_DELIVERY, { connection }),
  commandTimeout: new Queue(QUEUE_COMMAND_TIMEOUT, { connection }),
  notifications: new Queue(QUEUE_NOTIFICATIONS, { connection }),
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
      const cmd = await prisma.deviceCommand.findUnique({ where: { id: BigInt(commandId) } });
      if (!cmd) return;
      if (cmd.status === 'pending' || cmd.status === 'sent') {
        await prisma.deviceCommand.update({
          where: { id: cmd.id },
          data: { status: 'timeout' },
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

log.info({ queues: workers.map((w) => w.name) }, 'worker started');

const shutdown = async (signal: string) => {
  log.info(`Received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
