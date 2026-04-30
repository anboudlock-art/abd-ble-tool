import { prisma } from './index.js';

export type NotifyKind =
  | 'alarm'
  | 'ship'
  | 'deliver'
  | 'assign'
  | 'remote_command'
  | 'system';

export interface NotifyArgs {
  /** If `userId` is set, send to that single user. */
  userId?: bigint;
  /** If `companyId` is set, fan out to all active users of that company.
   *  `null` means fan out to vendor admins. */
  companyId?: bigint | null;
  kind: NotifyKind;
  title: string;
  body: string;
  link?: string;
  payload?: object;
}

/**
 * Insert one or more notification rows. Failures are swallowed —
 * a notification miss must never break the request that triggered it.
 */
export async function notify(args: NotifyArgs): Promise<void> {
  try {
    if (args.userId) {
      await prisma.notification.create({
        data: {
          userId: args.userId,
          companyId: args.companyId ?? null,
          kind: args.kind,
          title: args.title,
          body: args.body,
          link: args.link,
          payload: (args.payload as never) ?? undefined,
        },
      });
      return;
    }

    if (args.companyId !== undefined) {
      const recipients = await prisma.user.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          ...(args.companyId !== null
            ? { companyId: args.companyId }
            : { role: 'vendor_admin' }),
        },
        select: { id: true },
      });
      if (recipients.length === 0) return;
      await prisma.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          companyId: args.companyId ?? null,
          kind: args.kind,
          title: args.title,
          body: args.body,
          link: args.link,
          payload: (args.payload as never) ?? undefined,
        })),
      });
    }
  } catch (err) {
    // best-effort
    // eslint-disable-next-line no-console
    console.error('[notify] failed:', (err as Error).message);
  }
}
