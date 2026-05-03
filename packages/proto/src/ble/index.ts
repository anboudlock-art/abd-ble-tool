/**
 * BLE lock protocol (mirrors BleLockSdk.kt + 蓝牙锁APP通信协议).
 *
 * Versions:
 *   v1.3 — original 7 commands (SET_TIME / AUTH / OPEN/CLOSE / STATUS / SLEEP)
 *   v1.4 — adds 0x60 GET_IMEI to support v2.6 §1.2 自动注册 (扫QR + BLE 采
 *          MAC + IMEI + 固件) for 4G locks. See docs/ble-protocol-v1.4.md
 *          for the spec we sent the lock manufacturer.
 *
 *   Request  : 0x55 <cmdId> <cmd> <...params> <checksum>
 *   Response : 0xAA <cmdId> <cmd> <...resp>  <checksum>
 *
 *   Each 16-byte AES block is packed as:
 *     [0xFB][len][payload...][0xFC×pad...]
 *
 *   key1 = MAC(6B) || 0x11,0x22,...,0xAA
 *   key2 = key1 with last 6B replaced by [year,month,day,hour,minute,second]
 *
 * We expose pure functions here; no BLE transport concerns live in this file.
 */

import { createCipheriv, createDecipheriv } from 'node:crypto';

export const REQ_HEAD = 0x55;
export const RESP_HEAD = 0xaa;
export const CIPHER_HEAD = 0xfb;
export const CIPHER_FILL = 0xfc;

export enum BleCmd {
  SET_TIME = 0x10,
  AUTH_PASSWD = 0x20,
  SET_AUTH_PASSWD = 0x21,
  OPEN_LOCK = 0x30,
  CLOSE_LOCK = 0x31,
  GET_STATUS = 0x40,
  FORCE_SLEEP = 0x50,
  /** v1.4: ask a 4G lock to read its 4G modem IMEI and respond with the
   *  15-digit value packed BCD into 8 bytes. See parseImeiResponse. */
  GET_IMEI = 0x60,
}

export const SERVICE_UUID = '6E40000A-B5A3-F393-E0A9-E50E24DCCA9E';
export const NOTIFY_UUID = '6E40000B-B5A3-F393-E0A9-E50E24DCCA9E';
export const WRITE_UUID = '6E40000C-B5A3-F393-E0A9-E50E24DCCA9E';

export function deriveKey1(mac: Buffer): Buffer {
  if (mac.length !== 6) throw new Error('MAC must be 6 bytes');
  const key = Buffer.alloc(16);
  mac.copy(key, 0);
  for (let i = 0; i < 10; i++) {
    key[6 + i] = 0x11 * (i + 1);
  }
  return key;
}

export function deriveKey2(key1: Buffer, t: Date): Buffer {
  const key2 = Buffer.from(key1);
  key2[10] = t.getFullYear() - 2000;
  key2[11] = t.getMonth() + 1;
  key2[12] = t.getDate();
  key2[13] = t.getHours();
  key2[14] = t.getMinutes();
  key2[15] = t.getSeconds();
  return key2;
}

export function checksum(buf: Buffer, start: number, len: number): number {
  let sum = 0;
  for (let i = start; i < start + len; i++) sum = (sum + buf[i]!) & 0xff;
  return sum & 0xff;
}

/** Pack a raw (≤14B) frame into a 16-byte AES block. */
export function pack16(rawFrame: Buffer): Buffer {
  if (rawFrame.length > 14) throw new Error('raw frame > 14 bytes');
  const block = Buffer.alloc(16, CIPHER_FILL);
  block[0] = CIPHER_HEAD;
  block[1] = rawFrame.length;
  rawFrame.copy(block, 2);
  return block;
}

/** Extract the raw frame from a 16-byte AES block. */
export function unpack16(block: Buffer): Buffer {
  if (block.length !== 16) throw new Error('block must be 16 bytes');
  if (block[0] !== CIPHER_HEAD) throw new Error(`bad cipher head 0x${block[0]!.toString(16)}`);
  const len = block[1]!;
  if (len <= 0 || len > 14) throw new Error(`bad length ${len}`);
  return Buffer.from(block.subarray(2, 2 + len));
}

export function aesEncrypt(key: Buffer, block: Buffer): Buffer {
  if (key.length !== 16 || block.length !== 16) throw new Error('AES requires 16B key & block');
  const cipher = createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

export function aesDecrypt(key: Buffer, block: Buffer): Buffer {
  if (key.length !== 16 || block.length !== 16) throw new Error('AES requires 16B key & block');
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(block), decipher.final()]);
}

/** End-to-end encode: raw command bytes → encrypted 16-byte BLE write value. */
export function encryptRequest(key: Buffer, rawFrame: Buffer): Buffer {
  return aesEncrypt(key, pack16(rawFrame));
}

/** End-to-end decode: encrypted 16-byte BLE notify → raw response bytes. */
export function decryptResponse(key: Buffer, encrypted: Buffer): Buffer {
  return unpack16(aesDecrypt(key, encrypted));
}

// ---------- Command builders ----------

let _cmdIdCounter = 0x01;
function nextCmdId(): number {
  _cmdIdCounter = (_cmdIdCounter + 1) & 0xff;
  return _cmdIdCounter || 1;
}

function buildFrame(cmd: BleCmd, params: Buffer, cmdId = nextCmdId()): Buffer {
  const raw = Buffer.alloc(3 + params.length + 1);
  raw[0] = REQ_HEAD;
  raw[1] = cmdId;
  raw[2] = cmd;
  params.copy(raw, 3);
  raw[raw.length - 1] = checksum(raw, 1, raw.length - 2);
  return raw;
}

export function buildSetTime(t: Date, cmdId?: number): Buffer {
  const p = Buffer.from([
    t.getFullYear() - 2000,
    t.getMonth() + 1,
    t.getDate(),
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
  ]);
  return buildFrame(BleCmd.SET_TIME, p, cmdId);
}

export function buildAuthPasswd(passwd: number, cmdId?: number): Buffer {
  if (passwd < 0 || passwd > 999_999) throw new Error('passwd must be 0-999999');
  return buildFrame(BleCmd.AUTH_PASSWD, digits6(passwd), cmdId);
}

export function buildSetAuthPasswd(passwd: number, cmdId?: number): Buffer {
  if (passwd < 0 || passwd > 999_999) throw new Error('passwd must be 0-999999');
  return buildFrame(BleCmd.SET_AUTH_PASSWD, digits6(passwd), cmdId);
}

export function buildOpenLock(sleepMode: 0x01 | 0x02 = 0x01, cmdId?: number): Buffer {
  return buildFrame(BleCmd.OPEN_LOCK, Buffer.from([sleepMode]), cmdId);
}

export function buildCloseLock(sleepMode: 0x01 | 0x02 = 0x01, cmdId?: number): Buffer {
  return buildFrame(BleCmd.CLOSE_LOCK, Buffer.from([sleepMode]), cmdId);
}

export function buildGetStatus(sleepMode: 0x01 | 0x02 = 0x01, cmdId?: number): Buffer {
  return buildFrame(BleCmd.GET_STATUS, Buffer.from([sleepMode]), cmdId);
}

/** v1.4: ask the lock to report its 4G modem IMEI. Same shape as
 *  buildGetStatus — the only difference is the cmd byte. The lock is
 *  expected to respond with parseImeiResponse-compatible payload. */
export function buildGetImei(sleepMode: 0x01 | 0x02 = 0x01, cmdId?: number): Buffer {
  return buildFrame(BleCmd.GET_IMEI, Buffer.from([sleepMode]), cmdId);
}

/**
 * v1.4: parse the 15-digit IMEI out of a GET_IMEI response.
 *
 * The lock packs the 15 ASCII digits into 8 BCD bytes (each byte holds
 * two decimal digits, high nibble first). The 16th nibble (low nibble
 * of the last byte) is the padding sentinel 0xF.
 *
 *   "861234567890123" → 0x86 0x12 0x34 0x56 0x78 0x90 0x12 0x3F
 *
 * Why BCD: the AES block has 14 bytes for the raw frame, and an ASCII
 * encoding (1+1+1+15+1 = 19 bytes) won't fit. BCD lands at 1+1+1+8+1 = 12.
 *
 * Returns null when the payload doesn't look like a well-formed BCD IMEI.
 */
export function parseImeiResponse(payload: Buffer): string | null {
  if (payload.length !== 8) return null;
  const digits: string[] = [];
  for (const b of payload) {
    const hi = b >> 4;
    const lo = b & 0x0f;
    for (const n of [hi, lo]) {
      if (n === 0x0f) continue; // padding sentinel — must be the last nibble
      if (n > 9) return null;
      digits.push(String(n));
    }
  }
  // IMEI is exactly 15 digits.
  if (digits.length !== 15) return null;
  return digits.join('');
}

/**
 * v1.4 helper inverse — encode a 15-digit IMEI string into the 8-byte
 * BCD form the lock would respond with. Useful for tests + for the
 * APP-side mock harness. Throws if the IMEI isn't 15 ASCII digits.
 */
export function encodeImeiBcd(imei: string): Buffer {
  if (!/^\d{15}$/.test(imei)) throw new Error('IMEI must be 15 ASCII digits');
  const out = Buffer.alloc(8);
  for (let i = 0; i < 7; i++) {
    const hi = imei.charCodeAt(2 * i) - 0x30;
    const lo = imei.charCodeAt(2 * i + 1) - 0x30;
    out[i] = (hi << 4) | lo;
  }
  // last byte: 1 digit + 0xF pad
  const lastHi = imei.charCodeAt(14) - 0x30;
  out[7] = (lastHi << 4) | 0x0f;
  return out;
}

function digits6(passwd: number): Buffer {
  const out = Buffer.alloc(6);
  out[0] = Math.floor(passwd / 100_000) % 10;
  out[1] = Math.floor(passwd / 10_000) % 10;
  out[2] = Math.floor(passwd / 1_000) % 10;
  out[3] = Math.floor(passwd / 100) % 10;
  out[4] = Math.floor(passwd / 10) % 10;
  out[5] = passwd % 10;
  return out;
}

// ---------- Response parsing ----------

export interface BleResponse {
  cmdId: number;
  cmd: BleCmd;
  payload: Buffer;
}

export function parseResponse(raw: Buffer): BleResponse {
  if (raw.length < 4) throw new Error('response too short');
  if (raw[0] !== RESP_HEAD) throw new Error(`bad response head 0x${raw[0]!.toString(16)}`);
  const computed = checksum(raw, 1, raw.length - 2);
  if (computed !== raw[raw.length - 1]) throw new Error('bad checksum');
  return {
    cmdId: raw[1]!,
    cmd: raw[2] as BleCmd,
    payload: Buffer.from(raw.subarray(3, raw.length - 1)),
  };
}
