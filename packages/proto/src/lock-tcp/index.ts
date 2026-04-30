/**
 * 4GBLE093 lock TCP protocol codec.
 *
 * Frame layout (network → server and server → network):
 *
 *   off  field           bytes
 *   [0]  FrameStart      1     fixed 0xFE
 *   [1]  LockSN          4     32-bit lock serial, LITTLE-endian
 *   [5]  Addr            1
 *   [6]  Sub             1
 *   [7]  SubLen          1
 *   [8]  DataLen         1     = 5 + payloadLen   (covers [Addr..CRC])
 *   [9]  Payload         N     N = DataLen - 5
 *  [9+N] CRC8            1     Dallas/Maxim, init=0, computed over
 *                              bytes [Addr..end of payload], i.e.
 *                              `DataLen - 1` bytes starting at offset 5.
 * [10+N] FrameEnd        1     fixed 0xFF
 *
 * Total frame length = DataLen + 6.
 */

export const FRAME_START = 0xfe;
export const FRAME_END = 0xff;
export const HEADER_SIZE = 9;

/**
 * Dallas/Maxim CRC8 lookup table copied byte-for-byte from the firmware
 * (`UserApp/Uart_4G.c::dscrc_table`).  Polynomial reflected = 0x8C
 * (i.e. `x^8 + x^5 + x^4 + 1` reflected, init = 0, no final XOR).
 */
const DSCRC_TABLE: readonly number[] = [
  0, 94, 188, 226, 97, 63, 221, 131, 194, 156, 126, 32, 163, 253, 31, 65, 157, 195, 33, 127, 252,
  162, 64, 30, 95, 1, 227, 189, 62, 96, 130, 220, 35, 125, 159, 193, 66, 28, 254, 160, 225, 191,
  93, 3, 128, 222, 60, 98, 190, 224, 2, 92, 223, 129, 99, 61, 124, 34, 192, 158, 29, 67, 161, 255,
  70, 24, 250, 164, 39, 121, 155, 197, 132, 218, 56, 102, 229, 187, 89, 7, 219, 133, 103, 57, 186,
  228, 6, 88, 25, 71, 165, 251, 120, 38, 196, 154, 101, 59, 217, 135, 4, 90, 184, 230, 167, 249,
  27, 69, 198, 152, 122, 36, 248, 166, 68, 26, 153, 199, 37, 123, 58, 100, 134, 216, 91, 5, 231,
  185, 140, 210, 48, 110, 237, 179, 81, 15, 78, 16, 242, 172, 47, 113, 147, 205, 17, 79, 173, 243,
  112, 46, 204, 146, 211, 141, 111, 49, 178, 236, 14, 80, 175, 241, 19, 77, 206, 144, 114, 44, 109,
  51, 209, 143, 12, 82, 176, 238, 50, 108, 142, 208, 83, 13, 239, 177, 240, 174, 76, 18, 145, 207,
  45, 115, 202, 148, 118, 40, 171, 245, 23, 73, 8, 86, 180, 234, 105, 55, 213, 139, 87, 9, 235,
  181, 54, 104, 138, 212, 149, 203, 41, 119, 244, 170, 72, 22, 233, 183, 85, 11, 136, 214, 52,
  106, 43, 117, 151, 201, 74, 20, 246, 168, 116, 42, 200, 150, 21, 75, 169, 247, 182, 232, 10, 84,
  215, 137, 107, 53,
];

export function crc8(buf: Buffer, start: number, len: number): number {
  let crc = 0;
  for (let i = 0; i < len; i++) {
    crc = DSCRC_TABLE[crc ^ buf[start + i]!]!;
  }
  return crc;
}

// ---- Sub codes ----
export const Sub = {
  LOGIN: 0x01,
  HEARTBEAT: 0x06,
  GPS: 0x0a,
  ACK: 0x16,
  EVENT: 0x2d,
} as const;

// ---- Server-issued primary command codes (Addr field) ----
export const Cmd = {
  CONFIG: 0x21, // set time, report interval, ...
  SET_IPPORT: 0x31,
  SLEEP: 0x51,
  LOCK_OP: 0x81, // unlock / query / seal
} as const;

export interface Frame {
  lockSN: number; // 32-bit unsigned, decoded from LE
  addr: number;
  sub: number;
  subLen: number;
  /** Raw payload, length = DataLen - 5. */
  payload: Buffer;
}

export class FrameError extends Error {}

/**
 * Encode a frame given its logical fields. Computes DataLen, CRC8, and
 * surrounds with 0xFE / 0xFF.
 */
export function encodeFrame(f: Frame): Buffer {
  const dataLen = 5 + f.payload.length;
  if (dataLen > 0xff) {
    throw new FrameError(`payload too long: dataLen=${dataLen}`);
  }
  const total = dataLen + 6;
  const buf = Buffer.alloc(total);

  buf[0] = FRAME_START;
  // LockSN: little-endian
  buf.writeUInt32LE(f.lockSN >>> 0, 1);
  buf[5] = f.addr;
  buf[6] = f.sub;
  buf[7] = f.subLen;
  buf[8] = dataLen;
  f.payload.copy(buf, 9);
  // CRC over [Addr..end of payload] = dataLen - 1 bytes from offset 5
  buf[9 + f.payload.length] = crc8(buf, 5, dataLen - 1);
  buf[total - 1] = FRAME_END;
  return buf;
}

/**
 * Try to parse one frame starting at offset 0 of `buf`. Returns null if
 * the buffer doesn't yet contain a complete frame, throws on a corrupt
 * frame whose start is unambiguous.
 */
export function decodeOne(buf: Buffer): { frame: Frame; consumed: number } | null {
  if (buf.length === 0) return null;
  if (buf[0] !== FRAME_START) {
    throw new FrameError('frame does not start with 0xFE');
  }
  if (buf.length < HEADER_SIZE) return null;
  const dataLen = buf[8]!;
  const total = dataLen + 6;
  if (buf.length < total) return null;
  if (buf[total - 1] !== FRAME_END) {
    throw new FrameError(`frame end marker mismatch: 0x${buf[total - 1]!.toString(16)}`);
  }
  const crcGiven = buf[9 + (dataLen - 5)]!;
  const crcCalc = crc8(buf, 5, dataLen - 1);
  if (crcGiven !== crcCalc) {
    throw new FrameError(
      `CRC mismatch: got 0x${crcGiven.toString(16)} expected 0x${crcCalc.toString(16)}`,
    );
  }
  const payload = Buffer.from(buf.subarray(9, 9 + (dataLen - 5)));
  return {
    frame: {
      lockSN: buf.readUInt32LE(1),
      addr: buf[5]!,
      sub: buf[6]!,
      subLen: buf[7]!,
      payload,
    },
    consumed: total,
  };
}

/**
 * Streaming parser. Buffers across `.push(chunk)` calls and emits whole
 * frames whenever it has them. Resyncs past garbage between 0xFEs if a
 * frame fails CRC/length validation.
 */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): { frames: Frame[]; errors: Error[] } {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const frames: Frame[] = [];
    const errors: Error[] = [];

    while (this.buf.length > 0) {
      // Resync to 0xFE
      if (this.buf[0] !== FRAME_START) {
        const i = this.buf.indexOf(FRAME_START);
        if (i < 0) {
          this.buf = Buffer.alloc(0);
          break;
        }
        this.buf = this.buf.subarray(i);
      }
      if (this.buf.length < HEADER_SIZE) break;
      const dataLen = this.buf[8]!;
      const total = dataLen + 6;
      if (this.buf.length < total) break;

      try {
        const out = decodeOne(this.buf);
        if (!out) break;
        frames.push(out.frame);
        this.buf = this.buf.subarray(out.consumed);
      } catch (err) {
        errors.push(err as Error);
        // Discard the leading 0xFE so resync moves past the bad frame.
        this.buf = this.buf.subarray(1);
      }
    }
    return { frames, errors };
  }
}

// ---- Helpers for specific payloads ----

/** Login payload offsets (extracted in handlers): MAC at [14..19], 4-byte server IP at [20..23], port at [24..25]. */
export const LOGIN_PAYLOAD = {
  GPS_SECTION: { start: 0, end: 14 },
  BLE_MAC: { start: 14, end: 20 },
  SERVER_IP: { start: 20, end: 24 },
  SERVER_PORT: { start: 24, end: 26 },
} as const;

export function macFromLoginPayload(p: Buffer): string {
  if (p.length < 20) throw new FrameError('login payload too short');
  const mac = p.subarray(14, 20);
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Unlock command builder (Addr=0x81, Sub=0x2D, FuncCode=0xA0).
 * Layout follows the firmware: business-header 0x2A 0x55 0xA0 + LockID(4 LE)
 * + password(6 ASCII) + ttl_minutes(1).
 *
 * The exact firmware-side parser also expects a few padding bytes that
 * mirror what the original platform sends; tests in our integration
 * environment will validate the exact layout. For now we mirror the doc
 * description; if firmware rejects we'll iterate.
 */
export interface UnlockCmdInput {
  lockSN: number;
  password6: string; // 6 ASCII digits
  ttlMinutes: number;
  reportSerial: number; // u16
}

export function encodeUnlock(i: UnlockCmdInput): Buffer {
  if (!/^\d{6}$/.test(i.password6)) throw new FrameError('password must be 6 digits');
  // Payload skeleton — see TCP doc §四 CMD 0x81 / 0x2D / 0xA0
  // Pad zeros up to where the doc specifies passwd at [23..28], ttl at [29].
  const payload = Buffer.alloc(32, 0);
  payload[0] = 0x2a; // business head
  payload[1] = 0x55;
  payload[2] = 0xa0; // sub-cmd
  // LockID at [3..6] little-endian
  payload.writeUInt32LE(i.lockSN >>> 0, 3);
  // Password at [23..28]
  for (let k = 0; k < 6; k++) payload[23 + k] = i.password6.charCodeAt(k);
  // TTL at [29]
  payload[29] = i.ttlMinutes & 0xff;
  // Report serial at the tail (u16 LE) — the firmware echoes this back in
  // its 0x16 ACK so we can correlate the request to the response.
  payload.writeUInt16LE(i.reportSerial & 0xffff, 30);

  return encodeFrame({
    lockSN: i.lockSN,
    addr: Cmd.LOCK_OP,
    sub: Sub.EVENT, // 0x2D
    subLen: 0x04,
    payload,
  });
}

/** Query lock status (CMD 0x81 / Sub 0x2D / func 0x12). */
export function encodeQueryStatus(lockSN: number, reportSerial: number): Buffer {
  const payload = Buffer.alloc(8, 0);
  payload[0] = 0x2a;
  payload[1] = 0x55;
  payload[2] = 0x12;
  payload.writeUInt32LE(lockSN >>> 0, 3);
  payload.writeUInt16LE(reportSerial & 0xffff, 6);
  return encodeFrame({
    lockSN,
    addr: Cmd.LOCK_OP,
    sub: Sub.EVENT,
    subLen: 0x04,
    payload,
  });
}
