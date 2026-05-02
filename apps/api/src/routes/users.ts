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

  // ----- /users/me family (APP convenience) -------------------------------

  /** Current user + role + company. Companion to /auth/me but lives under
   *  /users so the APP can keep all its calls under one prefix. */
  typed.get(
    '/users/me',
    { onRequest: [app.authenticate] },
    async (req) => {
      const ctx = getAuthContext(req);
      const u = await prisma.user.findUnique({
        where: { id: ctx.userId },
        include: {
          company: { select: { id: true, name: true, shortCode: true } },
          memberships: {
            include: {
              team: {
                select: {
                  id: true,
                  name: true,
                  department: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });
      if (!u || u.deletedAt) throw ApiError.notFound();
      return {
        id: u.id.toString(),
        name: u.name,
        phone: u.phone,
        email: u.email,
        role: u.role,
        status: u.status,
        mustChangePassword: u.mustChangePassword,
        companyId: u.companyId?.toString() ?? null,
        companyName: u.company?.name ?? null,
        companyShortCode: u.company?.shortCode ?? null,
        teams: u.memberships.map((m) => ({
          id: m.teamId.toString(),
          name: m.team.name,
          roleInTeam: m.roleInTeam,
          departmentId: m.team.department?.id.toString() ?? null,
          departmentName: m.team.department?.name ?? null,
        })),
      };
    },
  );

  /** Devices the current user can open: union of user-scoped grants and the
   *  team-scoped grants of every team they belong to. */
  typed.get(
    '/users/me/devices',
    { onRequest: [app.authenticate] },
    async (req) => {
      const ctx = getAuthContext(req);
      const memberships = await prisma.userMembership.findMany({
        where: { userId: ctx.userId },
        select: { teamId: true },
      });
      const teamIds = memberships.map((m) => m.teamId);
      const now = new Date();

      const assignments = await prisma.deviceAssignment.findMany({
        where: {
          revokedAt: null,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          ],
          OR: [
            { scope: 'user', userId: ctx.userId },
            ...(teamIds.length
              ? [{ scope: 'team' as const, teamId: { in: teamIds } }]
              : []),
          ],
        },
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
              gatewayId: true,
              gateway: { select: { online: true } },
              model: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  category: true,
                  hasBle: true,
                  has4g: true,
                  hasGps: true,
                  hasLora: true,
                  capabilitiesJson: true,
                },
              },
            },
          },
          team: { select: { id: true, name: true } },
        },
      });

      // De-dupe by deviceId; user-scoped grants win over team-scoped.
      const byDeviceId = new Map<string, (typeof assignments)[number]>();
      for (const a of assignments) {
        const k = a.device.id.toString();
        const existing = byDeviceId.get(k);
        if (!existing || (a.scope === 'user' && existing.scope !== 'user')) {
          byDeviceId.set(k, a);
        }
      }

      return {
        items: Array.from(byDeviceId.values()).map((a) => ({
          deviceId: a.device.id.toString(),
          lockId: a.device.lockId,
          bleMac: a.device.bleMac,
          status: a.device.status,
          lastState: a.device.lastState,
          lastBattery: a.device.lastBattery,
          lastSeenAt: a.device.lastSeenAt?.toISOString() ?? null,
          doorLabel: a.device.doorLabel,
          // v2.8 Ask 1+6+7: model capabilities + gateway availability so
          // the APP can pick BLE / LoRa / 4G buttons per-device.
          model: a.device.model
            ? {
                id: a.device.model.id.toString(),
                code: a.device.model.code,
                name: a.device.model.name,
                category: a.device.model.category,
                hasBle: a.device.model.hasBle,
                has4g: a.device.model.has4g,
                hasGps: a.device.model.hasGps,
                hasLora: a.device.model.hasLora,
                capabilitiesJson: a.device.model.capabilitiesJson,
              }
            : null,
          gatewayId: a.device.gatewayId?.toString() ?? null,
          gatewayOnline: a.device.gateway?.online ?? null,
          assignmentScope: a.scope,
          teamId: a.team?.id.toString() ?? null,
          teamName: a.team?.name ?? null,
          validUntil: a.validUntil?.toISOString() ?? null,
        })),
      };
    },
  );

  /** Notifications for the current user. Same shape as /notifications but
   *  scoped explicitly under /users/me to fit the v2.6 APP API plan. */
  typed.get(
    '/users/me/notifications',
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
      const where = {
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
        prisma.notification.count({ where: { userId: ctx.userId, readAt: null } }),
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

  // ------------------------------------------------------------------------

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
          // Upsert so a retried POST /users (or a stale FE retry) doesn't
          // 500 on the unique (userId, teamId) constraint.
          await tx.userMembership.upsert({
            where: {
              userId_teamId: {
                userId: u.id,
                teamId: BigInt(teamId),
              },
            },
            create: {
              userId: u.id,
              teamId: BigInt(teamId),
              roleInTeam: role === 'team_leader' ? 'leader' : 'member',
            },
            update: {},
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
