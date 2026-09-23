import {
  AttemptLifecycleError,
  type AttemptEventRecord,
  type AttemptQuestionContext,
  type AttemptState,
  type RecordableAttemptEventInput
} from "./types.js";

/** The `{studentId, questionId}` the caller CLAIMS to be acting as/on — checked against the attempt's own record on every operation (Phase 4A §7 — "inconsistent student/question ownership"). */
export interface AttemptOwnershipClaim {
  studentId: string;
  questionId: string;
}

function parseTimestampMs(value: string, whatFor: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new AttemptLifecycleError("impossible_timestamp", `${whatFor} ("${value}") is not a parseable timestamp`);
  }
  return ms;
}

function lastEventTimestampMs(attempt: AttemptState): number | null {
  if (attempt.events.length === 0) return null;
  const last = attempt.events[attempt.events.length - 1];
  return last ? parseTimestampMs(last.occurredAt, "the last recorded event's occurredAt") : null;
}

/**
 * A new timestamp (an event's `occurredAt`, or a finalization's `now`)
 * must never precede the attempt's `startedAt` or any timestamp already
 * recorded — timestamps are meant to reconstruct a real, monotonic
 * timeline, not to be trusted as arbitrary client input (Phase 4A §5/§7).
 */
function assertTimestampIsCoherent(attempt: AttemptState, candidate: string, whatFor: string): number {
  const candidateMs = parseTimestampMs(candidate, whatFor);
  const startedMs = parseTimestampMs(attempt.startedAt, "attempt.startedAt");
  if (candidateMs < startedMs) {
    throw new AttemptLifecycleError(
      "impossible_timestamp",
      `${whatFor} (${candidate}) is before the attempt's startedAt (${attempt.startedAt})`
    );
  }
  const lastMs = lastEventTimestampMs(attempt);
  if (lastMs !== null && candidateMs < lastMs) {
    throw new AttemptLifecycleError(
      "impossible_timestamp",
      `${whatFor} (${candidate}) is before the most recently recorded event (${attempt.events[attempt.events.length - 1]?.occurredAt})`
    );
  }
  return candidateMs;
}

function assertOwnership(attempt: AttemptState, claim: AttemptOwnershipClaim): void {
  if (attempt.studentId !== claim.studentId || attempt.questionId !== claim.questionId) {
    throw new AttemptLifecycleError(
      "ownership_mismatch",
      `Caller claims studentId="${claim.studentId}" questionId="${claim.questionId}", but this attempt belongs to studentId="${attempt.studentId}" questionId="${attempt.questionId}"`
    );
  }
}

function assertExists(attempt: AttemptState | null | undefined): asserts attempt is AttemptState {
  if (!attempt) {
    throw new AttemptLifecycleError("attempt_not_found", "Cannot operate on a nonexistent attempt");
  }
}

function assertInProgress(attempt: AttemptState, action: string): void {
  if (attempt.status !== "in_progress") {
    throw new AttemptLifecycleError(
      "already_finalized",
      `Cannot ${action}: attempt is already "${attempt.status}", not "in_progress"`
    );
  }
}

function validateEventPayload(event: RecordableAttemptEventInput): Record<string, unknown> | null {
  switch (event.type) {
    case "answer_selected":
    case "answer_changed": {
      if (typeof event.selectedAnswer !== "string" || event.selectedAnswer.trim().length === 0) {
        throw new AttemptLifecycleError(
          "malformed_event_payload",
          `"${event.type}" requires a non-empty selectedAnswer string`
        );
      }
      return { selectedAnswer: event.selectedAnswer };
    }
    case "hint_opened": {
      if (event.hintIndex !== undefined && (!Number.isInteger(event.hintIndex) || event.hintIndex < 0)) {
        throw new AttemptLifecycleError("malformed_event_payload", `"hint_opened".hintIndex must be a non-negative integer if provided`);
      }
      return event.hintIndex !== undefined ? { hintIndex: event.hintIndex } : null;
    }
    case "question_opened":
    case "solution_opened":
      return null;
  }
}

/** startAttempt() — the only way an `in_progress` AttemptState comes into existence (Phase 4A §3). */
export function startAttempt(input: {
  id: string;
  studentId: string;
  questionId: string;
  enrollmentId: string;
  retryOfAttemptId?: string | null;
  now: string;
}): AttemptState {
  parseTimestampMs(input.now, "now");
  return {
    id: input.id,
    studentId: input.studentId,
    questionId: input.questionId,
    enrollmentId: input.enrollmentId,
    retryOfAttemptId: input.retryOfAttemptId ?? null,
    status: "in_progress",
    startedAt: input.now,
    submittedAt: null,
    finalizedAt: null,
    chosenAnswer: null,
    isCorrect: null,
    hintsUsed: 0,
    solutionOpenedAt: null,
    timeSpentSeconds: null,
    events: [],
    blockMembership: null
  };
}

/**
 * recordAttemptEvent() — appends one observable-behavior event. Fails
 * closed on: a finalized attempt (`already_finalized`), an
 * ownership-claim mismatch (`ownership_mismatch`), a malformed payload
 * (`malformed_event_payload`), or a timestamp that precedes `startedAt` or
 * the previous event (`impossible_timestamp`). Never infers anything about
 * the event beyond what's explicitly given — no thought/emotion/confidence
 * field exists anywhere in `RecordableAttemptEventInput` (Phase 4A §2).
 */
export function recordAttemptEvent(
  attempt: AttemptState | null | undefined,
  event: RecordableAttemptEventInput,
  claim: AttemptOwnershipClaim
): AttemptState {
  assertExists(attempt);
  assertOwnership(attempt, claim);
  assertInProgress(attempt, "record an event on");
  assertTimestampIsCoherent(attempt, event.occurredAt, `"${event.type}".occurredAt`);
  const payload = validateEventPayload(event);

  const record: AttemptEventRecord = { type: event.type, occurredAt: event.occurredAt, payload };
  const events = [...attempt.events, record];

  return {
    ...attempt,
    events,
    hintsUsed: event.type === "hint_opened" ? attempt.hintsUsed + 1 : attempt.hintsUsed,
    solutionOpenedAt: event.type === "solution_opened" && attempt.solutionOpenedAt === null ? event.occurredAt : attempt.solutionOpenedAt
  };
}

/**
 * The single place every terminal transition goes through — this is what
 * makes "cannot finalize twice" and coherent time-taken computation
 * uniform regardless of outcome (Phase 4A §3). Not exported: the public
 * surface for setting `chosenAnswer`/`isCorrect` is `submitAttempt()`
 * alone, which derives them from the event log and the authoritative
 * question — there is no public code path that accepts a caller-supplied
 * correctness or answer value for finalization (Phase 4A §3, "do not trust
 * client-calculated correctness").
 */
function applyFinalization(
  attempt: AttemptState,
  outcome: { status: "submitted" | "skipped" | "abandoned"; now: string; chosenAnswer: string | null; isCorrect: boolean | null }
): AttemptState {
  assertInProgress(attempt, "finalize");
  const finalizedMs = assertTimestampIsCoherent(attempt, outcome.now, "finalization now");
  const startedMs = parseTimestampMs(attempt.startedAt, "attempt.startedAt");
  const timeSpentSeconds = Math.round((finalizedMs - startedMs) / 1000);

  return {
    ...attempt,
    status: outcome.status,
    finalizedAt: outcome.now,
    submittedAt: outcome.status === "submitted" ? outcome.now : null,
    chosenAnswer: outcome.chosenAnswer,
    isCorrect: outcome.isCorrect,
    timeSpentSeconds
  };
}

/**
 * submitAttempt() — the ONLY function that can produce a `status:
 * "submitted"` attempt. `chosenAnswer` is derived from the LAST
 * `answer_selected`/`answer_changed` event already recorded on the
 * attempt — never from a parameter to this function, so there is no
 * client-supplied answer or correctness value this function could even
 * accept, let alone trust (Phase 4A §3, §4). Fails closed with
 * `missing_answer` if no answer was ever recorded, and with
 * `invalid_answer_option` if the derived answer isn't one of the
 * question's real options (multiple_choice only).
 */
export function submitAttempt(
  attempt: AttemptState | null | undefined,
  claim: AttemptOwnershipClaim,
  question: AttemptQuestionContext,
  input: { now: string }
): AttemptState {
  assertExists(attempt);
  assertOwnership(attempt, claim);
  if (question.questionId !== attempt.questionId) {
    throw new AttemptLifecycleError(
      "ownership_mismatch",
      `Supplied question context is for questionId="${question.questionId}", but this attempt is for questionId="${attempt.questionId}"`
    );
  }
  assertInProgress(attempt, "submit");

  const finalAnswer = deriveFinalAnswerFromEvents(attempt);
  if (finalAnswer === null) {
    throw new AttemptLifecycleError("missing_answer", "Cannot submit: no answer_selected/answer_changed event was ever recorded");
  }
  if (question.answerFormat === "multiple_choice") {
    const options = question.options ?? [];
    if (!options.some((option) => option.trim() === finalAnswer.trim())) {
      throw new AttemptLifecycleError(
        "invalid_answer_option",
        `Derived answer "${finalAnswer}" is not one of this question's options`
      );
    }
  }

  assertTimestampIsCoherent(attempt, input.now, "submission now");
  const withSubmitEvent = appendInternalEvent(attempt, { type: "answer_submitted", occurredAt: input.now, payload: { selectedAnswer: finalAnswer } });

  const isCorrect = finalAnswer.trim() === question.correctAnswer.trim();
  return applyFinalization(withSubmitEvent, { status: "submitted", now: input.now, chosenAnswer: finalAnswer, isCorrect });
}

/**
 * skipAttempt() — the ONLY function that can produce a `status: "skipped"`
 * attempt. `chosenAnswer`/`isCorrect` are always null — a skip is neither
 * a correct nor an incorrect answer, it is the absence of one, and is kept
 * distinguishable from both a submitted wrong answer and an abandoned
 * attempt by `status` alone (Phase 4A §6). Skip is a terminal transition:
 * once skipped, `submitAttempt()` on the same (returned) state throws
 * `already_finalized` — this model does not allow answering after a skip.
 */
export function skipAttempt(attempt: AttemptState | null | undefined, claim: AttemptOwnershipClaim, input: { now: string }): AttemptState {
  assertExists(attempt);
  assertOwnership(attempt, claim);
  assertInProgress(attempt, "skip");
  assertTimestampIsCoherent(attempt, input.now, "skip now");
  const withSkipEvent = appendInternalEvent(attempt, { type: "question_skipped", occurredAt: input.now, payload: null });
  return applyFinalization(withSkipEvent, { status: "skipped", now: input.now, chosenAnswer: null, isCorrect: null });
}

/**
 * finalizeAttempt() — the direct, general-purpose terminal transition,
 * currently supporting only `"abandoned"` (Phase 4A §3/§9): reserved for a
 * future session/timeout close-out trigger that decides an `in_progress`
 * attempt should be closed without an explicit student submit or skip.
 * Like the outcome itself, `chosenAnswer`/`isCorrect` are always null —
 * there is no answer to grade for an attempt nobody finished. This
 * function is not called by `submitAttempt()`/`skipAttempt()` (they use
 * the shared internal `applyFinalization()` directly, so a caller can
 * never reach the "submitted"/"skipped" outcomes through this function and
 * smuggle in an unvalidated answer).
 */
export function finalizeAttempt(
  attempt: AttemptState | null | undefined,
  claim: AttemptOwnershipClaim,
  outcome: "abandoned",
  input: { now: string }
): AttemptState {
  assertExists(attempt);
  assertOwnership(attempt, claim);
  return applyFinalization(attempt, { status: outcome, now: input.now, chosenAnswer: null, isCorrect: null });
}

function appendInternalEvent(attempt: AttemptState, record: AttemptEventRecord): AttemptState {
  return { ...attempt, events: [...attempt.events, record] };
}

/** The LAST `answer_selected`/`answer_changed` event's `selectedAnswer`, or null if none was ever recorded. Exported for reuse by `answerHistory.ts`. */
export function deriveFinalAnswerFromEvents(attempt: AttemptState): string | null {
  for (let i = attempt.events.length - 1; i >= 0; i--) {
    const event = attempt.events[i];
    if (event && (event.type === "answer_selected" || event.type === "answer_changed")) {
      const selectedAnswer = event.payload?.["selectedAnswer"];
      return typeof selectedAnswer === "string" ? selectedAnswer : null;
    }
  }
  return null;
}
