import { AttemptLifecycleError, type AttemptOwnershipClaim } from "@ipmat/attempt";
import { assertEnrollmentOwnership } from "@ipmat/training-recommendation";
import { toPracticeApiError } from "./errors.js";
import { toAttemptResultView, toPendingAutopsyView, toRecommendationView, toStudentQuestionView } from "./presentation.js";
import type {
  AttemptResultView,
  PendingAutopsyView,
  PracticeApiDependencies,
  RecommendationView,
  StartAttemptResult,
  StudentRequestClaim
} from "./types.js";
import { PracticeApiError } from "./types.js";
import { assertNonEmptyString, assertValidClaim } from "./validation.js";

/**
 * The application/API boundary's one entry point (docs/project-memory/
 * 70_API_AND_APPLICATION_LAYER.md). Every method: (1) validates its own
 * input shape, (2) verifies ownership where the service it calls does not
 * already do so, (3) delegates to an EXISTING application/domain service
 * for every actual decision, (4) maps the outcome to a student-safe view.
 * This class contains no selection/ranking/grading logic of its own — see
 * `docs/DECISIONS.md` for the unit that added it.
 *
 * `now` parameters throughout are a TESTING SEAM ONLY (the same "caller
 * supplies now, nothing reads the system clock internally" convention
 * `@ipmat/attempt`/`@ipmat/practice-loop` already use) — defaults to the
 * real server clock when omitted. A real HTTP transport must NEVER read
 * `now` from a client request; accepting a client-supplied `now` would let
 * a caller manipulate `timeSpentSeconds` (computed as `finalizedAt -
 * startedAt`) — exactly the "duration as a trusted fact" this boundary
 * must never allow (C).
 */
export class PracticeApiService {
  constructor(private readonly deps: PracticeApiDependencies) {}

  /** Item 1 — the student's next training recommendation. */
  async getNextRecommendation(claim: StudentRequestClaim): Promise<RecommendationView> {
    assertValidClaim(claim);
    try {
      const result = await this.deps.trainingRecommendationService.recommendNextTrainingAction(claim);
      return toRecommendationView(result);
    } catch (error) {
      throw toPracticeApiError(error);
    }
  }

  /**
   * Item 2 — starts the recommended question as an authoritative attempt.
   * Verifies enrollment ownership FIRST, via the SAME check
   * `@ipmat/training-recommendation` uses (`assertEnrollmentOwnership()`,
   * reused directly, never reimplemented) — `PracticeLoopService.startAttempt()`
   * itself does not verify that `enrollmentId` belongs to `studentId` for
   * ordinary (non-block) practice, so this boundary is where that check
   * belongs for a real, untrusted caller (D).
   */
  async startAttempt(claim: StudentRequestClaim, input: { questionId: string; now?: string }): Promise<StartAttemptResult> {
    assertValidClaim(claim);
    assertNonEmptyString(input.questionId, "questionId");
    const now = input.now ?? new Date().toISOString();

    try {
      assertEnrollmentOwnership(await this.deps.enrollmentReader.findById(claim.enrollmentId), claim);

      const attempt = await this.deps.practiceLoopService.startAttempt({
        studentId: claim.studentId,
        questionId: input.questionId,
        enrollmentId: claim.enrollmentId,
        now
      });

      const content = await this.deps.questionContentReader.findPublishedById(input.questionId);
      if (!content) {
        // practiceLoopService.startAttempt() already verified this exact
        // question is published, via a DIFFERENT reader (QuestionReader,
        // D-048's answer-key-bearing one). A genuine disagreement between
        // the two readers is a real infrastructure inconsistency -- never
        // silently papered over with fabricated content.
        throw new PracticeApiError("infrastructure_failure", "This question could not be loaded right now. Please try again.", 500);
      }

      return { attemptId: attempt.id, question: toStudentQuestionView(content) };
    } catch (error) {
      if (error instanceof PracticeApiError) throw error;
      throw toPracticeApiError(error);
    }
  }

  /**
   * Item 3 — submits the attempt. Records the observable `answer_selected`
   * event, then finalizes via `PracticeLoopService.submitAttempt()` —
   * `isCorrect`/`chosenAnswer`/`timeSpentSeconds` are computed ENTIRELY by
   * `@ipmat/attempt` from the event log and the server-resolved canonical
   * question; nothing here (or in the request) supplies any of the three
   * directly (C, D-034).
   */
  async submitAttempt(claim: StudentRequestClaim, input: { attemptId: string; questionId: string; chosenAnswer: string; now?: string }): Promise<AttemptResultView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.attemptId, "attemptId");
    assertNonEmptyString(input.questionId, "questionId");
    assertNonEmptyString(input.chosenAnswer, "chosenAnswer");
    const now = input.now ?? new Date().toISOString();
    const ownershipClaim: AttemptOwnershipClaim = { studentId: claim.studentId, questionId: input.questionId };

    try {
      await this.deps.practiceLoopService.recordEvent({
        attemptId: input.attemptId,
        claim: ownershipClaim,
        event: { type: "answer_selected", occurredAt: now, selectedAnswer: input.chosenAnswer }
      });
      const { attempt, correctAnswer } = await this.deps.practiceLoopService.submitAttempt({ attemptId: input.attemptId, claim: ownershipClaim, now });
      const content = await this.deps.questionContentReader.findPublishedById(input.questionId);
      return toAttemptResultView(attempt, correctAnswer, content?.expectedTimeSeconds ?? null);
    } catch (error) {
      throw toPracticeApiError(error);
    }
  }

  /** Item 4 — skips the attempt, where the existing domain contract allows skipping (an in-progress attempt only; `@ipmat/attempt`'s own `skipAttempt()` enforces this). */
  async skipAttempt(claim: StudentRequestClaim, input: { attemptId: string; questionId: string; now?: string }): Promise<AttemptResultView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.attemptId, "attemptId");
    assertNonEmptyString(input.questionId, "questionId");
    const now = input.now ?? new Date().toISOString();
    const ownershipClaim: AttemptOwnershipClaim = { studentId: claim.studentId, questionId: input.questionId };

    try {
      const attempt = await this.deps.practiceLoopService.skipAttempt({ attemptId: input.attemptId, claim: ownershipClaim, now });
      return toAttemptResultView(attempt, null, null);
    } catch (error) {
      throw toPracticeApiError(error);
    }
  }

  /**
   * Item 5 — the student-safe result for an already-finalized attempt
   * (e.g. after a page reload). Re-verifies ownership directly against the
   * loaded attempt's own `studentId` (`PracticeLoopService.getAttempt()`
   * has no ownership scoping of its own — it is a narrow id lookup, by
   * design, the same as `AttemptRepository.findById()`), and refuses
   * (`invalid_state`) for an attempt that has not been finalized yet.
   * `correctAnswer` is resolved server-side via `QuestionReader` ONLY for
   * a `submitted` result — never for `skipped`/`abandoned`.
   */
  async getAttemptResult(claim: StudentRequestClaim, input: { attemptId: string }): Promise<AttemptResultView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.attemptId, "attemptId");

    try {
      const attempt = await this.deps.practiceLoopService.getAttempt(input.attemptId);
      if (!attempt) {
        throw new AttemptLifecycleError("attempt_not_found", `No attempt found with id "${input.attemptId}".`);
      }
      if (attempt.studentId !== claim.studentId) {
        throw new AttemptLifecycleError("ownership_mismatch", "This attempt does not belong to the requesting student.");
      }
      if (attempt.status === "in_progress") {
        throw new PracticeApiError("invalid_state", "This attempt has not been finalized yet.", 409);
      }

      let correctAnswer: string | null = null;
      let expectedTimeSeconds: number | null = null;
      if (attempt.status === "submitted") {
        const canonical = await this.deps.questionReader.findById(attempt.questionId);
        correctAnswer = canonical?.correctAnswer ?? null;
        expectedTimeSeconds = canonical?.expectedTimeSeconds ?? null;
      } else {
        const content = await this.deps.questionContentReader.findPublishedById(attempt.questionId);
        expectedTimeSeconds = content?.expectedTimeSeconds ?? null;
      }

      return toAttemptResultView(attempt, correctAnswer, expectedTimeSeconds);
    } catch (error) {
      if (error instanceof PracticeApiError) throw error;
      throw toPracticeApiError(error);
    }
  }

  /**
   * Item 6 — the information needed for the autopsy/confirmation step,
   * exactly as far as the EXISTING architecture already supports it
   * end-to-end without an AI call (generating a fresh hypothesis is
   * explicitly out of scope this unit — see this unit's own notes).
   * Returns `pending: false` (a valid, ordinary state, never an error)
   * whenever no hypothesis is currently `awaiting_confirmation` for this
   * attempt — which, honestly, is every attempt today, since nothing in
   * this unit writes a fresh `Autopsy` row (that write path needs the 5th
   * `@ipmat/ai` task, deliberately not activated here). This method still
   * exercises the real, persisted read path, the same "built and tested,
   * nothing populates it yet" pattern this codebase already uses
   * elsewhere (e.g. Pressure Training before real block data existed).
   */
  async getAutopsyForConfirmation(claim: StudentRequestClaim, input: { attemptId: string }): Promise<PendingAutopsyView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.attemptId, "attemptId");

    try {
      const attempt = await this.deps.practiceLoopService.getAttempt(input.attemptId);
      if (!attempt) {
        throw new AttemptLifecycleError("attempt_not_found", `No attempt found with id "${input.attemptId}".`);
      }
      if (attempt.studentId !== claim.studentId) {
        throw new AttemptLifecycleError("ownership_mismatch", "This attempt does not belong to the requesting student.");
      }

      const stored = await this.deps.autopsyReader.findByAttemptId(input.attemptId);
      return toPendingAutopsyView(input.attemptId, stored);
    } catch (error) {
      throw toPracticeApiError(error);
    }
  }
}
