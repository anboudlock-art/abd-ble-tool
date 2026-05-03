import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@abd/db';
import { ApiError, type IntegrationScope } from '@abd/shared';
import { canonicalRequest, verifySignature } from '../lib/hmac.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
    integrationApp?: {
      id: bigint;
      companyId: bigint;
      scopes: IntegrationScope[];
    };
  }
  interface FastifyInstance {
    requireAppKey: (
      ...required: IntegrationScope[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const SKEW_SECONDS = 300;

export default fp(async function openApiAuthPlugin(app: FastifyInstance) {
  // Capture the raw body so the canonical request can be reproduced exactly.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const buf = body as Buffer;
        (req as FastifyRequest).rawBody = buf;
        const text = buf.toString('utf-8');
        done(null, text.length === 0 ? {} : JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.decorate(
    'requireAppKey',
    (...required: IntegrationScope[]) =>
      async function enforce(req: FastifyRequest, _reply: FastifyReply) {
        const headers = req.headers;
        const appKey = headers['x-abd-key']?.toString();
        const timestamp = headers['x-abd-timestamp']?.toString();
        const nonce = headers['x-abd-nonce']?.toString();
        const signature = headers['x-abd-signature']?.toString();

        if (!appKey || !timestamp || !nonce || !signature) {
          throw ApiError.unauthorized('Missing X-Abd-* signature headers');
        }

        const ts = Number.parseInt(timestamp, 10);
        if (!Number.isFinite(ts)) throw ApiError.unauthorized('Invalid timestamp');
        if (Math.abs(Math.floor(Date.now() / 1000) - ts) > SKEW_SECONDS) {
          throw ApiError.unauthorized('Timestamp skew too large');
        }

        const intApp = await prisma.integrationApp.findUnique({ where: { appKey } });
        if (!intApp || intApp.status !== 'active' || intApp.deletedAt) {
          throw ApiError.unauthorized('Unknown or revoked app key');
        }

        const ip = req.ip;
        const whitelist = (intApp.ipWhitelist ?? []) as unknown as string[] | null;
        if (Array.isArray(whitelist) && whitelist.length > 0 && !whitelist.includes(ip)) {
          throw ApiError.forbidden('IP not in whitelist');
        }

        const rawBody = req.rawBody ?? Buffer.alloc(0);
        const canonical = canonicalRequest({
          method: req.method,
          path: req.url.split('?')[0] ?? req.url,
          timestamp,
          nonce,
          bodyBytes: rawBody,
        });

        // appSecretHash column actually stores the raw signing secret — a
        // 64-char base64url string with ~256 bits of entropy. Bcrypt is not
        // appropriate because we need the plaintext to recompute the HMAC.
        if (!verifySignature(intApp.appSecretHash, canonical, signature)) {
          throw ApiError.unauthorized('Bad signature');
        }

        const scopes = (intApp.scopes ?? []) as unknown as IntegrationScope[];
        for (const r of required) {
          if (!scopes.includes(r)) throw ApiError.forbidden(`Missing scope: ${r}`);
        }

        req.integrationApp = { id: intApp.id, companyId: intApp.companyId, scopes };
      },
  );
});
