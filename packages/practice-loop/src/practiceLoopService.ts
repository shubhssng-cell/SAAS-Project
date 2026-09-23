import { randomUUID } from "node:crypto";
import { AttemptLifecycleError, finalizeAttempt, recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "@ipmat/attempt";
import type { AttemptRepository, CanonicalQuestion, PracticeBlockReader, QuestionReader } from "@ipmat/db";
import { PracticeLoopError, type AttemptOwnershipClaim, type AttemptQuestionContext, type AttemptState, type PracticeSubmitResult, type RecordableAttemptEventInput } from "./types.js";

/**
 * The Phase 4B-2 foundation: application-facing orchestration that wires
 * `@ipmat/attempt`'s pure lifecycle functions to a persisted
 * `AttemptRepository`, and a `QuestionReader` for canonical question
 * lookups, for a real, reusable (by a future HTTP/API/UI layer) practice
 * flow. This is NOT domain logic (`packages/domain/attempt` already owns
 * that, untouched here) and NOT a second persistence implementation — it
 * depends on both PORT INTERFACES, injected via the constructor, never a
 * concrete Prisma class directly (both constructor parameters' types come
 * from `@ipmat/db`'s exported interfaces, not `@prisma/client`).
 *
 * `QuestionReader` exists specifically so this service NEVER trusts a
 * caller-supplied `correctAnswer`, `validationState`, `options`, or
 * `expectedTimeSeconds` — every one of those is loaded server-side, by id,
 * from the injected reader (docs/DECISIONS.md D-048). The only
 * question-related input any client-facing method accepts is a
 * `questionId` string (`startAttempt`) or nothing at all (`submitAttempt`,
 * which resolves the question via the attempt's OWN already-persisted
 * `questionId`, never something the caller could substitute at submit
 * time).
 *
 * Every method that mutates an attempt follows the SAME pattern: load the
 * current persisted `AttemptState` (if any) via the repository, pass it
 * DIRECTLY into the corresponding `@ipmat/attempt` lifecycle function
 * (never re-implementing or duplicating what that function already
 * validates/computes), then persist whatever it returns. Errors from any
 * layer (`AttemptLifecycleError` from the domain, `PersistenceError` from
 * the repository, `PracticeLoopError` from this layer's own two rules) are
 * never caught or swallowed here — they propagate to the caller exactly as
 * thrown, so a failure can never be silently reported as success.
 */
export class PracticeLoopService {
  constructor(
    private readonly attemptRepository: AttemptRepository,
    private readonly questionReader: QuestionReader,
    /** Optional (docs/DECISIONS.md D-060) — only required by callers that ever pass `practiceBlockId` to `startAttempt()`. Omitted entirely by every pre-D-060 caller, which never touches grouped practice. */
    private readonly practiceBlockReader?: PracticeBlockReader
  ) {}

  /**
   * Starts a new attempt against the question identified by `questionId`.
   * Loads the CANONICAL question server-side via the injected
   * `QuestionReader` — the caller supplies only an id, never
   * answer-bearing or publication-state data. Refuses
   * (`PracticeLoopError("question_not_found")`) if no such question
   * exists, and (`PracticeLoopError("question_not_published")`) unless the
   * CANONICAL `validationState === "published"` — starting a practice
   * attempt against draft/review-required/rejected content would be
   * exactly the "fake practice content" this project's provenance/
   * publication rules exist to prevent, and neither check can be bypassed
   * by a caller claiming otherwise, since neither value is caller-supplied.
   * `id` defaults to a fresh `crypto.randomUUID()` when the caller doesn't
   * supply one (a real caller generally won't; tests supply a
   * deterministic one to assert specific outcomes) — `@ipmat/attempt`'s
   * own `startAttempt()` always requires a caller-supplied id for
   * pure-function testability, and this is the first layer above it where
   * generating a fresh one is genuinely this layer's own responsibility,
   * not something to push onto a not-yet-built HTTP layer.
   *
   * `practiceBlockId` (docs/DECISIONS.md D-060) is optional — omitting it
   * is ordinary, ungrouped practice, entirely unchanged. When supplied,
   * this method performs the FAST, non-transactional ownership pre-check
   * (mirroring the question lookup just above it): the block must exist,
   * be `active`, AND (security-fix addendum) resolve — via the injected
   * `PracticeBlockReader`'s own `PracticeBlock -> PracticeSession ->
   * Enrollment` join — to the SAME `enrollmentId`/`studentId` this request
   * itself claims. This is explicitly NOT the authoritative check —
   * `@ipmat/attempt`'s `startAttempt()` itself stays entirely block-unaware
   * (no parameter here reaches it), and the real ownership re-verification
   * + allocation happens FROM SCRATCH inside `AttemptRepository.save()`'s
   * own transaction, one call below — this pre-check exists only to fail
   * fast with a clear error; it is never the last line of defense.
   */
  async startAttempt(input: {
    studentId: string;
    questionId: string;
    enrollmentId: string;
    retryOfAttemptId?: string | null;
    now: string;
    id?: string;
    practiceBlockId?: string | null;
  }): Promise<AttemptState> {
    const question = await this.questionReader.findById(input.questionId);
    if (!question) {
      throw new PracticeLoopError("question_not_found", `No question found with id "${input.questionId}".`);
    }
    if (question.validationState !== "published") {
      throw new PracticeLoopError(
        "question_not_published",
        `Cannot start a practice attempt on question "${input.questionId}": validationState is "${question.validationState}", not "published".`
      );
    }

    if (input.practiceBlockId) {
      if (!this.practiceBlockReader) {
        throw new Error("PracticeLoopService was constructed without a PracticeBlockReader — cannot start an attempt with a practiceBlockId.");
      }
      const block = await this.practiceBlockReader.findById(input.practiceBlockId);
      if (!block) {
        throw new PracticeLoopError("practice_block_not_found", `No PracticeBlock found with id "${input.practiceBlockId}".`);
      }
      if (block.status !== "active") {
        throw new PracticeLoopError(
          "practice_block_not_active",
          `Cannot start an attempt in PracticeBlock "${input.practiceBlockId}": it is "${block.status}", not "active".`
        );
      }
      if (block.enrollmentId !== input.enrollmentId || block.studentId !== input.studentId) {
        throw new PracticeLoopError(
          "practice_block_ownership_mismatch",
          `Cannot start an attempt in PracticeBlock "${input.practiceBlockId}": it belongs to enrollmentId="${block.enrollmentId}"/studentId="${block.studentId}", not enrollmentId="${input.enrollmentId}"/studentId="${input.studentId}".`
        );
      }
    }

    const attempt = startAttempt({
      id: input.id ?? randomUUID(),
      studentId: input.studentId,
      questionId: input.questionId,
      enrollmentId: input.enrollmentId,
      retryOfAttemptId: input.retryOfAttemptId,
      now: input.now
    });

    return this.attemptRepository.save(attempt, input.practiceBlockId ? { practiceBlockId: input.practiceBlockId } : undefined);
  }

  /**
   * Records one observable event (answer selection/change, hint opened,
   * solution opened) on an in-progress attempt. Throws `@ipmat/attempt`'s
   * own `AttemptLifecycleError("attempt_not_found", ...)` when no such
   * attempt is persisted — never a second, orchestration-level error for
   * the same case, since `recordAttemptEvent()` already accepts (and
   * fails closed on) a `null` attempt.
   */
  async recordEvent(input: { attemptId: string; claim: AttemptOwnershipClaim; event: RecordableAttemptEventInput }): Promise<AttemptState> {
    const existing = await this.attemptRepository.findById(input.attemptId);
    const updated = recordAttemptEvent(existing, input.event, input.claim);
    return this.attemptRepository.save(updated);
  }

  /**
   * Submits an attempt and returns deterministic feedback. The caller
   * supplies only `attemptId`/`claim`/`now` — NEVER question content. The
   * question graded against is resolved server-side via the injected
   * `QuestionReader`, using the ALREADY-PERSISTED `questionId` on the
   * existing attempt row — never anything the caller could substitute at
   * submit time, closing the specific gap where a caller could otherwise
   * submit against one question's identity while supplying a different
   * question's answer data. `isCorrect`/`chosenAnswer` on the returned
   * attempt are computed ENTIRELY by `@ipmat/attempt`'s own
   * `submitAttempt()` from the recorded event log and this canonical
   * `correctAnswer` — there is no parameter anywhere in this call through
   * which a caller could supply either directly (docs/DECISIONS.md D-034,
   * D-048).
   */
  async submitAttempt(input: { attemptId: string; claim: AttemptOwnershipClaim; now: string }): Promise<PracticeSubmitResult> {
    const existing = await this.attemptRepository.findById(input.attemptId);
    if (!existing) {
      throw new AttemptLifecycleError("attempt_not_found", "Cannot operate on a nonexistent attempt");
    }

    const question = await this.questionReader.findById(existing.questionId);
    if (!question) {
      throw new PracticeLoopError(
        "question_not_found",
        `No canonical question found for id "${existing.questionId}" referenced by attempt "${input.attemptId}".`
      );
    }

    const context = toAttemptQuestionContext(question);
    const updated = submitAttempt(existing, input.claim, context, { now: input.now });
    const attempt = await this.attemptRepository.save(updated);
    return { attempt, correctAnswer: question.correctAnswer };
  }

  /** Skips an in-progress attempt — reuses `@ipmat/attempt`'s own `skipAttempt()` directly; `chosenAnswer`/`isCorrect` stay null, matching the domain's own "a skip is neither a correct nor incorrect answer" rule. */
  async skipAttempt(input: { attemptId: string; claim: AttemptOwnershipClaim; now: string }): Promise<AttemptState> {
    const existing = await this.attemptRepository.findById(input.attemptId);
    const updated = skipAttempt(existing, input.claim, { now: input.now });
    return this.attemptRepository.save(updated);
  }

  /** Closes out an attempt the student never explicitly submitted or skipped (e.g. a session timeout) — reuses `@ipmat/attempt`'s `finalizeAttempt("abandoned")` directly; this layer invents no new terminal state. */
  async abandonAttempt(input: { attemptId: string; claim: AttemptOwnershipClaim; now: string }): Promise<AttemptState> {
    const existing = await this.attemptRepository.findById(input.attemptId);
    const updated = finalizeAttempt(existing, input.claim, "abandoned", { now: input.now });
    return this.attemptRepository.save(updated);
  }

  /** Retrieves an existing attempt's current persisted state — e.g. for a page reload mid-attempt. Returns `null`, never throws, when nothing is persisted under this id. */
  async getAttempt(attemptId: string): Promise<AttemptState | null> {
    return this.attemptRepository.findById(attemptId);
  }
}

/**
 * The ONLY place a `CanonicalQuestion` (server-loaded, trusted) is turned
 * into `@ipmat/attempt`'s `AttemptQuestionContext`. `answerFormat` is
 * derived from whether `options` is present, matching how the real
 * `Question.options` column is used elsewhere in this codebase (no
 * separate stored column for it) — see `AttemptQuestionContext`'s own doc
 * in `@ipmat/attempt`.
 */
function toAttemptQuestionContext(question: CanonicalQuestion): AttemptQuestionContext {
  return {
    questionId: question.id,
    conceptId: question.conceptId,
    answerFormat: question.options !== null ? "multiple_choice" : "numeric_entry",
    options: question.options,
    correctAnswer: question.correctAnswer,
    expectedTimeSeconds: question.expectedTimeSeconds
  };
}
