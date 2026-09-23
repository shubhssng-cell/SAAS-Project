import { PracticeSessionLifecycleError, type PracticeSessionState } from "./types.js";

function parseTimestampMs(value: string, whatFor: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new PracticeSessionLifecycleError("impossible_timestamp", `${whatFor} ("${value}") is not a parseable timestamp`);
  }
  return ms;
}

function assertExists(session: PracticeSessionState | null | undefined): asserts session is PracticeSessionState {
  if (!session) {
    throw new PracticeSessionLifecycleError("session_not_found", "Cannot operate on a nonexistent PracticeSession");
  }
}

function assertActive(session: PracticeSessionState, action: string): void {
  if (session.status !== "active") {
    throw new PracticeSessionLifecycleError(
      "already_finalized",
      `Cannot ${action}: PracticeSession "${session.id}" is already "${session.status}", not "active"`
    );
  }
}

function assertValidTimeBudget(seconds: number | null | undefined): void {
  if (seconds === undefined || seconds === null) return;
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new PracticeSessionLifecycleError("invalid_time_budget", `sessionTimeBudgetSeconds must be a positive integer if provided, got ${String(seconds)}`);
  }
}

/** createPracticeSession() — the only way an `active` PracticeSessionState comes into existence. */
export function createPracticeSession(input: {
  id: string;
  enrollmentId: string;
  now: string;
  sessionTimeBudgetSeconds?: number | null;
}): PracticeSessionState {
  parseTimestampMs(input.now, "now");
  assertValidTimeBudget(input.sessionTimeBudgetSeconds);

  return {
    id: input.id,
    enrollmentId: input.enrollmentId,
    status: "active",
    startedAt: input.now,
    endedAt: null,
    sessionTimeBudgetSeconds: input.sessionTimeBudgetSeconds ?? null
  };
}

/**
 * The single place both terminal transitions go through. `hasActiveBlock`
 * is a plain boolean the CALLER computes (typically a repository, inside
 * the same transaction as the status write — see docs/DECISIONS.md D-060)
 * — this package has no way to ask `@ipmat/practice-block` itself, by
 * design (no cross-package dependency). Completion/abandonment is ALWAYS
 * an explicit call; nothing in this package auto-terminates a session on
 * budget expiry or any other implicit condition.
 */
function applyTermination(
  session: PracticeSessionState | null | undefined,
  outcome: "completed" | "abandoned",
  input: { now: string; hasActiveBlock: boolean }
): PracticeSessionState {
  assertExists(session);
  assertActive(session, outcome);

  if (input.hasActiveBlock) {
    throw new PracticeSessionLifecycleError(
      "has_active_block",
      `Cannot ${outcome} PracticeSession "${session.id}": it has at least one active PracticeBlock — complete or abandon every block first`
    );
  }

  const nowMs = parseTimestampMs(input.now, "now");
  const startedMs = parseTimestampMs(session.startedAt, "session.startedAt");
  if (nowMs < startedMs) {
    throw new PracticeSessionLifecycleError(
      "impossible_timestamp",
      `"now" (${input.now}) is before this session's startedAt (${session.startedAt})`
    );
  }

  return { ...session, status: outcome, endedAt: input.now };
}

/** completePracticeSession() — the ONLY function that can produce a `status: "completed"` session. Refuses (`has_active_block`) unless the caller confirms no child PracticeBlock is still `active`. */
export function completePracticeSession(
  session: PracticeSessionState | null | undefined,
  input: { now: string; hasActiveBlock: boolean }
): PracticeSessionState {
  return applyTermination(session, "completed", input);
}

/** abandonPracticeSession() — the ONLY function that can produce a `status: "abandoned"` session. Same `hasActiveBlock` precondition as completion — abandonment is not a way to bypass it. */
export function abandonPracticeSession(
  session: PracticeSessionState | null | undefined,
  input: { now: string; hasActiveBlock: boolean }
): PracticeSessionState {
  return applyTermination(session, "abandoned", input);
}
