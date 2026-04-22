import type { FastifyInstance } from 'fastify';
import { prisma } from '@abd/db';
import { getRedis } from '../lib/redis.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({ status: 'ok', time: new Date().toISOString() }));

  app.get('/readyz', async (_req, reply) => {
    const checks: Record<string, 'ok' | string> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (err) {
      checks.database = err instanceof Error ? err.message : 'unknown';
    }

    try {
      const pong = await getRedis().ping();
      checks.redis = pong === 'PONG' ? 'ok' : pong;
    } catch (err) {
      checks.redis = err instanceof Error ? err.message : 'unknown';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    reply.code(allOk ? 200 : 503);
    return { status: allOk ? 'ready' : 'not_ready', checks };
  });
}
