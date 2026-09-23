/**
 * D-060 — the PracticeSession half of the `Enrollment -> PracticeSession ->
 * PracticeBlock -> Attempt` grouped-practice foundation. The pre-existing
 * `Enrollment -> Attempt` path (ordinary, ungrouped practice) is untouched
 * and remains valid on its own (docs/DECISIONS.md D-060).
 *
 * Restated from the Prisma schema (`PracticeSessionStatus` in
 * packages/db/prisma/schema.prisma) rather than imported from
 * `@prisma/client` — domain packages must not import a concrete persistence
 * client (docs/ARCHITECTURE.md §6), the same discipline `@ipmat/attempt`
 * already follows for `AttemptStatus`.
 *
 * Deliberately has NO dependency on `@ipmat/practice-block` (or vice versa)
 * — the two entities are siblings, not a hierarchy either package
 * hard-codes knowledge of. Session-level lifecycle rules that depend on
 * block state (e.g. "cannot complete a session with an active block") take
 * that fact as a plain caller-supplied boolean, never by reaching into
 * `@ipmat/practice-block` directly (docs/DECISIONS.md D-060).
 */

/**
 * `active` is the only non-terminal state; `completed`/`abandoned` are both
 * equally final — mirrors `AttemptStatus`'s exact discipline (docs/
 * DECISIONS.md D-035): nothing in this package ever transitions a finalized
 * session back to `active` or from one terminal state to another.
 */
export type PracticeSessionStatus = "active" | "completed" | "abandoned";

/**
 * The pure, in-memory representation of a practice session. Deliberately
 * has NO `studentId` field — ownership is resolved only through the single
 * `enrollmentId -> Enrollment.studentId` chain (docs/DECISIONS.md D-060),
 * unlike `Attempt`, which carries a redundant `studentId` alongside
 * `enrollmentId` for its own demonstrated high-frequency direct-query need
 * that `PracticeSession` does not share. No `currentBlock`/cumulative
 * elapsed-time field either — both are always derived on read (docs/
 * DECISIONS.md D-015's "derive, never cache" discipline), never stored
 * here.
 */
export interface PracticeSessionState {
  id: string;
  enrollmentId: string;
  status: PracticeSessionStatus;
  startedAt: string;
  /** Set only by `completePracticeSession()`/`abandonPracticeSession()`. Null while `active`. */
  endedAt: string | null;
  /** Configuration only — never enforced automatically by this package (no code path here reads the clock or auto-terminates a session on budget expiry). A future orchestration layer's job, not this one's. */
  sessionTimeBudgetSeconds: number | null;
}

export const PRACTICE_SESSION_LIFECYCLE_ERROR_CODES = [
  "session_not_found",
  "already_finalized",
  "has_active_block",
  "impossible_timestamp",
  "invalid_time_budget"
] as const;

export type PracticeSessionLifecycleErrorCode = (typeof PRACTICE_SESSION_LIFECYCLE_ERROR_CODES)[number];

/**
 * Every invalid-transition / malformed-input case in this package fails
 * closed by throwing this, never by silently ignoring the problem or
 * returning a partially-updated state — mirrors `@ipmat/attempt`'s
 * `AttemptLifecycleError` exactly (same constructor shape, same "fail
 * closed on a precondition violation" role).
 */
export class PracticeSessionLifecycleError extends Error {
  readonly code: PracticeSessionLifecycleErrorCode;

  constructor(code: PracticeSessionLifecycleErrorCode, message: string) {
    super(message);
    this.name = "PracticeSessionLifecycleError";
    this.code = code;
  }
}
