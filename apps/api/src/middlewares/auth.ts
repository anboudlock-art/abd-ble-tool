import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { loadConfig } from '../config.js';
import { ApiError } from '@abd/shared';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string; companyId: string | null };
    user: { sub: string; role: string; companyId: string | null };
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  const config = loadConfig();

  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: `${config.JWT_TTL_MINUTES}m` },
  });

  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw ApiError.unauthorized();
    }
  });
});
