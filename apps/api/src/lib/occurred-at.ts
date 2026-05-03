/**
 * v2.8: shared rules for client-supplied wall-clock timestamps on
 * BLE-precheck commands and offline replays. Phones drift, batteries
 * die, users sometimes manually rewind clocks. We accept that, but
 * within bounds, and we log every adjustment.
 *
 * Rules:
 *   occurredAt > now() + 60s  → reject (HTTP 400). The phone clock is
 *     ahead of the server; client must re-sync before retrying. The
 *     60s slack handles benign GPS-vs-NTP drift.
 *   now() - 7d <= occurredAt <= now() + 60s  → accept as-is.
 *   occurredAt < now() - 7d  → accept request, but rewrite to now() and
 *     attach a serverNote so the audit log shows the rewrite.
 */

import { ApiError } from '@abd/shared';

const FUTURE_TOLERANCE_MS = 60_000; // 1 minute
const PAST_HORIZON_MS = 7 * 24 * 3600 * 1000; // 7 days

export interface OccurredAtResult {
  /** Final timestamp to write on the row. Equals input when accepted
   *  in-window, equals now() when clamped. */
  occurredAt: Date;
  /** Free-form server-side audit when we adjusted the input. Empty
   *  string means no adjustment. */
  serverNote: string | null;
}

/**
 * Apply the rules above to an optional client-supplied ISO timestamp.
 *
 * @throws ApiError 400 when occurredAt is more than 60 s in the future.
 */
export function resolveOccurredAt(input: string | undefined, now = new Date()): OccurredAtResult {
  if (!input) {
    return { occurredAt: now, serverNote: null };
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiError.badRequest('occurredAt is not a valid ISO timestamp');
  }
  const diff = parsed.getTime() - now.getTime();
  if (diff > FUTURE_TOLERANCE_MS) {
    throw ApiError.badRequest(
      `occurredAt is ${Math.round(diff / 1000)}s in the future; client clock must be re-synced`,
    );
  }
  if (-diff > PAST_HORIZON_MS) {
    return {
      occurredAt: now,
      serverNote: `clamped: occurredAt was ${parsed.toISOString()} (>7d ago); used now()`,
    };
  }
  return { occurredAt: parsed, serverNote: null };
}

/** v2.8: derive the 1-byte BLE cmdId field from a DeviceCommand row id.
 *  Range 1-255; 0 is replaced with 1 because the firmware treats 0 as
 *  invalid. APP must use this exact value when building the BLE frame
 *  so request/response correlation works. */
export function bleCmdIdFor(commandId: bigint): number {
  const low = Number(commandId & 0xffn);
  return low || 1;
}
