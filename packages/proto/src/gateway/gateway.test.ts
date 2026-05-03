import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FrameParser,
  FrameType,
  encodeFrame,
  encodeRegisterPayload,
  parseRegisterPayload,
  encodeHeartbeatAck,
} from './index.js';

test('FrameParser splits concatenated frames', () => {
  const f1 = encodeFrame(FrameType.HEARTBEAT);
  const f2 = encodeFrame(FrameType.LORA_UPLINK, Buffer.from('000806E16A9CF1F87E1064', 'hex'));
  const parser = new FrameParser();
  const frames = parser.push(Buffer.concat([f1, f2]));
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.type, FrameType.HEARTBEAT);
  assert.equal(frames[1]!.type, FrameType.LORA_UPLINK);
  assert.equal(frames[1]!.payload.length, 11);
});

test('FrameParser buffers across chunk boundaries', () => {
  const full = encodeFrame(FrameType.LORA_UPLINK, Buffer.from('000806E16A9CF1F87E1064', 'hex'));
  const parser = new FrameParser();
  assert.equal(parser.push(full.subarray(0, 3)).length, 0);
  assert.equal(parser.push(full.subarray(3, 7)).length, 0);
  const frames = parser.push(full.subarray(7));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.payload.length, 11);
});

test('FrameParser resyncs past garbage', () => {
  const good = encodeFrame(FrameType.HEARTBEAT);
  const mixed = Buffer.concat([Buffer.from([0x01, 0x02, 0x03]), good]);
  const parser = new FrameParser();
  const frames = parser.push(mixed);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.type, FrameType.HEARTBEAT);
});

test('REGISTER payload round-trips', () => {
  const encoded = encodeRegisterPayload({
    gwId: '17',
    timestamp: 0,
    token: 'ABCDEFGHIJKL',
  });
  assert.equal(encoded.length, 24);
  const decoded = parseRegisterPayload(encoded);
  assert.equal(decoded.gwId, '00000017');
  assert.equal(decoded.timestamp, 0);
  assert.equal(decoded.token, 'ABCDEFGHIJKL');
});

test('Heartbeat ACK wire format is AB CD 11 00', () => {
  assert.equal(encodeHeartbeatAck().toString('hex').toUpperCase(), 'ABCD1100');
});
