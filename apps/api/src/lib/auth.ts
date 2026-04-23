import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@abd/shared';
import { ApiError } from '@abd/shared';

export interface AuthContext {
  userId: bigint;
  role: UserRole;
  companyId: bigint | null;
}

export function getAuthContext(req: FastifyRequest): AuthContext {
  const user = req.user as { sub: string; role: UserRole; companyId: string | null } | undefined;
  if (!user) throw ApiError.unauthorized();
  return {
    userId: BigInt(user.sub),
    role: user.role,
    companyId: user.companyId ? BigInt(user.companyId) : null,
  };
}

/**
 * Fastify onRequest hook that enforces the requester has ONE OF the given roles.
 * Must be chained after `app.authenticate` (JWT verify) so `req.user` is populated.
 */
export function requireRole(...roles: UserRole[]) {
  return async function enforce(req: FastifyRequest, _reply: FastifyReply) {
    const ctx = getAuthContext(req);
    if (!roles.includes(ctx.role)) {
      throw ApiError.forbidden(`Requires role: ${roles.join(' or ')}`);
    }
  };
}

/**
 * Vendor admins bypass company scoping. Regular users are limited to their
 * company. Returns a where-clause fragment to apply to Prisma queries.
 */
export function scopeToCompany(ctx: AuthContext): { companyId?: bigint } {
  if (ctx.role === 'vendor_admin') return {};
  if (ctx.companyId == null) throw ApiError.forbidden('User is not in a company');
  return { companyId: ctx.companyId };
}
