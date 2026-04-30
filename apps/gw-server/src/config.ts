import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GW_TCP_PORT: z.coerce.number().int().positive().default(8901),
  GW_TCP_HOST: z.string().default('0.0.0.0'),
  GW_REGISTER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  GW_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  /** 4GBLE093 lock direct-TCP listener. Set 0 to disable. */
  LOCK_TCP_PORT: z.coerce.number().int().nonnegative().default(8088),
  LOCK_TCP_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | undefined;
export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid configuration:', parsed.error.format());
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
