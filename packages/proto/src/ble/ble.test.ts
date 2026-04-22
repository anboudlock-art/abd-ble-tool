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
