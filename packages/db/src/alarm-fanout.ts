import { prisma } from './index.js';
import { notify, type NotifyArgs } from './notify.js';

/**
 * Decides which channels an alarm reaches based on severity:
 *
 *   info     → in-app only
 *   warning  → in-app only
 *   critical → in-app + SMS to {company,dept}_admin (or vendor_admin if
 *              the alarm is platform-scoped)
 *
 * SMS dispatch goes through Redis pub/sub on channel `abd:sms`; the
 * worker subscribes to that and queues BullMQ jobs. We don't import
 * BullMQ here so this helper stays usable from any process (gw-server,
 * api) without bundling worker deps.
 *
 * SMS template codes come from env. If unset, SMS is silently skipped.
 *   ALIYUN_SMS_TEMPLATE_CRITICAL  e.g. SMS_311210123
 */

import { Redis } from 'ioredis';

let pub: InstanceType<typeof Redis> | null = null;
function getPub(): InstanceType<typeof Redis> | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (pub) return pub;
  try {
    pub = new Redis(url, { maxRetriesPerRequest: null });
    pub.on('error', () => {
      /* swallow */
    });
    return pub;
  } catch {
    return null;
  }
}

const CHAN_SMS = 'abd:sms';

export interface AlarmFanoutArgs {
  companyId: bigint | null;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  link?: string;
  payload?: object;
}

export async function alarmFanout(args: AlarmFanoutArgs): Promise<void> {
  // Always emit the in-app notification
  const notifyArgs: NotifyArgs = {
    companyId: args.companyId,
    kind: 'alarm',
    title: args.title,
    body: args.body,
    link: args.link,
    payload: args.payload,
  };
  await notify(notifyArgs);

  if (args.severity !== 'critical') return;
  const tplCode = process.env.ALIYUN_SMS_TEMPLATE_CRITICAL;
  if (!tplCode) return;

  const recipients = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      ...(args.companyId !== null
        ? {
            companyId: args.companyId,
            role: { in: ['company_admin', 'dept_admin'] },
          }
        : { role: 'vendor_admin' }),
    },
    select: { phone: true },
  });

  const redis = getPub();
  if (!redis) return;

  for (const r of recipients) {
    if (!r.phone) continue;
    try {
      const msg = JSON.stringify({
        phone: r.phone,
        templateCode: tplCode,
        templateParam: {
          title: args.title.slice(0, 60),
          body: args.body.slice(0, 60),
        },
      });
      await redis.publish(CHAN_SMS, msg);
    } catch {
      // best-effort; never break the originating request
    }
  }
}
