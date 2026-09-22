/**
 * Restated from the Prisma schema (`AttemptStatus`, `AttemptEventType` in
 * packages/db/prisma/schema.prisma) rather than imported from
 * `@prisma/client` — domain packages must not import a concrete
 * persistence client (docs/ARCHITECTURE.md §6). This is also, independently,
 * a deliberate trust boundary: what a finalized Attempt's state machine can
 * represent is a fixed contract this package owns, the same reasoning
 * `@ipmat/ai` uses for its own restated vocabularies (docs/DECISIONS.md
 * D-017).
 */

/**
 * The attempt lifecycle (docs/DECISIONS.md D-034). `in_progress` is the
 * only non-terminal state; `submitted`/`skipped`/`abandoned` are all
 * equally final — nothing in this package ever transitions a finalized
 * attempt back to `in_progress` or from one terminal state to another.
 * `abandoned` is reserved for a future session/timeout close-out trigger
 * (Phase 4A defines the state and `finalizeAttempt()`'s support for it,
 * not the trigger itself — see docs/PHASE_4A_REVIEW.md).
 */
export type AttemptStatus = "in_progress" | "submitted" | "skipped" | "abandoned";

/**
 * The full vocabulary stored on `AttemptEvent.event_type`, including two
 * event types (`question_skipped`, `answer_submitted`) that only the
 * lifecycle functions in this package ever construct — never accepted as
 * caller input to `recordAttemptEvent()` (see `RecordableAttemptEventInput`
 * below). `working_input_changed`/`reasoning_submitted` are Phase 1 schema
 * members reserved for Phase 5 (docs/DECISIONS.md D-011) — this package
 * does not read or write them.
 *
 * Every member names an OBSERVABLE ACTION the student took, never an
 * inferred mental or emotional state — see docs/DECISIONS.md D-034 and
 * D-005 (no confidence score, ever).
 */
export type AttemptEventType =
  | "question_opened"
  | "answer_selected"
  | "answer_changed"
  | "hint_opened"
  | "solution_opened"
  | "question_skipped"
  | "working_input_changed"
  | "reasoning_submitted"
  | "answer_submitted";

/**
 * What `recordAttemptEvent()` accepts from a caller. Deliberately excludes
 * `question_skipped` and `answer_submitted` at the TYPE level — those two
 * event types are only ever appended by `skipAttempt()`/`submitAttempt()`
 * internally, as part of the same operation that transitions the attempt's
 * status. A caller cannot fire a "skip" or "submit" event through the
 * generic recording path while bypassing the actual state transition (and
 * its validation) that's supposed to accompany it. Also excludes
 * `working_input_changed`/`reasoning_submitted` (Phase 5, see above).
 */
export type RecordableAttemptEventInput =
  | { type: "question_opened"; occurredAt: string }
  | { type: "answer_selected"; occurredAt: string; selectedAnswer: string }
  | { type: "answer_changed"; occurredAt: string; selectedAnswer: string }
  | { type: "hint_opened"; occurredAt: string; hintIndex?: number }
  | { type: "solution_opened"; occurredAt: string };

/** The stored shape of one event on an attempt's timeline — covers the full `AttemptEventType` vocabulary, since finalization appends `question_skipped`/`answer_submitted` here even though callers cannot pass those to `recordAttemptEvent()` directly. */
export interface AttemptEventRecord {
  type: AttemptEventType;
  occurredAt: string;
  payload: Record<string, unknown> | null;
}

/**
 * The pure, in-memory representation of an attempt and its full event
 * timeline. This package has no Prisma/database dependency (docs/
 * ARCHITECTURE.md §6) — a future persistence adapter is responsible for
 * loading an `AttemptState` from `attempts`/`attempt_events` rows before
 * calling into this package, and for persisting the returned, updated
 * state afterward. Every lifecycle function here is pure: it takes an
 * `AttemptState` and returns a NEW one, never mutating its input (the same
 * discipline `applyCatchUp` uses for `PrepPhaseTemplate` — docs/
 * DECISIONS.md D-009).
 */
export interface AttemptState {
  id: string;
  studentId: string;
  questionId: string;
  enrollmentId: string;
  retryOfAttemptId: string | null;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  finalizedAt: string | null;
  /** The AUTHORITATIVE final answer — set only by `submitAttempt()`, derived from the event log, never accepted as a direct parameter from a caller (see docs/DECISIONS.md D-034). Null for `in_progress`, `skipped`, and `abandoned` attempts. */
  chosenAnswer: string | null;
  /** Computed by `submitAttempt()` from the authoritative `AttemptQuestionContext.correctAnswer` — never settable directly. Null unless `status === "submitted"`. */
  isCorrect: boolean | null;
  hintsUsed: number;
  solutionOpenedAt: string | null;
  /** `finalizedAt - startedAt` in whole seconds, computed by the finalization step — never accepted from a caller as a duration. Null while `in_progress`. */
  timeSpentSeconds: number | null;
  events: AttemptEventRecord[];
}

/**
 * The authoritative, trusted question data a caller must supply for
 * grading and evidence-building — this package never fetches it itself
 * (no Prisma dependency). Mirrors the fields of the real `Question` model
 * this package actually needs; a caller backed by Prisma would build this
 * from a loaded `Question` row.
 */
export interface AttemptQuestionContext {
  questionId: string;
  conceptId: string;
  answerFormat: "multiple_choice" | "numeric_entry";
  /** Non-null only for `multiple_choice`, matching `Question.options` (Json array) / `QuestionCandidateAiOutput.options`. */
  options: string[] | null;
  correctAnswer: string;
  expectedTimeSeconds: number | null;
}

export const ATTEMPT_LIFECYCLE_ERROR_CODES = [
  "attempt_not_found",
  "already_finalized",
  "ownership_mismatch",
  "malformed_event_payload",
  "impossible_timestamp",
  "missing_answer",
  "invalid_answer_option"
] as const;

export type AttemptLifecycleErrorCode = (typeof ATTEMPT_LIFECYCLE_ERROR_CODES)[number];

/**
 * Every invalid-transition / malformed-input case in this package fails
 * closed by throwing this, never by silently ignoring the problem or
 * returning a partially-updated state (Phase 4A §7 — "fail closed"). This
 * mirrors how `validateGenerationLimits()` and `AiGenerationError` are used
 * elsewhere in this codebase for precondition violations, as distinct from
 * `@ipmat/validation`'s `ValidationResult` pattern (which is for
 * diagnostic, non-fatal content-quality reporting, not applicable here —
 * an attempt lifecycle violation is a programmer/client-trust error, not a
 * quality signal to report alongside other passing checks).
 */
export class AttemptLifecycleError extends Error {
  readonly code: AttemptLifecycleErrorCode;

  constructor(code: AttemptLifecycleErrorCode, message: string) {
    super(message);
    this.name = "AttemptLifecycleError";
    this.code = code;
  }
}
