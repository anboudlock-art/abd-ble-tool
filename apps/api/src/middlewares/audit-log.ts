import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@abd/db';

/**
 * Records a row in `audit_log` for every successful mutation made through
 * the JWT-authenticated /api/v1 surface. Body redaction strips obvious
 * password / token / secret fields so the diff column is safe to keep.
 *
 * Skipped:
 *   - GET / HEAD / OPTIONS
 *   - 4xx and 5xx responses (we only audit committed work)
 *   - login & set-password (would dox passwords on every attempt)
 *   - Healthchecks
 *   - The audit log itself reading endpoints (none yet)
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'initialpassword',
  'temppassword',
  'setuptoken',
  'token',
  'secret',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'appsecret',
  'webhooksecret',
  'authorization',
]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

const SKIP_URLS = [
  '/api/v1/auth/login',
  '/api/v1/auth/set-password',
  '/api/v1/auth/change-password',
  '/healthz',
  '/readyz',
];

/**
 * Best-effort `actor / target` derivation from the URL.
 *   /api/v1/devices/123      -> { type: 'device', id: 123 }
 *   /api/v1/users/45/reset-password -> { type: 'user', id: 45 }
 * Falls back to last numeric segment.
 */
function inferTarget(url: string): { type: string | null; id: bigint | null } {
  const path = url.split('?')[0]!;
  const parts = path.split('/').filter(Boolean);
  // /api/v1/<resource>/<id>/...
  const i = parts.indexOf('v1');
  if (i < 0 || parts.length <= i + 1) return { type: null, id: null };
  const type = parts[i + 1] ?? null;
  const idStr = parts[i + 2];
  let id: bigint | null = null;
  if (idStr && /^\d+$/.test(idStr)) id = BigInt(idStr);
  return { type, id };
}

function actionFor(method: string, url: string): string {
  const path = url.split('?')[0]!;
  const parts = path.split('/').filter(Boolean);
  const i = parts.indexOf('v1');
  const resource = i >= 0 && parts[i + 1] ? parts[i + 1]! : 'unknown';
  const tail = parts.slice(i + 3).join('.');
  const verb =
    method === 'POST'
      ? tail || 'create'
      : method === 'PUT' || method === 'PATCH'
        ? 'update'
        : method === 'DELETE'
          ? 'delete'
          : method.toLowerCase();
  return `${resource}.${verb}`;
}

export default fp(async function auditPlugin(app: FastifyInstance) {
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (reply.statusCode >= 400) return;

    const url = req.url;
    if (!url.startsWith('/api/v1/')) return;
    if (SKIP_URLS.some((s) => url.startsWith(s))) return;

    // Best-effort actor extraction. JWT verify already happened earlier in
    // the request; if it didn't (e.g. unauthenticated POST that 4xx'd),
    // we'd have skipped above. So req.user should be present.
    const auth = req.user as
      | { sub?: string; role?: string; companyId?: string | null }
      | undefined;
    const actorUserId = auth?.sub ? BigInt(auth.sub) : null;
    const companyId = auth?.companyId ? BigInt(auth.companyId) : null;

    const action = actionFor(req.method, url);
    const target = inferTarget(url);

    const body = (req as FastifyRequest & { body?: unknown }).body;
    const diff = body ? (redact(body) as object) : undefined;

    try {
      await prisma.auditLog.create({
        data: {
          companyId,
          actorUserId,
          actorIp: req.ip,
          action,
          targetType: target.type,
          targetId: target.id,
          diff: diff as never,
        },
      });
    } catch (err) {
      // Audit MUST NOT fail the request. Just log.
      req.log.warn({ err }, 'audit log write failed');
    }
  });
});
