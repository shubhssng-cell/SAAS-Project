/**
 * D-060 — the PracticeBlock half of the `Enrollment -> PracticeSession ->
 * PracticeBlock -> Attempt` grouped-practice foundation. See
 * `@ipmat/practice-session` for the sibling entity this package
 * deliberately does NOT depend on (docs/DECISIONS.md D-060) — cross-entity
 * lifecycle checks (e.g. "the parent session must still be active to
 * create a block") take the fact as a plain caller-supplied boolean.
 *
 * Restated from the Prisma schema (`PracticeBlockStatus` in
 * packages/db/prisma/schema.prisma) rather than imported from
 * `@prisma/client` — domain packages must not import a concrete
 * persistence client (docs/ARCHITECTURE.md §6).
 */

/** `active` is the only non-terminal state; `completed`/`abandoned` are both equally final — same discipline as `AttemptStatus`/`PracticeSessionStatus` (docs/DECISIONS.md D-035, D-060). */
export type PracticeBlockStatus = "active" | "completed" | "abandoned";

/**
 * The pure, in-memory representation of one practice block. No
 * `studentId`/`enrollmentId` duplicated here — ownership resolves via
 * `practiceSessionId -> PracticeSession.enrollmentId -> Enrollment.studentId`
 * (docs/DECISIONS.md D-060). No `currentAttemptCount`/cumulative-time field
 * either — always derived on read (see `deriveBlockProgress()`,
 * `time.ts`), never stored.
 */
export interface PracticeBlockState {
  id: string;
  practiceSessionId: string;
  /** Unique within its parent session, server-assigned as `(current max for the session) + 1` inside a Serializable-isolated transaction (docs/DECISIONS.md D-060) — never inferred from timestamps, never caller-supplied. */
  sequenceNumber: number;
  status: PracticeBlockStatus;
  startedAt: string;
  /** Set only by `completePracticeBlock()`/`abandonPracticeBlock()`. Null while `active`. */
  endedAt: string | null;
  /** Configuration only — informational for `deriveBlockProgress()`; reaching it never auto-completes the block (docs/DECISIONS.md D-060 — completion is always an explicit action). */
  targetQuestionCount: number | null;
  blockTimeBudgetSeconds: number | null;
}

export const PRACTICE_BLOCK_LIFECYCLE_ERROR_CODES = [
  "block_not_found",
  "already_finalized",
  "session_not_active",
  "invalid_sequence_number",
  "impossible_timestamp",
  "invalid_time_budget",
  "invalid_target_question_count"
] as const;

export type PracticeBlockLifecycleErrorCode = (typeof PRACTICE_BLOCK_LIFECYCLE_ERROR_CODES)[number];

/** Mirrors `@ipmat/attempt`'s `AttemptLifecycleError` / `@ipmat/practice-session`'s `PracticeSessionLifecycleError` exactly — fail closed on any invalid transition or malformed input, never a silent partial update. */
export class PracticeBlockLifecycleError extends Error {
  readonly code: PracticeBlockLifecycleErrorCode;

  constructor(code: PracticeBlockLifecycleErrorCode, message: string) {
    super(message);
    this.name = "PracticeBlockLifecycleError";
    this.code = code;
  }
}
