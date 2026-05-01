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
  UpdateUserSchema,
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

  /** List members of a team. Used by AssignDialog to populate the user picker. */
  typed.get(
    '/teams/:id/members',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const teamId = BigInt(req.params.id);
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw ApiError.notFound('Team not found');
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== team.companyId) throw ApiError.forbidden();

      const memberships = await prisma.userMembership.findMany({
        where: { teamId, user: { deletedAt: null } },
        include: { user: { select: { id: true, name: true, phone: true, role: true } } },
        orderBy: { joinedAt: 'asc' },
      });
      return {
        items: memberships.map((m) => ({
          userId: m.user.id.toString(),
          name: m.user.name,
          phone: m.user.phone,
          role: m.user.role,
          roleInTeam: m.roleInTeam,
          joinedAt: m.joinedAt.toISOString(),
        })),
      };
    },
  );

  /** Remove a user from a team. */
  typed.delete(
    '/teams/:teamId/members/:userId',
    {
      onRequest: [
        app.authenticate,
        requireRole('vendor_admin', 'company_admin', 'dept_admin', 'team_leader'),
      ],
      schema: {
        params: z.object({
          teamId: z.coerce.number().int().positive(),
          userId: z.coerce.number().int().positive(),
        }),
      },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const teamId = BigInt(req.params.teamId);
      const userId = BigInt(req.params.userId);

      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw ApiError.notFound('Team not found');
      const scope = scopeToCompany(ctx);
      if (scope.companyId && scope.companyId !== team.companyId) throw ApiError.forbidden();

      const member = await prisma.userMembership.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });
      if (!member) throw ApiError.notFound('Membership not found');

      // If the user has any open user-scoped device assignments through this
      // team, downgrade them to team-scoped so the device stays reachable
      // by the rest of the team rather than going dark.
      await prisma.$transaction(async (tx) => {
        await tx.deviceAssignment.updateMany({
          where: { teamId, userId, revokedAt: null },
          data: { scope: 'team', userId: null },
        });
        await tx.userMembership.delete({
          where: { userId_teamId: { userId, teamId } },
        });
      });
      reply.code(204);
    },
  );

  /** Devices that are currently authorised to a given user (scope=user). */
  typed.get(
    '/users/:id/devices',
    {
      onRequest: [app.authenticate],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) throw ApiError.notFound();

      // Members can read their own list; managers can read others within scope.
      if (ctx.userId !== target.id) {
        if (
          ctx.role !== 'vendor_admin' &&
          ctx.role !== 'company_admin' &&
          ctx.role !== 'dept_admin' &&
          ctx.role !== 'team_leader'
        ) {
          throw ApiError.forbidden();
        }
        const scope = scopeToCompany(ctx);
        if (scope.companyId && target.companyId !== scope.companyId) {
          throw ApiError.forbidden();
        }
      }

      const assignments = await prisma.deviceAssignment.findMany({
        where: { userId: id, revokedAt: null, scope: 'user' },
        orderBy: { id: 'desc' },
        include: {
          device: {
            select: {
              id: true,
              lockId: true,
              bleMac: true,
              status: true,
              lastState: true,
              lastBattery: true,
              lastSeenAt: true,
              doorLabel: true,
            },
          },
          team: { select: { id: true, name: true } },
        },
      });
      return {
        items: assignments.map((a) => ({
          assignmentId: a.id.toString(),
          deviceId: a.device.id.toString(),
          lockId: a.device.lockId,
          bleMac: a.device.bleMac,
          status: a.device.status,
          lastState: a.device.lastState,
          lastBattery: a.device.lastBattery,
          lastSeenAt: a.device.lastSeenAt?.toISOString() ?? null,
          doorLabel: a.device.doorLabel,
          teamId: a.team?.id.toString() ?? null,
          teamName: a.team?.name ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  );

  /** Edit basic user attributes. Phone/role/companyId immutable here. */
  typed.put(
    '/users/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: UpdateUserSchema,
      },
    },
    async (req) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) throw ApiError.notFound();

      if (ctx.role === 'company_admin') {
        if (target.role === 'vendor_admin') throw ApiError.forbidden();
        if (target.companyId !== ctx.companyId) throw ApiError.forbidden();
      }

      const updated = await prisma.user.update({
        where: { id },
        data: req.body as never,
      });
      return {
        id: updated.id.toString(),
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
        employeeNo: updated.employeeNo,
        status: updated.status,
        role: updated.role,
      };
    },
  );

  typed.delete(
    '/users/:id',
    {
      onRequest: [app.authenticate, requireRole('vendor_admin', 'company_admin')],
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      const ctx = getAuthContext(req);
      const id = BigInt(req.params.id);
      if (id === ctx.userId) throw ApiError.conflict('Cannot delete self');

      const target = await prisma.user.findUnique({ where: { id } });
      if (!target || target.deletedAt) throw ApiError.notFound();

      if (ctx.role === 'company_admin') {
        if (target.role === 'vendor_admin') throw ApiError.forbidden();
        if (target.companyId !== ctx.companyId) throw ApiError.forbidden();
      }

      await prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'locked' },
      });
      reply.code(204);
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
