import type { Socket } from 'node:net';
import type { Logger } from 'pino';
import { LockTcp } from '@abd/proto';

/**
 * Per-connection state for a 4GBLE093 lock that connected via direct TCP.
 * Bound to a Device row after the LOGIN frame arrives.
 */
export class LockTcpSession {
  readonly parser = new LockTcp.FrameParser();
  readonly connectedAt = Date.now();
  lastActivityAt = Date.now();

  /** Lock SN parsed from the first frame; populated even before login. */
  lockSN?: number;
  /** Resolved Device.id once we look up by BLE MAC. */
  deviceId?: bigint;
  /** Resolved BLE MAC string from login payload. */
  bleMac?: string;
  /** Did we observe a LOGIN frame and bind to a Device row? */
  registered = false;
  /** ISO time of last heartbeat received. */
  lastHeartbeatAt?: Date;

  /** Monotonic counter for downlink report serials so we can correlate ACKs. */
  private nextSerial = 1;

  idleTimer?: NodeJS.Timeout;

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

  allocSerial(): number {
    const s = this.nextSerial;
    this.nextSerial = (this.nextSerial + 1) & 0xffff;
    if (this.nextSerial === 0) this.nextSerial = 1;
    return s;
  }

  close(reason: string) {
    this.log.info({ reason }, 'closing lock-tcp session');
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.socket.destroy();
  }
}
