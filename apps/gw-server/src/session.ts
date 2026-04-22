import { Socket } from 'node:net';
import { Gateway } from '@abd/proto';
import type { Logger } from 'pino';

/**
 * Per-connection state kept in-memory on the gw-server process.
 * A Redis key `gw:session:{gwId}` holds the minimal routing info so other
 * processes (api, worker) can learn which gateway is online and push commands.
 */
export class GatewaySession {
  readonly parser = new Gateway.FrameParser();
  readonly connectedAt = Date.now();
  lastActivityAt = Date.now();

  gatewayId?: bigint;
  gwId?: string;
  registered = false;
  registerTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;

  constructor(
    readonly socket: Socket,
    readonly remoteAddress: string,
    readonly log: Logger,
  ) {}

  touch() {
    this.lastActivityAt = Date.now();
  }

  send(buf: Buffer) {
    if (this.socket.writable) this.socket.write(buf);
  }

  close(reason: string) {
    this.log.info({ reason }, 'closing gateway session');
    if (this.registerTimer) clearTimeout(this.registerTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket.destroy();
  }
}
