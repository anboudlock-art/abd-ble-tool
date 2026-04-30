import './lib/bigint.js'; // must come first: installs BigInt→string serializer
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { loadConfig } from './config.js';
import authPlugin from './middlewares/auth.js';
import errorHandlerPlugin from './middlewares/error-handler.js';
import auditPlugin from './middlewares/audit-log.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import deviceModelRoutes from './routes/device-models.js';
import productionBatchRoutes from './routes/production-batches.js';
import productionScanRoutes from './routes/production-scans.js';
import deviceRoutes from './routes/devices.js';
import deviceTransferRoutes from './routes/device-transfers.js';
import companyRoutes from './routes/companies.js';
import departmentRoutes from './routes/departments.js';
import userRoutes from './routes/users.js';
import deviceCommandRoutes from './routes/device-commands.js';
import alarmRoutes from './routes/alarms.js';
import dashboardRoutes from './routes/dashboard.js';
import integrationRoutes from './routes/integrations.js';
import openApiRoutes from './routes/open-api.js';
import openApiAuthPlugin from './middlewares/open-api-auth.js';

export async function buildApp() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    disableRequestLogging: config.NODE_ENV === 'test',
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySensible);
  await app.register(fastifyCors, { origin: config.CORS_ORIGIN, credentials: true });
  await app.register(fastifyHelmet);
  await app.register(fastifyRateLimit, {
    max: config.NODE_ENV === 'test' ? 10_000 : 100,
    timeWindow: '1 minute',
  });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(deviceModelRoutes, { prefix: '/api/v1' });
  await app.register(productionBatchRoutes, { prefix: '/api/v1' });
  await app.register(productionScanRoutes, { prefix: '/api/v1' });
  await app.register(deviceRoutes, { prefix: '/api/v1' });
  await app.register(deviceTransferRoutes, { prefix: '/api/v1' });
  await app.register(companyRoutes, { prefix: '/api/v1' });
  await app.register(departmentRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(deviceCommandRoutes, { prefix: '/api/v1' });
  await app.register(alarmRoutes, { prefix: '/api/v1' });
  await app.register(dashboardRoutes, { prefix: '/api/v1' });
  await app.register(integrationRoutes, { prefix: '/api/v1' });

  // Public Open API for third-party integrations. Different prefix + HMAC auth.
  await app.register(async (scope) => {
    await scope.register(openApiAuthPlugin);
    await scope.register(openApiRoutes);
  }, { prefix: '/openapi/v1' });

  return app;
}
