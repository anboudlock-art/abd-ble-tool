import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameParser,
  Sub,
  crc8,
  decodeOne,
  encodeFrame,
  encodeQueryStatus,
  encodeUnlock,
  macFromLoginPayload,
} from './index.js';

test('crc8 matches firmware: empty buffer = 0', () => {
  assert.equal(crc8(Buffer.alloc(0), 0, 0), 0);
});

test('crc8 lookup matches a known sequence', () => {
  // Single byte 0x05 (the heartbeat addr) → table[0 ^ 0x05] = 63
  assert.equal(crc8(Buffer.from([0x05]), 0, 1), 63);
  // Two bytes [0x05, 0x06] → first → 63 → table[63 ^ 0x06] = ?
  // We don't precompute; just round-trip via encodeFrame which uses the
  // same routine and assert decode succeeds (CRC validation passes).
  const frame = encodeFrame({
    lockSN: 0,
    addr: 0x05,
    sub: 0x06,
    subLen: 0,
    payload: Buffer.from([0x06]),
  });
  const out = decodeOne(frame);
  assert.ok(out);
});

test('encodeFrame / decodeOne round-trip (heartbeat-shape)', () => {
  const payload = Buffer.from('V10.0', 'ascii');
  const frame = encodeFrame({
    lockSN: 0x014552eb,
    addr: 0x05,
    sub: Sub.HEARTBEAT,
    subLen: 0,
    payload,
  });

  // total = DataLen(=5+5=10) + 6 = 16
  assert.equal(frame.length, 16);
  assert.equal(frame[0], 0xfe);
  assert.equal(frame[15], 0xff);
  // LockSN little-endian
  assert.equal(frame[1], 0xeb);
  assert.equal(frame[4], 0x01);
  // DataLen
  assert.equal(frame[8], 10);

  const out = decodeOne(frame);
  assert.ok(out);
  assert.equal(out.consumed, 16);
  assert.equal(out.frame.lockSN, 0x014552eb);
  assert.equal(out.frame.addr, 0x05);
  assert.equal(out.frame.sub, Sub.HEARTBEAT);
  assert.equal(out.frame.payload.toString('ascii'), 'V10.0');
});

test('FrameParser splits two concatenated frames', () => {
  const f1 = encodeFrame({
    lockSN: 1,
    addr: 0x05,
    sub: 0x06,
    subLen: 0,
    payload: Buffer.from('A'),
  });
  const f2 = encodeFrame({
    lockSN: 2,
    addr: 0x07,
    sub: 0x01,
    subLen: 0,
    payload: Buffer.from([1, 2, 3, 4]),
  });
  const p = new FrameParser();
  const { frames, errors } = p.push(Buffer.concat([f1, f2]));
  assert.equal(errors.length, 0);
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.lockSN, 1);
  assert.equal(frames[1]!.lockSN, 2);
});

test('FrameParser buffers across chunk boundaries', () => {
  const f = encodeFrame({
    lockSN: 5,
    addr: 0x03,
    sub: 0x0a,
    subLen: 0,
    payload: Buffer.alloc(10, 0x42),
  });
  const p = new FrameParser();
  const r1 = p.push(f.subarray(0, 4));
  assert.equal(r1.frames.length, 0);
  const r2 = p.push(f.subarray(4, 9));
  assert.equal(r2.frames.length, 0);
  const r3 = p.push(f.subarray(9));
  assert.equal(r3.frames.length, 1);
  assert.equal(r3.frames[0]!.payload.length, 10);
});

test('FrameParser resyncs past garbage', () => {
  const good = encodeFrame({
    lockSN: 1,
    addr: 0x05,
    sub: 0x06,
    subLen: 0,
    payload: Buffer.from('X'),
  });
  const noise = Buffer.from([0x00, 0xff, 0x12, 0x34]);
  const p = new FrameParser();
  const { frames, errors } = p.push(Buffer.concat([noise, good]));
  assert.equal(errors.length, 0);
  assert.equal(frames.length, 1);
});

test('FrameParser surfaces CRC errors', () => {
  const good = encodeFrame({
    lockSN: 1,
    addr: 0x05,
    sub: 0x06,
    subLen: 0,
    payload: Buffer.from('Y'),
  });
  const bad = Buffer.from(good);
  bad[bad.length - 2] = (bad[bad.length - 2]! ^ 0xff) & 0xff; // flip CRC
  const p = new FrameParser();
  const r = p.push(bad);
  assert.ok(r.errors.length > 0);
});

test('macFromLoginPayload extracts BLE MAC at [14..19]', () => {
  const payload = Buffer.alloc(26, 0);
  Buffer.from([0xe1, 0x6a, 0x9c, 0xf1, 0xf8, 0x7e]).copy(payload, 14);
  assert.equal(macFromLoginPayload(payload), 'E1:6A:9C:F1:F8:7E');
});

test('encodeUnlock + encodeQueryStatus produce valid frames', () => {
  const unlock = encodeUnlock({
    lockSN: 0xdeadbeef,
    password6: '123456',
    ttlMinutes: 30,
    reportSerial: 0xabcd,
  });
  const out = decodeOne(unlock);
  assert.ok(out);
  assert.equal(out.frame.addr, 0x81);
  assert.equal(out.frame.sub, 0x2d);
  assert.equal(out.frame.payload[2], 0xa0); // unlock sub-cmd

  const query = encodeQueryStatus(1, 0xbeef);
  const qout = decodeOne(query);
  assert.ok(qout);
  assert.equal(qout.frame.addr, 0x81);
  assert.equal(qout.frame.payload[2], 0x12); // query sub-cmd
});
