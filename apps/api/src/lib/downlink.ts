import { Redis } from 'ioredis';
import { Lora } from '@abd/proto';
import { loadConfig } from '../config.js';

let pub: InstanceType<typeof Redis> | undefined;
function getPublisher(): InstanceType<typeof Redis> {
  if (!pub) pub = new Redis(loadConfig().REDIS_URL);
  return pub;
}

const CHAN_DOWNLINK = 'abd:downlink';

export interface DownlinkMessage {
  gatewayId: string;
  frameHex: string;
}

/**
 * Publish a LoRa downlink frame so the gw-server (which holds the live TCP
 * connection to the gateway) can forward it. We don't know which gw-server
 * process owns the gateway; pubsub fan-out + each process filtering is fine
 * for the initial scale.
 */
export async function publishLoraCommand(args: {
  gatewayId: bigint;
  loraAddr: number;
  loraChannel: number;
  mac: Buffer;
  command: Lora.LoraLockCommand;
}): Promise<void> {
  const frame = Lora.encodeDownlink({
    addr: args.loraAddr,
    channel: args.loraChannel,
    mac: args.mac,
    command: args.command,
  });
  const msg: DownlinkMessage = {
    gatewayId: args.gatewayId.toString(),
    frameHex: frame.toString('hex'),
  };
  await getPublisher().publish(CHAN_DOWNLINK, JSON.stringify(msg));
}
