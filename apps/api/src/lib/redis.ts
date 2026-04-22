import { Redis } from 'ioredis';
import { loadConfig } from '../config.js';

let redis: InstanceType<typeof Redis> | undefined;

export function getRedis(): InstanceType<typeof Redis> {
  if (!redis) {
    const config = loadConfig();
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return redis;
}
