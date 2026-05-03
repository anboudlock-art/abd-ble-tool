import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@abd/db';
import { ChangePasswordSchema, LoginRequestSchema, SetPasswordSchema, ApiError } from '@abd/shared';
import { loadConfig } from '../config.js';

function newRefreshToken(): { plain: string; hash: string } {
  const plain = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, hash };
}

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
            refreshToken: z.string(),
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

      // Refresh token is a 48-byte random string; we store only its
      // SHA-256 in the DB. TTL = REFRESH_TOKEN_TTL_DAYS.
      const { plain: refreshToken, hash } = newRefreshToken();
      await prisma.refreshToken.create({
        data: {
          tokenHash: hash,
          userId: user.id,
          expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400_000),
          userAgent: req.headers['user-agent']?.toString().slice(0, 255) ?? null,
          clientIp: req.ip,
        },
      });

      return {
        accessToken,
        refreshToken,
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

  /**
   * Exchange a refresh token for a new short-lived access token. Rotates
   * the refresh token (issuing a fresh one and revoking the old) so a
   * leaked refresh token can be used at most once.
   */
  typed.post(
    '/auth/refresh',
    {
      schema: {
        body: z.object({ refreshToken: z.string().min(20) }),
      },
    },
    async (req) => {
      const hash = createHash('sha256').update(req.body.refreshToken).digest('hex');
      const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (!row || row.revokedAt || row.expiresAt < new Date()) {
        throw ApiError.unauthorized('Invalid or expired refresh token');
      }
      const user = await prisma.user.findUnique({ where: { id: row.userId } });
      if (!user || user.status !== 'active' || user.deletedAt) {
        throw ApiError.unauthorized();
      }

      // Rotate
      const fresh = newRefreshToken();
      await prisma.$transaction([
        prisma.refreshToken.update({
          where: { id: row.id },
          data: { revokedAt: new Date(), lastUsedAt: new Date() },
        }),
        prisma.refreshToken.create({
          data: {
            tokenHash: fresh.hash,
            userId: user.id,
            expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400_000),
            userAgent: req.headers['user-agent']?.toString().slice(0, 255) ?? null,
            clientIp: req.ip,
          },
        }),
      ]);

      const accessToken = app.jwt.sign({
        sub: user.id.toString(),
        role: user.role,
        companyId: user.companyId?.toString() ?? null,
      });

      return { accessToken, refreshToken: fresh.plain };
    },
  );

  /** Logout: revoke the supplied refresh token (best-effort). */
  typed.post(
    '/auth/logout',
    {
      onRequest: [app.authenticate],
      schema: {
        body: z.object({ refreshToken: z.string().min(20).optional() }),
      },
    },
    async (req, reply) => {
      if (req.body.refreshToken) {
        const hash = createHash('sha256').update(req.body.refreshToken).digest('hex');
        await prisma.refreshToken.updateMany({
          where: { tokenHash: hash, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      reply.code(204);
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
