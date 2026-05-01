/**
 * Browser-side mirror of @abd/proto/ble — same wire format, but implemented on
 * Uint8Array + SubtleCrypto so it runs in the browser without polyfilling
 * Node's Buffer. Stays in lock-step with the original protocol; if something
 * here drifts from the Node codec, the device will reject the frame.
 *
 * Wire format (see BleLockSdk.kt + 蓝牙锁APP通信协议v1.3):
 *   raw frame:  0x55 <cmdId> <cmd> <params...> <checksum>
 *   16B block:  [0xFB][len][raw payload...][0xFC × pad]   (AES-128-ECB)
 *   key1 = MAC(6B) || 0x11,0x22,...,0xAA  (10 bytes of (i+1)*0x11)
 *   key2 = key1 with last 6B replaced by [year-2000, mon, day, hr, min, sec]
 */

export const REQ_HEAD = 0x55;
export const RESP_HEAD = 0xaa;
export const CIPHER_HEAD = 0xfb;
export const CIPHER_FILL = 0xfc;

export const SERVICE_UUID = '6e40000a-b5a3-f393-e0a9-e50e24dcca9e';
export const NOTIFY_UUID = '6e40000b-b5a3-f393-e0a9-e50e24dcca9e';
export const WRITE_UUID = '6e40000c-b5a3-f393-e0a9-e50e24dcca9e';

export const BleCmd = {
  SET_TIME: 0x10,
  AUTH_PASSWD: 0x20,
  SET_AUTH_PASSWD: 0x21,
  OPEN_LOCK: 0x30,
  CLOSE_LOCK: 0x31,
  GET_STATUS: 0x40,
  FORCE_SLEEP: 0x50,
} as const;
export type BleCmdValue = (typeof BleCmd)[keyof typeof BleCmd];

export function parseMac(macStr: string): Uint8Array {
  const m = macStr.trim().toUpperCase();
  if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(m)) {
    throw new Error('MAC must be aa:bb:cc:dd:ee:ff');
  }
  const out = new Uint8Array(6);
  m.split(':').forEach((b, i) => {
    out[i] = parseInt(b, 16);
  });
  return out;
}

export function macToString(mac: Uint8Array): string {
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

export function deriveKey1(mac: Uint8Array): Uint8Array {
  if (mac.length !== 6) throw new Error('MAC must be 6 bytes');
  const key = new Uint8Array(16);
  key.set(mac, 0);
  for (let i = 0; i < 10; i++) {
    key[6 + i] = 0x11 * (i + 1);
  }
  return key;
}

export function deriveKey2(key1: Uint8Array, t: Date = new Date()): Uint8Array {
  const key2 = new Uint8Array(key1);
  key2[10] = t.getFullYear() - 2000;
  key2[11] = t.getMonth() + 1;
  key2[12] = t.getDate();
  key2[13] = t.getHours();
  key2[14] = t.getMinutes();
  key2[15] = t.getSeconds();
  return key2;
}

export function checksum(buf: Uint8Array, start: number, len: number): number {
  let sum = 0;
  for (let i = start; i < start + len; i++) sum = (sum + buf[i]!) & 0xff;
  return sum & 0xff;
}

export function pack16(rawFrame: Uint8Array): Uint8Array {
  if (rawFrame.length > 14) throw new Error('raw frame > 14 bytes');
  const block = new Uint8Array(16).fill(CIPHER_FILL);
  block[0] = CIPHER_HEAD;
  block[1] = rawFrame.length;
  block.set(rawFrame, 2);
  return block;
}

export function unpack16(block: Uint8Array): Uint8Array {
  if (block.length !== 16) throw new Error('block must be 16 bytes');
  if (block[0] !== CIPHER_HEAD) throw new Error(`bad cipher head 0x${block[0]!.toString(16)}`);
  const len = block[1]!;
  if (len <= 0 || len > 14) throw new Error(`bad length ${len}`);
  return block.slice(2, 2 + len);
}

/** SubtleCrypto's BufferSource excludes SharedArrayBuffer; TS 5.6+ types
 *  Uint8Array as ArrayBufferLike-backed by default. Cast through unknown to
 *  satisfy the strict BufferSource constraint without changing semantics. */
function bufferSource(src: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  return ab;
}

/** AES-128-ECB encrypt one 16-byte block using SubtleCrypto. */
export async function aesEncrypt(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  if (key.length !== 16 || block.length !== 16) throw new Error('AES requires 16B key & block');
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bufferSource(key),
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const iv = new Uint8Array(new ArrayBuffer(16));
  // Web Crypto doesn't expose ECB directly; CBC with IV=0 on a single 16B
  // block is bit-equivalent to ECB on that block. SubtleCrypto adds an
  // implicit PKCS#7 pad block (16B); we discard it.
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: bufferSource(iv) }, cryptoKey, bufferSource(block)),
  );
  return out.slice(0, 16);
}

export async function aesDecrypt(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  if (key.length !== 16 || block.length !== 16) throw new Error('AES requires 16B key & block');
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bufferSource(key),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  // Append a synthesized "padding" cipher block so SubtleCrypto accepts the
  // input. Building one that decrypts to PKCS#7 0x10×16 requires:
  //   C_pad = AES_Encrypt(key, padBlock XOR block)
  // After CBC decrypt with IV=0 the result is plaintext || 0x10×16.
  const padBlock = new Uint8Array(16).fill(0x10);
  const padIv = new Uint8Array(new ArrayBuffer(16));
  const xored = new Uint8Array(new ArrayBuffer(16));
  for (let i = 0; i < 16; i++) xored[i] = padBlock[i]! ^ block[i]!;
  const trailer = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: bufferSource(padIv) },
      cryptoKey,
      bufferSource(xored),
    ),
  );
  const ciphertext = new Uint8Array(new ArrayBuffer(32));
  ciphertext.set(block, 0);
  ciphertext.set(trailer.slice(0, 16), 16);
  const out = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: bufferSource(padIv) },
      cryptoKey,
      bufferSource(ciphertext),
    ),
  );
  return out.slice(0, 16);
}

let _cmdIdCounter = 0x01;
function nextCmdId(): number {
  _cmdIdCounter = (_cmdIdCounter + 1) & 0xff;
  return _cmdIdCounter || 1;
}

function buildFrame(cmd: number, params: Uint8Array, cmdId = nextCmdId()): Uint8Array {
  const raw = new Uint8Array(3 + params.length + 1);
  raw[0] = REQ_HEAD;
  raw[1] = cmdId;
  raw[2] = cmd;
  raw.set(params, 3);
  raw[raw.length - 1] = checksum(raw, 1, raw.length - 2);
  return raw;
}

function digits6(passwd: number): Uint8Array {
  const out = new Uint8Array(6);
  out[0] = Math.floor(passwd / 100_000) % 10;
  out[1] = Math.floor(passwd / 10_000) % 10;
  out[2] = Math.floor(passwd / 1_000) % 10;
  out[3] = Math.floor(passwd / 100) % 10;
  out[4] = Math.floor(passwd / 10) % 10;
  out[5] = passwd % 10;
  return out;
}

export function buildSetTime(t = new Date(), cmdId?: number): Uint8Array {
  return buildFrame(
    BleCmd.SET_TIME,
    new Uint8Array([
      t.getFullYear() - 2000,
      t.getMonth() + 1,
      t.getDate(),
      t.getHours(),
      t.getMinutes(),
      t.getSeconds(),
    ]),
    cmdId,
  );
}

export function buildAuthPasswd(passwd: number, cmdId?: number): Uint8Array {
  return buildFrame(BleCmd.AUTH_PASSWD, digits6(passwd), cmdId);
}

export function buildOpenLock(sleepMode: 1 | 2 = 1, cmdId?: number): Uint8Array {
  return buildFrame(BleCmd.OPEN_LOCK, new Uint8Array([sleepMode]), cmdId);
}

export function buildCloseLock(sleepMode: 1 | 2 = 1, cmdId?: number): Uint8Array {
  return buildFrame(BleCmd.CLOSE_LOCK, new Uint8Array([sleepMode]), cmdId);
}

export function buildGetStatus(sleepMode: 1 | 2 = 1, cmdId?: number): Uint8Array {
  return buildFrame(BleCmd.GET_STATUS, new Uint8Array([sleepMode]), cmdId);
}

export interface BleResponse {
  cmdId: number;
  cmd: number;
  payload: Uint8Array;
}

export function parseResponse(raw: Uint8Array): BleResponse {
  if (raw.length < 4) throw new Error('response too short');
  if (raw[0] !== RESP_HEAD) throw new Error(`bad response head 0x${raw[0]!.toString(16)}`);
  const computed = checksum(raw, 1, raw.length - 2);
  if (computed !== raw[raw.length - 1]) throw new Error('bad checksum');
  return {
    cmdId: raw[1]!,
    cmd: raw[2]!,
    payload: raw.slice(3, raw.length - 1),
  };
}

export async function encryptRequest(key: Uint8Array, raw: Uint8Array): Promise<Uint8Array> {
  return aesEncrypt(key, pack16(raw));
}

export async function decryptResponse(
  key: Uint8Array,
  encrypted: Uint8Array,
): Promise<Uint8Array> {
  return unpack16(await aesDecrypt(key, encrypted));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}
