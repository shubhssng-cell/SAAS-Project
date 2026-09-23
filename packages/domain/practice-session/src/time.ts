import type { PracticeSessionState } from "./types.js";

/**
 * D-060's three independently-derived, non-summing time measures, the
 * PracticeSession half. There is NO asserted algebraic relationship
 * between wall-clock duration and active solving time (a session can
 * contain idle time before its first attempt, after its last attempt, or
 * time not captured by any `Attempt.timeSpentSeconds` at all) — corrected
 * explicitly during D-060's design review; do not reintroduce a "duration
 * minus solving time equals gaps" claim.
 *
 * Deliberately structural, not importing `AttemptState` from
 * `@ipmat/attempt` — this package stays dependency-free, and the only
 * fact this measure needs from an attempt is its own `timeSpentSeconds`.
 */

/** `endedAt - startedAt` in whole seconds. Null while the session is still `active` (no `endedAt` yet) — never inferred from "now". */
export function deriveSessionWallClockDurationSeconds(session: PracticeSessionState): number | null {
  if (session.endedAt === null) return null;
  const startedMs = Date.parse(session.startedAt);
  const endedMs = Date.parse(session.endedAt);
  return Math.round((endedMs - startedMs) / 1000);
}

/**
 * `sum(Attempt.timeSpentSeconds)` across every attempt the caller supplies
 * (typically every attempt belonging to any block under this session) —
 * reuses the existing event-sourced field (docs/DECISIONS.md D-034) rather
 * than any new timing source. An attempt still `in_progress` contributes 0
 * (its `timeSpentSeconds` is null until finalized), never throws.
 */
export function deriveSessionActiveSolvingTimeSeconds(attempts: ReadonlyArray<{ timeSpentSeconds: number | null }>): number {
  return attempts.reduce((sum, attempt) => sum + (attempt.timeSpentSeconds ?? 0), 0);
}
