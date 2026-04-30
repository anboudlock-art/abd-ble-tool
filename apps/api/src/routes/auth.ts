import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@abd/db';
import { ChangePasswordSchema, LoginRequestSchema, SetPasswordSchema, ApiError } from '@abd/shared';
import { loadConfig } from '../config.js';

export default async function authRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const config = loadConfig();

  typed.post(
    '/auth/login',
    {
      schema: {
        body: LoginRequestSchema,
        response: {
          200: z.object({
            accessToken: z.string(),
            user: z.object({
              id: z.string(),
              name: z.string(),
              role: z.string(),
              companyId: z.string().nullable(),
              mustChangePassword: z.boolean(),
            }),
          }),
        },
      },
    },
    async (req) => {
      const { phone, password } = req.body;
      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user || user.status !== 'active' || !user.passwordHash) {
        throw ApiError.unauthorized('Invalid credentials');
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw ApiError.unauthorized('Invalid credentials');

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const accessToken = app.jwt.sign({
        sub: user.id.toString(),
        role: user.role,
        companyId: user.companyId?.toString() ?? null,
      });

      return {
        accessToken,
        user: {
          id: user.id.toString(),
          name: user.name,
          role: user.role,
          companyId: user.companyId?.toString() ?? null,
          mustChangePassword: user.mustChangePassword,
        },
      };
    },
  );

  typed.get(
    '/auth/me',
    { onRequest: [app.authenticate] },
    async (req) => {
      const sub = (req.user as { sub: string }).sub;
      const user = await prisma.user.findUnique({ where: { id: BigInt(sub) } });
      if (!user) throw ApiError.notFound('User not found');
      return {
        id: user.id.toString(),
        name: user.name,
        phone: user.phone,
        role: user.role,
        companyId: user.companyId?.toString() ?? null,
        mustChangePassword: user.mustChangePassword,
      };
    },
  );

  /** Self-service password change for the logged-in user. */
  typed.post(
    '/auth/change-password',
    {
      onRequest: [app.authenticate],
      schema: { body: ChangePasswordSchema },
    },
    async (req, reply) => {
      const sub = (req.user as { sub: string }).sub;
      const user = await prisma.user.findUnique({ where: { id: BigInt(sub) } });
      if (!user || !user.passwordHash) throw ApiError.unauthorized();

      const ok = await bcrypt.compare(req.body.oldPassword, user.passwordHash);
      if (!ok) throw ApiError.unauthorized('Old password incorrect');

      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });
      reply.code(204);
    },
  );

  /**
   * Bootstrap endpoint. Allows setting a password in two scenarios:
   * 1. Caller presents a valid setupToken (matching VENDOR_BOOTSTRAP_TOKEN env)
   *    — required the first time, since seeded users have no password yet.
   * 2. Caller is an authenticated user changing their OWN password.
   */
  typed.post(
    '/auth/set-password',
    { schema: { body: SetPasswordSchema } },
    async (req, reply) => {
      const { phone, password, setupToken } = req.body;

      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user) throw ApiError.notFound('User not found');

      let authorized = false;
      if (setupToken && config.VENDOR_BOOTSTRAP_TOKEN && setupToken === config.VENDOR_BOOTSTRAP_TOKEN) {
        authorized = true;
      } else {
        // Try JWT path
        try {
          await req.jwtVerify();
          const callerSub = (req.user as { sub: string }).sub;
          if (BigInt(callerSub) === user.id) authorized = true;
        } catch {
          // fall through
        }
      }
      if (!authorized) throw ApiError.unauthorized();

      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, status: 'active' },
      });
      reply.code(204);
      return;
    },
  );
}
