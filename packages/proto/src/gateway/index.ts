/**
 * Gateway ↔ platform TCP protocol.
 * See docs/gateway-protocol.md v0.1.
 *
 *  +------+------+------+------+---------------------+
 *  | 0xAB | 0xCD | TYPE | LEN  |   PAYLOAD (LEN B)   |
 *  +------+------+------+------+---------------------+
 */

export const MAGIC_0 = 0xab;
export const MAGIC_1 = 0xcd;
export const HEADER_LEN = 4;
export const MAX_PAYLOAD_LEN = 255;

export enum FrameType {
  REGISTER = 0x01,
  REGISTER_ACK = 0x02,
  HEARTBEAT = 0x10,
  HEARTBEAT_ACK = 0x11,
  LORA_UPLINK = 0x20,
  LORA_DOWNLINK = 0x21,
  GW_CONFIG_GET = 0x30,
  GW_CONFIG_SET = 0x31,
  ERROR = 0xfe,
}

export enum RegisterAckCode {
  OK = 0x00,
  UNKNOWN_GW_ID = 0x01,
  BAD_TOKEN = 0x02,
  DISABLED = 0x03,
}

export enum ErrorCode {
  BAD_MAGIC = 0x01,
  BAD_TYPE = 0x02,
  BAD_LEN = 0x03,
  BAD_CHECKSUM = 0x04,
  NOT_REGISTERED = 0x05,
}

export interface Frame {
  type: FrameType;
  payload: Buffer;
}

export interface RegisterPayload {
  /** 8 ASCII bytes, left-padded with '0' */
  gwId: string;
  /** Unix timestamp, may be 0 */
  timestamp: number;
  /** 12 ASCII bytes */
  token: string;
}

export function encodeFrame(type: FrameType, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length > MAX_PAYLOAD_LEN) {
    throw new Error(`Payload too long: ${payload.length} > ${MAX_PAYLOAD_LEN}`);
  }
  const buf = Buffer.alloc(HEADER_LEN + payload.length);
  buf[0] = MAGIC_0;
  buf[1] = MAGIC_1;
  buf[2] = type;
  buf[3] = payload.length;
  payload.copy(buf, HEADER_LEN);
  return buf;
}

export function encodeRegisterAck(code: RegisterAckCode): Buffer {
  return encodeFrame(FrameType.REGISTER_ACK, Buffer.from([code]));
}

export function encodeHeartbeatAck(): Buffer {
  return encodeFrame(FrameType.HEARTBEAT_ACK);
}

export function encodeError(code: ErrorCode): Buffer {
  return encodeFrame(FrameType.ERROR, Buffer.from([code, 0x00]));
}

export function encodeLoraDownlink(loraBytes: Buffer): Buffer {
  return encodeFrame(FrameType.LORA_DOWNLINK, loraBytes);
}

export function parseRegisterPayload(payload: Buffer): RegisterPayload {
  if (payload.length !== 24) {
    throw new Error(`REGISTER payload must be 24 bytes, got ${payload.length}`);
  }
  const gwId = payload.subarray(0, 8).toString('ascii').trim();
  const timestamp = payload.readUInt32BE(8);
  const token = payload.subarray(12, 24).toString('ascii').trim();
  return { gwId, timestamp, token };
}

export function encodeRegisterPayload(p: RegisterPayload): Buffer {
  const buf = Buffer.alloc(24);
  buf.write(p.gwId.padStart(8, '0').slice(0, 8), 0, 8, 'ascii');
  buf.writeUInt32BE(p.timestamp >>> 0, 8);
  buf.write(p.token.padEnd(12, ' ').slice(0, 12), 12, 12, 'ascii');
  return buf;
}

/**
 * Streaming frame parser. TCP gives us a byte stream; this class buffers and
 * emits complete frames whenever the buffer holds at least one.
 */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const frames: Frame[] = [];

    while (this.buf.length >= HEADER_LEN) {
      const idx = this.findMagic();
      if (idx < 0) {
        this.buf = Buffer.alloc(0);
        break;
      }
      if (idx > 0) {
        this.buf = this.buf.subarray(idx);
      }
      if (this.buf.length < HEADER_LEN) break;

      const type = this.buf[2] as FrameType;
      const len = this.buf[3]!;
      const total = HEADER_LEN + len;
      if (this.buf.length < total) break;

      const payload = Buffer.from(this.buf.subarray(HEADER_LEN, total));
      frames.push({ type, payload });
      this.buf = this.buf.subarray(total);
    }

    return frames;
  }

  private findMagic(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === MAGIC_0 && this.buf[i + 1] === MAGIC_1) return i;
    }
    return -1;
  }

  get bufferedBytes(): number {
    return this.buf.length;
  }
}
