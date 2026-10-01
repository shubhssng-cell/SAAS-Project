import { AttemptLifecycleError, type AttemptOwnershipClaim, type AttemptState } from "@ipmat/attempt";
import { PersistenceError, SerializationFailureError, type StoredDiagnosis } from "@ipmat/db";
import { applyConfirmationResponse, assertEnrollmentOwnership, buildRepairPlan, type AutopsyHypothesis, type ConfirmationResponse, type RepairPlan } from "@ipmat/training-recommendation";
import { toPracticeApiError } from "./errors.js";
import { toAttemptEvidenceView, toAttemptResultView, toPendingAutopsyView, toRecommendationView, toStudentQuestionView } from "./presentation.js";
import type {
  AttemptEvidenceView,
  AttemptResultView,
  HypothesisOfferView,
  HypothesisResponseInput,
  HypothesisResponseView,
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
/** How long an issued confirmation token can be used. The OFFER itself is persisted and never expires; a student who comes back later is simply handed a fresh token for the same stored offer. */
export const HYPOTHESIS_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_CORRECTION_CHARS = 500;
const MAX_TOKEN_CHARS = 20_000;

/**
 * What a token binds (sealed, so the client can neither read nor alter it): the student, the attempt, the stored offer's id AND its exact text.
 * The response is applied only if the stored offer still matches all of it.
 */
interface HypothesisTokenPayload {
  v: 2;
  studentId: string;
  attemptId: string;
  autopsyId: string;
  hypothesisText: string;
  expiresAtMs: number;
}

function isTokenPayload(value: unknown): value is HypothesisTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.v === 2 && typeof v.studentId === "string" && typeof v.attemptId === "string" && typeof v.autopsyId === "string" && typeof v.hypothesisText === "string" && typeof v.expiresAtMs === "number";
}

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/** The student-safe projection of a stored decision. Status is derived from the one authoritative pair (`confirmed`, correction text), exactly as the persistence mapping defines it. */
function toHypothesisResponseView(stored: StoredDiagnosis, alreadyRecorded: boolean): HypothesisResponseView {
  const { autopsy, repairPlan } = stored;
  const status: HypothesisResponseView["status"] = autopsy.confirmed === true ? "confirmed" : autopsy.studentCorrectionText !== null ? "corrected" : "rejected";
  return {
    attemptId: autopsy.attemptId,
    status,
    studentCorrectionText: autopsy.studentCorrectionText,
    hypothesisSummary: autopsy.hypothesisText,
    persisted: true,
    alreadyRecorded,
    diagnosis: { state: status === "confirmed" ? "confirmed" : status === "corrected" ? "awaiting_diagnosis" : "not_confirmed" },
    repairPlan:
      repairPlan !== null && repairPlan.targetConceptName !== null && repairPlan.targetPatternFamilyName !== null
        ? { conceptName: repairPlan.targetConceptName, patternFamilyName: repairPlan.targetPatternFamilyName, status: repairPlan.status }
        : null
  };
}

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

      // Product Phase 2 Unit 5 -- idempotent per (student, enrollment, question): find-then-create runs under a
      // per-key lock so two concurrent starts (a double request, two tabs on one server) cannot both create.
      const attempt = await this.withStartLock(`${claim.studentId}|${claim.enrollmentId}|${input.questionId}`, async () => {
        const resumable = await this.findResumableAttempt(claim, input.questionId);
        if (resumable) return resumable;
        try {
          return await this.deps.practiceLoopService.startAttempt({
            studentId: claim.studentId,
            questionId: input.questionId,
            enrollmentId: claim.enrollmentId,
            now
          });
        } catch (error) {
          // Product Phase 2 Unit 7: the in-process lock above cannot see another API instance. If the database's
          // "one open attempt" guarantee rejected our create (or a concurrent serializable write beat us), the
          // other instance's attempt is the winner -- resume it instead of failing the student.
          if ((error instanceof PersistenceError && error.code === "conflict") || error instanceof SerializationFailureError) {
            const winner = await this.findResumableAttempt(claim, input.questionId);
            if (winner) return winner;
          }
          throw error;
        }
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

      const elapsedSeconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(attempt.startedAt)) / 1000));
      return { attemptId: attempt.id, question: toStudentQuestionView(content), elapsedSeconds };
    } catch (error) {
      if (error instanceof PracticeApiError) throw error;
      throw toPracticeApiError(error);
    }
  }

  /**
   * The attempt a reload should resume, or `null` (=> start a new one). Resumable means: still
   * `in_progress`, owned by THIS student and enrollment, for THIS question (all re-checked here even
   * though the reader already scopes by them), AND the question is still published. An unpublished
   * question is never resumed -- `null` falls through to `startAttempt()`, which refuses it with the
   * ordinary `question_not_published` error. A finalized attempt never resumes.
   */
  private async findResumableAttempt(claim: StudentRequestClaim, questionId: string): Promise<AttemptState | null> {
    const canonical = await this.deps.questionReader.findById(questionId);
    if (!canonical || canonical.validationState !== "published") return null;
    const open = await this.deps.inProgressAttemptReader.findInProgressByStudentQuestion({ studentId: claim.studentId, questionId, enrollmentId: claim.enrollmentId });
    if (!open) return null;
    const valid = open.status === "in_progress" && open.studentId === claim.studentId && open.enrollmentId === claim.enrollmentId && open.questionId === questionId;
    return valid ? open : null;
  }

  private readonly startLocks = new Map<string, Promise<void>>();

  /** Runs `operation` after any earlier operation with the same key has settled (in-process serialization only). */
  private async withStartLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.startLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => mine);
    this.startLocks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.startLocks.get(key) === tail) this.startLocks.delete(key);
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
      // The attempt's OWN questionId (not the request's) decides which solution is revealed.
      const content = await this.deps.questionContentReader.findPublishedById(attempt.questionId);
      const canonical = await this.deps.questionReader.findById(attempt.questionId);
      return toAttemptResultView(attempt, correctAnswer, content?.expectedTimeSeconds ?? null, { solutionSteps: canonical?.solutionSteps, content });
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
      // Same expected time `getAttemptResult()` reports for a skipped attempt, so the skip response and a later re-read agree.
      const content = await this.deps.questionContentReader.findPublishedById(attempt.questionId);
      return toAttemptResultView(attempt, null, content?.expectedTimeSeconds ?? null);
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
      let reveal: Parameters<typeof toAttemptResultView>[3] = {};
      if (attempt.status === "submitted") {
        const canonical = await this.deps.questionReader.findById(attempt.questionId);
        correctAnswer = canonical?.correctAnswer ?? null;
        expectedTimeSeconds = canonical?.expectedTimeSeconds ?? null;
        reveal = { solutionSteps: canonical?.solutionSteps, content: await this.deps.questionContentReader.findPublishedById(attempt.questionId) };
      } else {
        const content = await this.deps.questionContentReader.findPublishedById(attempt.questionId);
        expectedTimeSeconds = content?.expectedTimeSeconds ?? null;
      }

      return toAttemptResultView(attempt, correctAnswer, expectedTimeSeconds, reveal);
    } catch (error) {
      if (error instanceof PracticeApiError) throw error;
      throw toPracticeApiError(error);
    }
  }

  /**
   * Phase 4 Unit 1 -- the OBSERVATION-ONLY evidence for an already-finalized attempt ("what happened"), as a student-safe view.
   * Ownership is verified against the loaded attempt, an attempt that is still `in_progress` is refused (`invalid_state`/409) so
   * nothing can be read before submission, and the evidence is assembled by `@ipmat/training-recommendation` from persisted state
   * alone -- never from the client, never stored, never diagnostic. No AI call, no write.
   */
  async getAttemptEvidence(claim: StudentRequestClaim, input: { attemptId: string }): Promise<AttemptEvidenceView> {
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
      const evidence = await this.deps.trainingRecommendationService.getAttemptObservationEvidence({ studentId: claim.studentId, enrollmentId: claim.enrollmentId, attemptId: input.attemptId });
      if (evidence === null) {
        throw new AttemptLifecycleError("attempt_not_found", `No evidence is available for attempt "${input.attemptId}".`);
      }
      return toAttemptEvidenceView(evidence);
    } catch (error) {
      if (error instanceof PracticeApiError) throw error;
      throw toPracticeApiError(error);
    }
  }

  /** Shared by the Unit 2 methods: the attempt must exist, belong to this student, and be finalized (nothing before submission). */
  private async loadFinalizedOwnedAttempt(claim: StudentRequestClaim, attemptId: string): Promise<AttemptState> {
    const attempt = await this.deps.practiceLoopService.getAttempt(attemptId);
    if (!attempt) throw new AttemptLifecycleError("attempt_not_found", `No attempt found with id "${attemptId}".`);
    if (attempt.studentId !== claim.studentId) throw new AttemptLifecycleError("ownership_mismatch", "This attempt does not belong to the requesting student.");
    if (attempt.status === "in_progress") throw new PracticeApiError("invalid_state", "This attempt has not been finalized yet.", 409);
    return attempt;
  }

  /**
   * Phase 4 Unit 2/3 -- offers ONE possible explanation for an incorrect, submitted attempt, and PERSISTS the offer.
   *   - nothing before submission (409), never another student's attempt (403);
   *   - an offer already stored for the attempt is returned as-is (no new model call, identical on every instance); if the student has already
   *     answered it, the persisted result is returned (`answered`) so a refresh or restart shows the same state;
   *   - otherwise the model proposes (the safety validation lives in the injected generator), the offer is stored with its Unit 1 evidence as
   *     provenance -- exactly one offer per attempt, enforced by the database -- and a sealed token for it is returned;
   *   - every failure to produce a safe offer (no model, provider error/timeout, unsafe or ungrounded output, unresolved question metadata)
   *     answers `unavailable` and nothing else: no fabricated text, no raw output, no error detail.
   * The model's own category is never used: the hypothesis's category is the question's DESIGNED trap category, resolved through the taxonomy.
   */
  async generateHypothesis(claim: StudentRequestClaim, input: { attemptId: string; now?: string }): Promise<HypothesisOfferView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.attemptId, "attemptId");
    const now = input.now ?? new Date().toISOString();

    try {
      const attempt = await this.loadFinalizedOwnedAttempt(claim, input.attemptId);
      if (attempt.status !== "submitted" || attempt.isCorrect !== false) return { status: "not_applicable", attemptId: attempt.id };

      const { hypothesisGenerator: generate, hypothesisSealer: sealer, autopsyStore: store } = this.deps;
      if (!store) return { status: "unavailable", attemptId: attempt.id };

      const issue = (stored: StoredDiagnosis): HypothesisOfferView => {
        if (stored.autopsy.confirmed !== null) return { status: "answered", attemptId: attempt.id, result: toHypothesisResponseView(stored, true) };
        if (!sealer) return { status: "unavailable", attemptId: attempt.id };
        const payload: HypothesisTokenPayload = { v: 2, studentId: claim.studentId, attemptId: attempt.id, autopsyId: stored.autopsy.id, hypothesisText: stored.autopsy.hypothesisText, expiresAtMs: Date.parse(now) + HYPOTHESIS_TOKEN_TTL_MS };
        return {
          status: "ready",
          attemptId: attempt.id,
          hypothesis: { summary: stored.autopsy.hypothesisText, supportingEvidence: asStrings(stored.autopsy.evidenceUsed["supportingEvidence"]) },
          token: sealer.seal(payload)
        };
      };

      const existing = await store.findByAttemptId(attempt.id);
      if (existing !== null) return issue(existing);

      if (!generate || !sealer) return { status: "unavailable", attemptId: attempt.id };
      const pieces = await this.deps.trainingRecommendationService.getAttemptAutopsyOutput({ studentId: claim.studentId, enrollmentId: claim.enrollmentId, attemptId: attempt.id });
      if (pieces === null) return { status: "unavailable", attemptId: attempt.id };

      let hypothesis: AutopsyHypothesis;
      try {
        hypothesis = await generate(pieces.observation, { designedErrorCategory: pieces.output.candidateErrorEvidence?.proposedErrorCategory ?? null });
      } catch {
        return { status: "unavailable", attemptId: attempt.id }; // provider failure, timeout, schema failure or a rejected proposal
      }
      if (hypothesis.attemptId !== attempt.id || hypothesis.confirmationStatus !== "awaiting_confirmation" || hypothesis.supportingEvidence.length === 0) {
        return { status: "unavailable", attemptId: attempt.id };
      }

      const { stored } = await store.offer({ studentId: claim.studentId, hypothesis, output: pieces.output, observation: pieces.observation });
      return issue(stored);
    } catch (error) {
      if (error instanceof PracticeApiError) throw error;
      throw toPracticeApiError(error);
    }
  }

  /**
   * Phase 4 Unit 3 -- records the student's response to the stored offer, ONCE.
   *   confirmed -> the hypothesis is a student-CONFIRMED diagnosis, and a RepairPlan is built by the existing `buildRepairPlan()` and stored in
   *                the same transaction (exactly one: the database allows one plan per autopsy);
   *   rejected  -> recorded as not confirmed; no diagnosis, no RepairPlan;
   *   corrected -> the student's own words are stored exactly; NOT a diagnosis and no RepairPlan (turning a free-text correction into a
   *                structured diagnosis needs a later diagnosis pass, D-039).
   * The token (sealed: student + attempt + stored offer id and text + expiry) is verified, and the stored offer must still match it. A second
   * response -- same or different, same instance or another, even concurrent -- changes nothing and returns the persisted result
   * (`alreadyRecorded: true`): the first response wins.
   */
  async respondToHypothesis(claim: StudentRequestClaim, input: { attemptId: string; token: string; response: HypothesisResponseInput; now?: string }): Promise<HypothesisResponseView> {
    assertValidClaim(claim);
    assertNonEmptyString(input.attemptId, "attemptId");
    assertNonEmptyString(input.token, "token");
    if (input.token.length > MAX_TOKEN_CHARS) throw new PracticeApiError("invalid_request", "The request was malformed.", 400);
    const type = (input.response as { type?: unknown } | null)?.type;
    if (type !== "confirmed" && type !== "rejected" && type !== "corrected") throw new PracticeApiError("invalid_request", "The response must be confirmed, rejected or corrected.", 400);
    if (type === "corrected") {
      const text = (input.response as { correctedExplanation?: unknown }).correctedExplanation;
      if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_CORRECTION_CHARS) {
        throw new PracticeApiError("invalid_request", `A correction must be between 1 and ${MAX_CORRECTION_CHARS} characters.`, 400);
      }
    }
    const now = input.now ?? new Date().toISOString();

    try {
      const attempt = await this.loadFinalizedOwnedAttempt(claim, input.attemptId);
      const stale = new PracticeApiError("invalid_state", "This explanation is no longer valid. Please request a new one.", 409);
      const store = this.deps.autopsyStore;
      const opened = this.deps.hypothesisSealer?.open(input.token) ?? null;
      if (!store || !isTokenPayload(opened)) throw stale;
      if (opened.studentId !== claim.studentId || opened.attemptId !== input.attemptId) {
        throw new AttemptLifecycleError("ownership_mismatch", "This explanation was not issued for this student and attempt.");
      }
      if (Date.parse(now) > opened.expiresAtMs) throw stale;

      const stored = await store.findByAttemptId(attempt.id);
      if (stored === null || stored.autopsy.id !== opened.autopsyId || stored.autopsy.hypothesisText !== opened.hypothesisText) throw stale;
      if (stored.autopsy.confirmed !== null) return toHypothesisResponseView(stored, true); // already answered: the first response stands

      const offered: AutopsyHypothesis = {
        attemptId: attempt.id,
        proposedErrorCategory: stored.autopsy.likelyRootCause as AutopsyHypothesis["proposedErrorCategory"],
        proposedExplanation: stored.autopsy.hypothesisText,
        supportingEvidence: asStrings(stored.autopsy.evidenceUsed["supportingEvidence"]),
        contradictoryEvidence: asStrings(stored.autopsy.evidenceUsed["contradictoryEvidence"]),
        missingEvidence: asStrings(stored.autopsy.evidenceUsed["missingEvidence"]),
        modelConfidence: null, // the model's own number is internal and is not needed to apply a response
        confirmationRequired: true,
        confirmationStatus: "awaiting_confirmation",
        studentCorrectionText: null,
        respondedAt: null,
        generationMetadata: { provider: stored.autopsy.generatedByProvider, model: "stored-offer", promptVersion: stored.autopsy.promptVersion, task: "autopsy-hypothesis", timestamp: stored.autopsy.createdAt, latencyMs: 0, tokenUsage: null, estimatedCostUsd: null, attempts: 1, success: true, validationOutcome: "valid" }
      };
      const response: ConfirmationResponse = type === "corrected" ? { type: "corrected", correctedExplanation: (input.response as { correctedExplanation: string }).correctedExplanation } : type === "confirmed" ? { type: "confirmed" } : { type: "rejected" };
      const decided = applyConfirmationResponse(offered, response, { now });

      // Only a student-CONFIRMED hypothesis can yield a RepairPlan, built by the existing planner. If it cannot be built (no structured target:
      // e.g. the question had no resolvable designed trap) the confirmation is still recorded -- just without a plan.
      let plan: RepairPlan | null = null;
      if (decided.confirmationStatus === "confirmed") {
        const pieces = await this.deps.trainingRecommendationService.getAttemptAutopsyOutput({ studentId: claim.studentId, enrollmentId: claim.enrollmentId, attemptId: attempt.id });
        if (pieces !== null) {
          try {
            plan = buildRepairPlan(decided, pieces.output);
          } catch {
            plan = null;
          }
        }
      }

      const { stored: after, applied } = await store.respond({ studentId: claim.studentId, decided, plan });
      return toHypothesisResponseView(after, !applied);
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
