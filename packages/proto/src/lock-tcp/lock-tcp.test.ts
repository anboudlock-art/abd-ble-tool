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

import {
  imsiFromLoginPayload,
  parseGpsBlock,
  batteryFromGps,
  lockStatusFromGps,
  LockStatus,
  encodeTimeSync,
  parseStatusResponse,
} from './index.js';

test('imsiFromLoginPayload extracts the 15-char ASCII IMSI suffix', () => {
  // 26 bytes of GPS-block dummy + 15 bytes ASCII IMSI
  const p = Buffer.alloc(41);
  Buffer.from('8911026C0032832', 'ascii').copy(p, 26);
  assert.equal(imsiFromLoginPayload(p), '8911026C0032832');
});

test('imsiFromLoginPayload returns null when missing/zero', () => {
  // <41 byte payload
  assert.equal(imsiFromLoginPayload(Buffer.alloc(30)), null);
  // all-zero IMSI section
  const allZero = Buffer.alloc(41);
  assert.equal(imsiFromLoginPayload(allZero), null);
});

test('parseGpsBlock decodes lat/lng and alarm bytes', () => {
  // Build a 26-byte block: ts=1, lat=22deg30.12345', lng=113deg30.6789'
  // BCD packing: 22 30 12 34 = bytes [0x22, 0x30, 0x12, 0x34], same for lng.
  const p = Buffer.alloc(26);
  p.writeUInt32BE(1, 0);
  p.set([0x22, 0x30, 0x12, 0x34], 4);   // 22 30.1234
  p.set([0x11, 0x33, 0x06, 0x78], 8);   // 113 30.0678 (4 BCD bytes ddd mm.mmmm)
  p[12] = 0; // speed
  p[13] = 0; // direction (N + E)
  p[14] = 0;
  p.set([0, 0, 0], 15); // distance
  p.set([0, 0, 0], 18); // term status
  p.set([0xaa, 0xbb, 87, LockStatus.LOCKED], 21); // A0 A1 A2(=87% bat) A3(=locked)
  p[25] = 0;
  const g = parseGpsBlock(p)!;
  assert.ok(g);
  assert.equal(g.timestamp, 1);
  assert.ok(g.lat! > 22 && g.lat! < 23);
  assert.ok(g.lng! > 113 && g.lng! < 114);
  assert.equal(batteryFromGps(g), 87);
  assert.equal(lockStatusFromGps(g), LockStatus.LOCKED);
});

test('parseGpsBlock returns null for short payload', () => {
  assert.equal(parseGpsBlock(Buffer.alloc(20)), null);
});

test('encodeTimeSync produces a valid 26-byte frame with 20-char ASCII payload', () => {
  const fixed = new Date('2026-03-25T12:16:20Z'); // UTC; +08 → 20:16:20
  const buf = encodeTimeSync(0xdeadbeef, fixed, 8);
  const out = decodeOne(buf)!;
  assert.equal(out.frame.addr, 0x21);
  assert.equal(out.frame.sub, 0x10);
  assert.equal(out.frame.subLen, 0x14);
  const ascii = out.frame.payload.toString('ascii');
  assert.equal(ascii.length, 20);
  // YY/MM/DD,hh:mm:ss+TZ
  assert.match(ascii, /^\d{2}\/\d{2}\/\d{2},\d{2}:\d{2}:\d{2}\+\d{2}$/);
  assert.equal(ascii, '26/03/25,20:16:20+08');
});

test('parseStatusResponse decodes the 0x12 query reply', () => {
  // Body: [0x2A, 0x55, 0x12, lockId LE 4B, serial LE 2B, voltage, lockState] + 26B GPS
  const body = Buffer.alloc(11 + 26);
  body.set([0x2a, 0x55, 0x12], 0);
  body.writeUInt32LE(0x12345678, 3);
  body.writeUInt16LE(0xabcd, 7);
  body[9] = 200; // voltage byte
  body[10] = LockStatus.SEALED;
  // 26B GPS — keep mostly zero, set alarms[3]=SEALED so it's coherent
  body[11 + 21] = 0; // A0
  body[11 + 23] = 75; // A2 = 75% bat
  body[11 + 24] = LockStatus.SEALED; // A3
  const r = parseStatusResponse(body)!;
  assert.ok(r);
  assert.equal(r.funcCode, 0x12);
  assert.equal(r.reportSerial, 0xabcd);
  assert.equal(r.voltageByte, 200);
  assert.equal(r.lockState, LockStatus.SEALED);
  assert.ok(r.gps);
  assert.equal(batteryFromGps(r.gps!), 75);
});

test('parseStatusResponse rejects non-status body', () => {
  const body = Buffer.alloc(11);
  body.set([0xff, 0xff, 0x12], 0); // wrong magic
  assert.equal(parseStatusResponse(body), null);
});
