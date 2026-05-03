import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveKey1,
  deriveKey2,
  pack16,
  unpack16,
  encryptRequest,
  decryptResponse,
  buildAuthPasswd,
  parseResponse,
  BleCmd,
  REQ_HEAD,
} from './index.js';

test('deriveKey1 matches BleLockSdk.kt', () => {
  const mac = Buffer.from('E16A9CF1F87E', 'hex');
  const key = deriveKey1(mac);
  assert.equal(key.length, 16);
  assert.equal(key.subarray(0, 6).toString('hex'), 'e16a9cf1f87e');
  const tail = Array.from(key.subarray(6));
  assert.deepEqual(tail, [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa]);
});

test('deriveKey2 replaces last 6 bytes with date components', () => {
  const k1 = deriveKey1(Buffer.from('E16A9CF1F87E', 'hex'));
  const t = new Date(2026, 3, 22, 16, 30, 45);
  const k2 = deriveKey2(k1, t);
  assert.deepEqual(Array.from(k2.subarray(10)), [26, 4, 22, 16, 30, 45]);
});

test('pack16/unpack16 round-trip', () => {
  const raw = Buffer.from([REQ_HEAD, 0x01, BleCmd.GET_STATUS, 0x01, 0x00]);
  const block = pack16(raw);
  assert.equal(block.length, 16);
  assert.equal(block[0], 0xfb);
  assert.equal(block[1], raw.length);
  assert.equal(block[15], 0xfc);
  const back = unpack16(block);
  assert.deepEqual(back, raw);
});

test('AES round-trip with key1', () => {
  const key = deriveKey1(Buffer.from('E16A9CF1F87E', 'hex'));
  const raw = buildAuthPasswd(0);
  const enc = encryptRequest(key, raw);
  assert.equal(enc.length, 16);
  const dec = decryptResponse(key, enc);
  assert.deepEqual(dec, raw);
});

test('buildAuthPasswd encodes 123456 as digits', () => {
  const raw = buildAuthPasswd(123456);
  assert.deepEqual(Array.from(raw.subarray(3, 9)), [1, 2, 3, 4, 5, 6]);
});

test('parseResponse validates head and checksum', () => {
  const resp = Buffer.from([0xaa, 0x02, BleCmd.AUTH_PASSWD, 0x00, 0x00]);
  resp[resp.length - 1] = (0x02 + BleCmd.AUTH_PASSWD + 0x00) & 0xff;
  const r = parseResponse(resp);
  assert.equal(r.cmd, BleCmd.AUTH_PASSWD);
  assert.equal(r.payload[0], 0x00);
});

test('parseResponse rejects bad checksum', () => {
  const resp = Buffer.from([0xaa, 0x02, BleCmd.AUTH_PASSWD, 0x00, 0xff]);
  assert.throws(() => parseResponse(resp));
});

import { buildGetImei, parseImeiResponse, encodeImeiBcd } from './index.js';

test('encodeImeiBcd packs 15 ASCII digits into 8 BCD bytes (last nibble = 0xF)', () => {
  const buf = encodeImeiBcd('861234567890123');
  assert.equal(buf.length, 8);
  assert.deepEqual(
    Array.from(buf),
    [0x86, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x3f],
  );
});

test('encodeImeiBcd rejects non-15-digit input', () => {
  assert.throws(() => encodeImeiBcd('12345')); // too short
  assert.throws(() => encodeImeiBcd('86123456789012a')); // non-digit
  assert.throws(() => encodeImeiBcd('1234567890123456')); // too long
});

test('parseImeiResponse roundtrips encodeImeiBcd output', () => {
  const samples = [
    '861234567890123',
    '352099001761481',
    '999999999999999',
    '000000000000001',
  ];
  for (const imei of samples) {
    const bcd = encodeImeiBcd(imei);
    assert.equal(parseImeiResponse(bcd), imei);
  }
});

test('parseImeiResponse rejects malformed input', () => {
  // Wrong length
  assert.equal(parseImeiResponse(Buffer.alloc(7)), null);
  assert.equal(parseImeiResponse(Buffer.alloc(9)), null);
  // Non-decimal nibble that isn't the trailing 0xF padding
  const bad = Buffer.from([0x86, 0x1a, 0x34, 0x56, 0x78, 0x90, 0x12, 0x3f]);
  assert.equal(parseImeiResponse(bad), null);
});

test('GET_IMEI request frame fits in a 16-byte AES block', () => {
  // [0x55][cmdId][0x60][sleepMode][checksum] = 5 raw bytes
  const req = buildGetImei(0x01, 0x42);
  assert.equal(req.length, 5);
  assert.equal(req[0], 0x55);
  assert.equal(req[2], 0x60);
  // pack16 prepends [0xFB][len] and pads to 16 with 0xFC
  const block = pack16(req);
  assert.equal(block.length, 16);
  assert.equal(block[0], 0xfb);
  assert.equal(block[1], req.length);
});

test('GET_IMEI response frame fits in a 16-byte AES block', () => {
  // Response shape: [0xAA][cmdId][0x60][8 BCD bytes][checksum] = 12 raw bytes
  const bcd = encodeImeiBcd('861234567890123');
  const resp = Buffer.alloc(12);
  resp[0] = 0xaa;
  resp[1] = 0x42;
  resp[2] = 0x60;
  bcd.copy(resp, 3);
  // checksum = sum from [1] through [10] (length-2 bytes)
  let s = 0;
  for (let i = 1; i <= 10; i++) s = (s + resp[i]!) & 0xff;
  resp[11] = s;
  // The whole thing must fit in pack16's 14-byte raw window
  assert.ok(resp.length <= 14);
  const block = pack16(resp);
  assert.equal(block.length, 16);
});
