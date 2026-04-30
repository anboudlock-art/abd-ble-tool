import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@abd/db';
import {
  AddTeamMemberSchema,
  ApiError,
  CreateUserSchema,
  PaginationSchema,
} from '@abd/shared';
import { getAuthContext, requireRole, scopeToCompany } from '../lib/auth.js';

export default async function userRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/users',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin', 'dept_admin')],
      schema: {
        querystring: PaginationSchema.extend({
          companyId: z.coerce.number().int().positive().optional(),
        }),
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const { page, pageSize, companyId } = req.query;
      const scope = scopeToCompany(ctx);

      const where = scope.companyId
        ? { companyId: scope.companyId, deletedAt: null }
        : companyId
          ? { companyId: BigInt(companyId), deletedAt: null }
          : { deletedAt: null };

      const [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { company: true, memberships: { include: { team: true } } },
        }),
        prisma.user.count({ where }),
      ]);

      return {
        items: items.map((u) => ({
          id: u.id.toString(),
          name: u.name,
          phone: u.phone,
          email: u.email,
          employeeNo: u.employeeNo,
          role: u.role,
          status: u.status,
          companyId: u.companyId?.toString() ?? null,
          companyName: u.company?.name ?? null,
          teams: u.memberships.map((m) => ({
            id: m.teamId.toString(),
            name: m.team.name,
            roleInTeam: m.roleInTeam,
          })),
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    },
  );

  typed.post(
    '/users',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { body: CreateUserSchema },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const {
        companyId,
        phone,
        name,
        employeeNo,
        email,
        role,
        initialPassword,
        teamId,
      } = req.body;

      // company_admin can only create users in their own company, never vendor_admin
      if (ctx.role === 'company_admin') {
        if (role === 'vendor_admin') throw ApiError.forbidden('Cannot create vendor admin');
        if (companyId && BigInt(companyId) !== ctx.companyId) throw ApiError.forbidden();
      }

      const targetCompanyId =
        ctx.role === 'company_admin' ? ctx.companyId : companyId ? BigInt(companyId) : null;

      // vendor_admin role must NOT be tied to a company (they belong to the platform)
      if (role === 'vendor_admin' && targetCompanyId) {
        throw ApiError.conflict('vendor_admin cannot be tied to a company');
      }
      if (role !== 'vendor_admin' && !targetCompanyId) {
        throw ApiError.conflict('Non-vendor users must belong to a company');
      }

      const dup = await prisma.user.findUnique({ where: { phone } });
      if (dup) throw ApiError.conflict(`Phone ${phone} already registered`);

      let teamCompanyId: bigint | null = null;
      if (teamId) {
        const team = await prisma.team.findUnique({ where: { id: BigInt(teamId) } });
        if (!team) throw ApiError.notFound('Team not found');
        teamCompanyId = team.companyId;
        if (targetCompanyId && team.companyId !== targetCompanyId) {
          throw ApiError.conflict('Team belongs to a different company');
        }
      }

      // Always assign a password — admin-supplied or auto-generated.
      // Force change on first login either way, so the temporary value
      // is one-shot and never persists as the user's real credential.
      const plaintextPassword =
        initialPassword?.trim() || generateTempPassword();
      const passwordHash = await bcrypt.hash(plaintextPassword, 12);

      const user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            companyId: targetCompanyId,
            phone,
            name,
            employeeNo,
            email,
            role,
            passwordHash,
            status: 'active',
            mustChangePassword: true,
          },
        });
        if (teamId) {
          await tx.userMembership.create({
            data: {
              userId: u.id,
              teamId: BigInt(teamId),
              roleInTeam: role === 'team_leader' ? 'leader' : 'member',
            },
          });
        }
        return u;
      });
      void teamCompanyId;

      reply.code(201);
      return {
        id: user.id.toString(),
        name: user.name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        // Plaintext shown ONCE — admin shares it with the user out-of-band.
        // First login forces a password change, so this temp value is
        // burned after one use.
        initialPassword: plaintextPassword,
      };
    },
  );

  /**
   * Admin resets another user's password. Generates a fresh temp
   * password, requires the target to change it on next login.
   */
  typed.post(
    '/users/:id/reset-password',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const target = await prisma.user.findUnique({
        where: { id: BigInt(req.params.id) },
      });
      if (!target) throw ApiError.notFound();
      if (ctx.role === 'company_admin') {
        if (target.role === 'vendor_admin') throw ApiError.forbidden();
        if (target.companyId !== ctx.companyId) throw ApiError.forbidden();
      }

      const plaintext = generateTempPassword();
      await prisma.user.update({
        where: { id: target.id },
        data: {
          passwordHash: await bcrypt.hash(plaintext, 12),
          mustChangePassword: true,
          status: 'active',
        },
      });
      return { id: target.id.toString(), tempPassword: plaintext };
    },
  );

  typed.post(
    '/teams/:id/members',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin', 'dept_admin', 'team_leader')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: AddTeamMemberSchema,
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const teamId = BigInt(req.params.id);
      const { userId, roleInTeam } = req.body;

      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw ApiError.notFound('Team not found');
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== team.companyId) throw ApiError.forbidden();

      const user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
      if (!user) throw ApiError.notFound('User not found');
      if (user.companyId !== team.companyId) {
        throw ApiError.conflict('User belongs to a different company');
      }

      const dup = await prisma.userMembership.findUnique({
        where: { userId_teamId: { userId: BigInt(userId), teamId } },
      });
      if (dup) throw ApiError.conflict('User already in team');

      await prisma.userMembership.create({
        data: { userId: BigInt(userId), teamId, roleInTeam },
      });
      reply.code(201);
      return { teamId: teamId.toString(), userId: userId.toString() };
    },
  );
}

/**
 * Random 10-character temp password: 4 digits + 4 letters + 2 special.
 * Easy to read aloud, hard to brute-force.
 */
function generateTempPassword(): string {
  const digits = '0123456789';
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'; // no I/l/O/0
  const symbols = '!@#$';
  const pick = (alphabet: string, n: number) =>
    Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');
  const raw = pick(digits, 4) + pick(letters, 4) + pick(symbols, 2);
  return raw.split('').sort(() => randomInt(2) - 0.5).join('');
}
