import './lib/bigint.js'; // must come first: installs BigInt→string serializer
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
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
import notificationRoutes from './routes/notifications.js';
import auditLogRoutes from './routes/audit-logs.js';
import integrationRoutes from './routes/integrations.js';
import firmwareRoutes from './routes/firmware.js';
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
  // Helmet is fine for normal API traffic but its strict CSP breaks
  // Swagger UI's inline-script bootstrap. Allow inline 'self' for /docs.
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // OpenAPI: build a spec from every zod-validated route, render it at /docs.
  if (config.NODE_ENV !== 'test') {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Anboud Smart Lock Platform — Internal API',
          description:
            'JWT-protected API for the management Web. For third-party integration (HMAC-signed), see /openapi/v1/*.',
          version: '0.1.0',
        },
        servers: [{ url: '/' }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }
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
  await app.register(notificationRoutes, { prefix: '/api/v1' });
  await app.register(auditLogRoutes, { prefix: '/api/v1' });
  await app.register(integrationRoutes, { prefix: '/api/v1' });
  await app.register(firmwareRoutes, { prefix: '/api/v1' });

  // Public Open API for third-party integrations. Different prefix + HMAC auth.
  await app.register(async (scope) => {
    await scope.register(openApiAuthPlugin);
    await scope.register(openApiRoutes);
  }, { prefix: '/openapi/v1' });

  // Curated documentation for the Open API surface only. Reuses the
  // already-generated swagger spec but filters to /openapi/v1/* paths.
  if (config.NODE_ENV !== 'test') {
    app.get('/openapi-docs/openapi.json', async () => {
      // app.swagger() is the helper that returns the active spec.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spec = (app as unknown as { swagger: () => any }).swagger();
      const filtered = JSON.parse(JSON.stringify(spec));
      const paths = filtered.paths ?? {};
      filtered.paths = Object.fromEntries(
        Object.entries(paths).filter(([p]) => p.startsWith('/openapi/v1')),
      );
      filtered.info = {
        title: 'Anboud — Open API for Third-Party Integration',
        description:
          'HMAC-SHA256 signed REST endpoints. See /docs (internal) for the' +
          ' management API. Headers: X-Abd-Key, X-Abd-Timestamp,' +
          ' X-Abd-Nonce, X-Abd-Signature.',
        version: '0.1.0',
      };
      filtered.security = [];
      filtered.components = {
        ...(filtered.components ?? {}),
        securitySchemes: {
          AbdHmac: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Abd-Signature',
            description:
              'HMAC-SHA256 over METHOD\\nPATH\\nTIMESTAMP\\nNONCE\\nHMAC(body).' +
              ' Send X-Abd-Key/Timestamp/Nonce alongside.',
          },
        },
      };
      return filtered;
    });

    app.get('/openapi-docs', async (_req, reply) => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Anboud Open API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body{margin:0}#swagger-ui{max-width:1200px;margin:0 auto}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi-docs/openapi.json',
      dom_id: '#swagger-ui',
      docExpansion: 'list',
      deepLinking: true,
    });
  </script>
</body>
</html>`;
      reply.type('text/html').send(html);
    });
  }

  return app;
}
