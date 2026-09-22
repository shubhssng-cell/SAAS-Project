import type { AttemptEventRecord, AttemptState } from "./types.js";

/**
 * Reconstructs the attempt's full event timeline in the order events
 * actually occurred (Phase 4A §8, "event ordering reconstruction"). Events
 * are already append-ordered and timestamp-monotonic by construction
 * (`recordAttemptEvent`/the finalization functions reject any event or
 * finalization whose timestamp precedes the prior one — see
 * `lifecycle.ts`), so this is a direct, defensive re-sort rather than a
 * trust-the-array-order assumption: if two timestamps are exactly equal,
 * `Array.prototype.sort` preserves the original (already-correct) relative
 * order, since it is a stable sort.
 */
export function getEventTimeline(attempt: AttemptState): AttemptEventRecord[] {
  return [...attempt.events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}
