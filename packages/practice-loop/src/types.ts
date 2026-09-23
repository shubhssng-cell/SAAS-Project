import type { AttemptOwnershipClaim, AttemptQuestionContext, AttemptState, RecordableAttemptEventInput } from "@ipmat/attempt";
import type { CanonicalQuestion, PracticeBlockOwnershipRecord, PracticeBlockReader, QuestionReader } from "@ipmat/db";

export type {
  AttemptOwnershipClaim,
  AttemptQuestionContext,
  AttemptState,
  CanonicalQuestion,
  PracticeBlockOwnershipRecord,
  PracticeBlockReader,
  QuestionReader,
  RecordableAttemptEventInput
};

/**
 * Phase 4B-2 (foundation only): the application-facing practice-loop
 * orchestration layer. This package is deliberately NOT under
 * `packages/domain/*` — unlike `@ipmat/attempt` (pure, database-free), it
 * genuinely depends on persistence PORTS (`AttemptRepository`,
 * `QuestionReader`, both re-exported from `@ipmat/db`) to do its job, the
 * same reason `@ipmat/db` itself isn't a domain package either
 * (docs/ARCHITECTURE.md §4's `/jobs` category is the same kind of
 * "orchestration wires domain + infra together" layer, one level above
 * pure domain logic).
 *
 * This is explicitly the FOUNDATION only — no UI, no HTTP/API routes, no
 * question selection/generation/publication, no adaptive selection. It
 * exists so a future HTTP/API layer has one clean, already-tested
 * orchestration surface to call into, instead of re-deriving "load ->
 * @ipmat/attempt transform -> persist" itself at the route-handler level.
 *
 * Deliberately NOT exported from here: any type that would let a caller
 * SUPPLY question content (answer key, options, publication state).
 * `PracticeLoopService`'s client-facing input surface is limited to
 * `questionId` and observable student actions — the canonical
 * `CanonicalQuestion` is loaded server-side via the injected
 * `QuestionReader`, never accepted as a parameter (docs/DECISIONS.md
 * D-048; this closes an authority gap an earlier revision of this package
 * had, where an untrusted caller could supply an arbitrary `correctAnswer`
 * or claim `validationState: "published"` on any question).
 */

/** Returned by `submitAttempt()` — the finalized `AttemptState` plus the question's own `correctAnswer`, so a caller can render feedback without needing to have kept a separate copy of the question around. `isCorrect`/`chosenAnswer` on `attempt`, and `correctAnswer` here, are always the CANONICAL values loaded server-side; nothing here is caller-suppliable. */
export interface PracticeSubmitResult {
  attempt: AttemptState;
  correctAnswer: string;
}

export const PRACTICE_LOOP_ERROR_CODES = [
  "question_not_published",
  "question_not_found",
  "practice_block_not_found",
  "practice_block_not_active",
  "practice_block_ownership_mismatch"
] as const;
export type PracticeLoopErrorCode = (typeof PRACTICE_LOOP_ERROR_CODES)[number];

/** Mirrors `@ipmat/attempt`'s `AttemptLifecycleError`/`@ipmat/db`'s `PersistenceError` — a typed, fail-closed error for THIS layer's own business rules (no such question; question not published; docs/DECISIONS.md D-060's fast PracticeBlock ownership pre-check: no such block, the block isn't `active`, or the block's real `enrollmentId`/`studentId` don't match the request's own claim). This pre-check is explicitly NOT the last line of defense — `AttemptRepository.save()` re-derives the SAME ownership chain from scratch, inside its own transaction, and is the layer that actually decides (docs/DECISIONS.md D-060 security-fix addendum). Every other failure (attempt not found, ownership mismatch inside the domain/persistence layers, malformed event, missing reference) is left to propagate as the domain/persistence layer's OWN error type, never re-wrapped, so this layer never duplicates error semantics those layers already own. */
export class PracticeLoopError extends Error {
  readonly code: PracticeLoopErrorCode;

  constructor(code: PracticeLoopErrorCode, message: string) {
    super(message);
    this.name = "PracticeLoopError";
    this.code = code;
  }
}
