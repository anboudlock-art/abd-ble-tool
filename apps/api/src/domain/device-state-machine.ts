import type { DeviceStatus } from '@abd/shared';
import { ApiError } from '@abd/shared';

/**
 * Allowed status transitions. See docs/data-model.md §3.3.
 * Each key is the source status; the value is the set of statuses you may move to.
 * Terminal state: `retired` (no outgoing edges).
 */
const TRANSITIONS: Record<DeviceStatus, readonly DeviceStatus[]> = {
  manufactured: ['in_warehouse'],
  in_warehouse: ['shipped', 'retired'],
  shipped: ['delivered', 'in_warehouse'], // allow recall
  delivered: ['assigned', 'returned'],
  assigned: ['active', 'delivered'], // allow unassign back to company pool
  active: ['active', 'returned'], // idempotent for re-deploy; returned for RMA
  returned: ['in_warehouse', 'retired'],
  retired: [],
};

export function assertTransition(from: DeviceStatus, to: DeviceStatus): void {
  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(`Cannot transition device from '${from}' to '${to}'`);
  }
}

export function canTransition(from: DeviceStatus, to: DeviceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: DeviceStatus): readonly DeviceStatus[] {
  return TRANSITIONS[from];
}
