/**
 * LoRa frames for 锁↔网关 (see docs/LORA_BLE_Lock_Integration_Guide.md).
 *
 * Uplink (锁→网关), 11 bytes:
 *   [addrH][addrL][channel][MAC×6][status][battery]
 *
 * Downlink (网关→锁), 10 bytes:
 *   [addrH][addrL][channel][MAC×6][command]
 */

export enum LoraLockStatus {
  OPENED = 0x01,
  CLOSED = 0x10,
  TAMPERED = 0x11,
}

export enum LoraLockCommand {
  UNLOCK = 0x01,
  LOCK = 0x10,
}

export interface LoraUplink {
  /** E220 address (0..65535), big-endian */
  addr: number;
  channel: number;
  /** 6-byte MAC */
  mac: Buffer;
  status: LoraLockStatus;
  /** 0..100 */
  battery: number;
}

export interface LoraDownlink {
  addr: number;
  channel: number;
  mac: Buffer;
  command: LoraLockCommand;
}

export const LORA_UPLINK_LEN = 11;
export const LORA_DOWNLINK_LEN = 10;

export function parseUplink(buf: Buffer): LoraUplink {
  if (buf.length !== LORA_UPLINK_LEN) {
    throw new Error(`LoRa uplink must be ${LORA_UPLINK_LEN} bytes, got ${buf.length}`);
  }
  const addr = buf.readUInt16BE(0);
  const channel = buf.readUInt8(2);
  const mac = buf.subarray(3, 9);
  const status = buf.readUInt8(9) as LoraLockStatus;
  const battery = buf.readUInt8(10);
  return { addr, channel, mac: Buffer.from(mac), status, battery };
}

export function encodeDownlink(d: LoraDownlink): Buffer {
  if (d.mac.length !== 6) {
    throw new Error(`MAC must be 6 bytes, got ${d.mac.length}`);
  }
  const buf = Buffer.alloc(LORA_DOWNLINK_LEN);
  buf.writeUInt16BE(d.addr, 0);
  buf.writeUInt8(d.channel, 2);
  d.mac.copy(buf, 3);
  buf.writeUInt8(d.command, 9);
  return buf;
}

export function macToString(mac: Buffer): string {
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

export function parseMac(s: string): Buffer {
  const hex = s.replace(/[:-]/g, '');
  if (!/^[0-9A-Fa-f]{12}$/.test(hex)) {
    throw new Error(`Invalid MAC: ${s}`);
  }
  return Buffer.from(hex, 'hex');
}
