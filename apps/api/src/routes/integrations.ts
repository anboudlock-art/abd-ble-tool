import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@abd/db';
import {
  ApiError,
  CreateIntegrationAppSchema,
  CreateWebhookSubscriptionSchema,
} from '@abd/shared';
import { getAuthContext, requireRole } from '../lib/auth.js';

function newAppKey(): string {
  return 'abd_' + randomBytes(16).toString('hex');
}
function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export default async function integrationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Create an Open API key for the caller's company.
   * Returns the plaintext appSecret ONCE — caller must persist it.
   */
  typed.post(
    '/integrations/apps',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { body: CreateIntegrationAppSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const { name, scopes, ipWhitelist } = req.body;
      const companyId = ctx.companyId ?? null;
      if (!companyId) throw ApiError.conflict('Vendor admin must scope a company');

      const appKey = newAppKey();
      const secret = newSecret();

      const created = await prisma.integrationApp.create({
        data: {
          companyId,
          name,
          appKey,
          appSecretHash: secret, // see open-api-auth.ts: stored raw on purpose
          scopes,
          ipWhitelist: ipWhitelist ?? undefined,
        },
      });
      reply.code(201);
      return {
        id: created.id.toString(),
        name: created.name,
        appKey,
        appSecret: secret, // shown ONCE
        scopes,
      };
    },
  );

  typed.get(
    '/integrations/apps',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const where =
        ctx.role === 'vendor_admin'
          ? { deletedAt: null }
          : { companyId: ctx.companyId!, deletedAt: null };
      const apps = await prisma.integrationApp.findMany({
        where,
        orderBy: { id: 'desc' },
        include: { _count: { select: { webhookSubs: true } } },
      });
      return {
        items: apps.map((a) => ({
          id: a.id.toString(),
          name: a.name,
          appKey: a.appKey,
          scopes: a.scopes,
          status: a.status,
          ipWhitelist: a.ipWhitelist,
          webhookCount: a._count.webhookSubs,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  );

  typed.delete(
    '/integrations/apps/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const target = await prisma.integrationApp.findUnique({
        where: { id: BigInt(req.params.id) },
      });
      if (!target) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && target.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      await prisma.integrationApp.update({
        where: { id: target.id },
        data: { status: 'revoked', deletedAt: new Date() },
      });
      reply.code(204);
    },
  );

  // -------- Webhook subscriptions --------

  typed.post(
    '/integrations/apps/:id/webhooks',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: CreateWebhookSubscriptionSchema,
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const intApp = await prisma.integrationApp.findUnique({
        where: { id: BigInt(req.params.id) },
      });
      if (!intApp) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && intApp.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      const sub = await prisma.webhookSubscription.create({
        data: {
          integrationAppId: intApp.id,
          url: req.body.url,
          eventTypes: req.body.eventTypes,
          secret: newSecret(),
        },
      });
      reply.code(201);
      return {
        id: sub.id.toString(),
        url: sub.url,
        eventTypes: sub.eventTypes,
        secret: sub.secret, // shown once on creation; client uses to verify deliveries
        active: sub.active,
        createdAt: sub.createdAt.toISOString(),
      };
    },
  );

  typed.get(
    '/integrations/apps/:id/webhooks',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const intApp = await prisma.integrationApp.findUnique({
        where: { id: BigInt(req.params.id) },
      });
      if (!intApp) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && intApp.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      const subs = await prisma.webhookSubscription.findMany({
        where: { integrationAppId: intApp.id },
        orderBy: { id: 'desc' },
      });
      return {
        items: subs.map((s) => ({
          id: s.id.toString(),
          url: s.url,
          eventTypes: s.eventTypes,
          active: s.active,
          lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
          lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
          failureCount: s.failureCount,
        })),
      };
    },
  );

  typed.delete(
    '/integrations/webhooks/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const sub = await prisma.webhookSubscription.findUnique({
        where: { id: BigInt(req.params.id) },
        include: { integrationApp: true },
      });
      if (!sub) throw ApiError.notFound();
      if (ctx.role !== 'vendor_admin' && sub.integrationApp.companyId !== ctx.companyId) {
        throw ApiError.forbidden();
      }
      await prisma.webhookSubscription.delete({ where: { id: sub.id } });
      reply.code(204);
    },
  );
}
