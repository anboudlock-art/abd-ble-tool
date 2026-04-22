import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@abd/db';
import { LoginRequestSchema, ApiError } from '@abd/shared';

export default async function authRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

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
      };
    },
  );
}
