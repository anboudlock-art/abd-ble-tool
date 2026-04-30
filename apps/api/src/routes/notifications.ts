import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma, prisma } from '@abd/db';
import { ApiError } from '@abd/shared';
import { getAuthContext } from '../lib/auth.js';

export default async function notificationRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/notifications',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
          unreadOnly: z.coerce.boolean().default(false),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize, unreadOnly } = req.query;
      const where: Prisma.NotificationWhereInput = {
        userId: ctx.userId,
        ...(unreadOnly ? { readAt: null } : {}),
      };

      const [items, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: { userId: ctx.userId, readAt: null },
        }),
      ]);

      return {
        items: items.map((n) => ({
          id: n.id.toString(),
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
          payload: n.payload,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
        total,
        unreadCount,
        page,
        pageSize,
      };
    },
  );

  /** Mark a single notification read. */
  typed.post(
    '/notifications/:id/read',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const n = await prisma.notification.findUnique({ where: { id } });
      if (!n) throw ApiError.notFound();
      if (n.userId !== ctx.userId) throw ApiError.forbidden();

      if (!n.readAt) {
        await prisma.notification.update({
          where: { id },
          data: { readAt: new Date() },
        });
      }
      reply.code(204);
    },
  );

  /** Mark all unread notifications for the caller as read. */
  typed.post(
    '/notifications/read-all',
    { onRequest: [app.authenticate] },
    async (req) => {
      const ctx = getAuthContext(req);
      const result = await prisma.notification.updateMany({
        where: { userId: ctx.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { markedRead: result.count };
    },
  );
}
