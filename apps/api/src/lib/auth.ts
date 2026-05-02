import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@abd/shared';
import { ApiError } from '@abd/shared';

export interface AuthContext {
  userId: bigint;
  role: UserRole;
  companyId: bigint | null;
  /**
   * v2.7 vendor "view-as-company": if a vendor_admin sends an
   * X-View-As-Company: <id> header, this carries the parsed id so
   * scopeToCompany() can pretend the vendor is scoped to that company.
   * Has no effect for non-vendor callers.
   */
  viewAsCompanyId: bigint | null;
}

const VIEW_HEADER = 'x-view-as-company';

function parseViewHeader(req: FastifyRequest): bigint | null {
  const raw = req.headers[VIEW_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    const n = BigInt(trimmed);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

export function getAuthContext(req: FastifyRequest): AuthContext {
  const user = req.user as { sub: string; role: UserRole; companyId: string | null } | undefined;
  if (!user) throw ApiError.unauthorized();
  return {
    userId: BigInt(user.sub),
    role: user.role,
    companyId: user.companyId ? BigInt(user.companyId) : null,
    viewAsCompanyId: parseViewHeader(req),
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
 * Vendor admins normally bypass company scoping. With the v2.7 view-as
 * header set, they get scoped to the impersonated company instead so the
 * vendor can preview a customer's view without re-logging in. Regular
 * users are always limited to their own company; the view header is
 * ignored for them.
 */
export function scopeToCompany(ctx: AuthContext): { companyId?: bigint } {
  if (ctx.role === 'vendor_admin') {
    return ctx.viewAsCompanyId ? { companyId: ctx.viewAsCompanyId } : {};
  }
  if (ctx.companyId == null) throw ApiError.forbidden('User is not in a company');
  return { companyId: ctx.companyId };
}
