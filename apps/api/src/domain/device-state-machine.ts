import type { DeviceStatus } from '@abd/shared';
import { ApiError } from '@abd/shared';

/**
 * Allowed status transitions. See docs/data-model.md §3.3.
 * Each key is the source status; the value is the set of statuses you may move to.
 * Terminal state: `retired` (no outgoing edges).
 */
const TRANSITIONS: Record<DeviceStatus, readonly DeviceStatus[]> = {
  manufactured: ['in_warehouse', 'repairing'],
  in_warehouse: ['shipped', 'repairing', 'retired'],
  shipped: ['delivered', 'in_warehouse'], // allow recall
  delivered: ['assigned', 'returned', 'repairing'],
  assigned: ['active', 'delivered', 'repairing'], // allow unassign or RMA
  active: ['active', 'returned', 'repairing'], // idempotent for re-deploy; returned for RMA
  // After repair, device returns to its prior status (handled by device-repair
  // route by reading prior_status); the state machine just enumerates the
  // closeout edges that are reachable.
  repairing: ['manufactured', 'in_warehouse', 'delivered', 'assigned', 'active', 'retired'],
  returned: ['in_warehouse', 'repairing', 'retired'],
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
