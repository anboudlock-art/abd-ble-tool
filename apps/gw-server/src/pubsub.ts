import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { Gateway } from '@abd/proto';
import type { Logger } from 'pino';

type RedisClient = InstanceType<typeof Redis>;

let pub: RedisClient | undefined;
let sub: RedisClient | undefined;

export function getPublisher(): RedisClient {
  if (!pub) pub = new Redis(loadConfig().REDIS_URL);
  return pub;
}

export function getSubscriber(): RedisClient {
  if (!sub) sub = new Redis(loadConfig().REDIS_URL);
  return sub;
}

export const CHAN_LOCK_EVENT = 'abd:lock-event';
export const CHAN_DOWNLINK = 'abd:downlink';

export interface LockEventMessage {
  eventId: string;
  deviceId: string;
}

export interface DownlinkMessage {
  gatewayId: string;
  frameHex: string; // LoRa 10-byte downlink frame, hex encoded
}

export async function publishLockEvent(msg: LockEventMessage): Promise<void> {
  await getPublisher().publish(CHAN_LOCK_EVENT, JSON.stringify(msg));
}

/**
 * Subscribe to downlink channel and forward matching frames to the given
 * gateway sender when that gateway is connected to THIS process.
 */
export function subscribeDownlinks(
  log: Logger,
  isOwnedGw: (gatewayId: string) => boolean,
  sender: (gatewayId: string, frame: Buffer) => void,
): void {
  const subscriber = getSubscriber();
  subscriber.subscribe(CHAN_DOWNLINK).catch((err) => log.error({ err }, 'subscribe failed'));
  subscriber.on('message', (channel, raw) => {
    if (channel !== CHAN_DOWNLINK) return;
    let msg: DownlinkMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isOwnedGw(msg.gatewayId)) return;
    const lora = Buffer.from(msg.frameHex, 'hex');
    const frame = Gateway.encodeLoraDownlink(lora);
    sender(msg.gatewayId, frame);
  });
}
