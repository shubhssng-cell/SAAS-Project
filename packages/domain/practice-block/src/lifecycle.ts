import { PracticeBlockLifecycleError, type PracticeBlockState } from "./types.js";

function parseTimestampMs(value: string, whatFor: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new PracticeBlockLifecycleError("impossible_timestamp", `${whatFor} ("${value}") is not a parseable timestamp`);
  }
  return ms;
}

function assertExists(block: PracticeBlockState | null | undefined): asserts block is PracticeBlockState {
  if (!block) {
    throw new PracticeBlockLifecycleError("block_not_found", "Cannot operate on a nonexistent PracticeBlock");
  }
}

function assertActive(block: PracticeBlockState, action: string): void {
  if (block.status !== "active") {
    throw new PracticeBlockLifecycleError(
      "already_finalized",
      `Cannot ${action}: PracticeBlock "${block.id}" is already "${block.status}", not "active"`
    );
  }
}

function assertValidTimeBudget(seconds: number | null | undefined): void {
  if (seconds === undefined || seconds === null) return;
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new PracticeBlockLifecycleError("invalid_time_budget", `blockTimeBudgetSeconds must be a positive integer if provided, got ${String(seconds)}`);
  }
}

function assertValidTargetQuestionCount(count: number | null | undefined): void {
  if (count === undefined || count === null) return;
  if (!Number.isInteger(count) || count <= 0) {
    throw new PracticeBlockLifecycleError("invalid_target_question_count", `targetQuestionCount must be a positive integer if provided, got ${String(count)}`);
  }
}

/**
 * createPracticeBlock() — the only way an `active` PracticeBlockState comes
 * into existence. `sequenceNumber` is NOT computed here (this package has
 * no repository access) — the caller (the repository layer, inside a
 * Serializable transaction, per docs/DECISIONS.md D-060) resolves it as
 * `(current max for the session) + 1` and passes it in already-assigned;
 * this function only validates it's a positive integer.
 *
 * `sessionIsActive` is a plain caller-supplied boolean — "block creation
 * only under an active session" (docs/DECISIONS.md D-060) is enforced here
 * without this package ever importing `@ipmat/practice-session`.
 */
export function createPracticeBlock(input: {
  id: string;
  practiceSessionId: string;
  sequenceNumber: number;
  now: string;
  sessionIsActive: boolean;
  targetQuestionCount?: number | null;
  blockTimeBudgetSeconds?: number | null;
}): PracticeBlockState {
  parseTimestampMs(input.now, "now");
  assertValidTimeBudget(input.blockTimeBudgetSeconds);
  assertValidTargetQuestionCount(input.targetQuestionCount);

  if (!Number.isInteger(input.sequenceNumber) || input.sequenceNumber <= 0) {
    throw new PracticeBlockLifecycleError(
      "invalid_sequence_number",
      `sequenceNumber must be a positive integer, got ${String(input.sequenceNumber)}`
    );
  }

  if (!input.sessionIsActive) {
    throw new PracticeBlockLifecycleError(
      "session_not_active",
      `Cannot create PracticeBlock under PracticeSession "${input.practiceSessionId}": that session is not active`
    );
  }

  return {
    id: input.id,
    practiceSessionId: input.practiceSessionId,
    sequenceNumber: input.sequenceNumber,
    status: "active",
    startedAt: input.now,
    endedAt: null,
    targetQuestionCount: input.targetQuestionCount ?? null,
    blockTimeBudgetSeconds: input.blockTimeBudgetSeconds ?? null
  };
}

function applyTermination(
  block: PracticeBlockState | null | undefined,
  outcome: "completed" | "abandoned",
  input: { now: string }
): PracticeBlockState {
  assertExists(block);
  assertActive(block, outcome);

  const nowMs = parseTimestampMs(input.now, "now");
  const startedMs = parseTimestampMs(block.startedAt, "block.startedAt");
  if (nowMs < startedMs) {
    throw new PracticeBlockLifecycleError(
      "impossible_timestamp",
      `"now" (${input.now}) is before this block's startedAt (${block.startedAt})`
    );
  }

  return { ...block, status: outcome, endedAt: input.now };
}

/**
 * completePracticeBlock() — the ONLY function that can produce a `status:
 * "completed"` block. Reaching `targetQuestionCount` never triggers this
 * automatically (docs/DECISIONS.md D-060) — a caller (or, eventually, a
 * student action relayed through an orchestration layer) must call this
 * explicitly. "Terminal session with an active block" is structurally
 * unreachable as a CONSEQUENCE of `@ipmat/practice-session`'s own
 * `hasActiveBlock` completion check, not something re-verified here — this
 * package has no session reference to check against by design.
 */
export function completePracticeBlock(block: PracticeBlockState | null | undefined, input: { now: string }): PracticeBlockState {
  return applyTermination(block, "completed", input);
}

/** abandonPracticeBlock() — the ONLY function that can produce a `status: "abandoned"` block. */
export function abandonPracticeBlock(block: PracticeBlockState | null | undefined, input: { now: string }): PracticeBlockState {
  return applyTermination(block, "abandoned", input);
}
