import { Worker, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

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

const workers = [
  new Worker(
    QUEUE_WEBHOOK_DELIVERY,
    async (job) => {
      log.info({ jobId: job.id, data: job.data }, 'webhook delivery (stub)');
    },
    { connection },
  ),
  new Worker(
    QUEUE_COMMAND_TIMEOUT,
    async (job) => {
      log.info({ jobId: job.id, data: job.data }, 'command timeout check (stub)');
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

log.info({ queues: workers.map((w) => w.name) }, 'worker started');

const shutdown = async (signal: string) => {
  log.info(`Received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
