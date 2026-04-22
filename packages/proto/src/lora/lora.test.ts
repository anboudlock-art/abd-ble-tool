import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUplink,
  encodeDownlink,
  LoraLockStatus,
  LoraLockCommand,
  macToString,
  parseMac,
  LORA_UPLINK_LEN,
  LORA_DOWNLINK_LEN,
} from './index.js';

test('parseUplink decodes the 11-byte frame from the integration guide', () => {
  const raw = Buffer.from('0008' + '06' + 'E16A9CF1F87E' + '10' + '64', 'hex');
  assert.equal(raw.length, LORA_UPLINK_LEN);
  const r = parseUplink(raw);
  assert.equal(r.addr, 0x0008);
  assert.equal(r.channel, 0x06);
  assert.equal(macToString(r.mac), 'E1:6A:9C:F1:F8:7E');
  assert.equal(r.status, LoraLockStatus.CLOSED);
  assert.equal(r.battery, 100);
});

test('encodeDownlink round-trips the UNLOCK example from the guide', () => {
  const mac = parseMac('E1:6A:9C:F1:F8:7E');
  const buf = encodeDownlink({
    addr: 0x0008,
    channel: 0x06,
    mac,
    command: LoraLockCommand.UNLOCK,
  });
  assert.equal(buf.length, LORA_DOWNLINK_LEN);
  assert.equal(buf.toString('hex').toUpperCase(), '000806E16A9CF1F87E01');
});

test('parseUplink rejects wrong length', () => {
  assert.throws(() => parseUplink(Buffer.alloc(10)));
});

test('parseMac rejects invalid input', () => {
  assert.throws(() => parseMac('ZZ:XX'));
});
