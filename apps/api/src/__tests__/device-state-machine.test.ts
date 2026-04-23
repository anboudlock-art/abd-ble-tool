import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, canTransition, nextStatuses } from '../domain/device-state-machine.js';

test('happy path through lifecycle', () => {
  assert.ok(canTransition('manufactured', 'in_warehouse'));
  assert.ok(canTransition('in_warehouse', 'shipped'));
  assert.ok(canTransition('shipped', 'delivered'));
  assert.ok(canTransition('delivered', 'assigned'));
  assert.ok(canTransition('assigned', 'active'));
});

test('retired is terminal', () => {
  assert.deepEqual(nextStatuses('retired'), []);
});

test('active is idempotent (re-deploy)', () => {
  assert.ok(canTransition('active', 'active'));
});

test('cannot skip states', () => {
  assert.ok(!canTransition('manufactured', 'delivered'));
  assert.ok(!canTransition('in_warehouse', 'assigned'));
});

test('assertTransition throws ApiError with 409', () => {
  assert.throws(
    () => assertTransition('manufactured', 'active'),
    (err: unknown) => err instanceof Error && err.message.includes("manufactured"),
  );
});
