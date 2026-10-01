import type { AutopsyDecisionRepository, AutopsyRepository, EnrollmentReader, InProgressAttemptReader, QuestionContentReader, QuestionReader } from "@ipmat/db";
import type { AutopsyHypothesis, AutopsyOutput, ObservationEvidence } from "@ipmat/training-recommendation";
import type { PracticeLoopService } from "@ipmat/practice-loop";
import type { TrainingRecommendationService } from "@ipmat/training-recommendation";

/**
 * The application/API boundary (docs/project-memory/70_API_AND_APPLICATION_LAYER.md).
 * `PracticeApiService` COORDINATES the existing application services —
 * `@ipmat/training-recommendation` for "what next", `@ipmat/practice-loop`
 * for the attempt lifecycle — it never reimplements either one's decision
 * logic, and never calls a training-system provider, `@ipmat/adaptive-selection`,
 * or `@ipmat/repair-selection` directly. `AutopsyRepository`/`QuestionContentReader`
 * are read directly (no decision logic of their own to duplicate).
 *
 * Every dependency is a `@ipmat/db` PORT interface or an already-constructed
 * application service — never `@prisma/client` directly. A concrete HTTP
 * transport (e.g. `apps/api`) wires this once, from either in-memory or
 * Prisma-backed repositories; this package itself never chooses which.
 */
/**
 * Phase 4 Unit 2 -- injected, optional, and ABSENT by default: with no generator a hypothesis is reported as unavailable, never fabricated.
 * The generator owns the model call and the safety validation (`@ipmat/autopsy`'s `generateObservationHypothesis()`, wired in `apps/api`);
 * this package never imports an AI SDK.
 */
export type HypothesisGenerator = (observation: ObservationEvidence, context: { designedErrorCategory: NonNullable<AutopsyOutput["candidateErrorEvidence"]>["proposedErrorCategory"] }) => Promise<AutopsyHypothesis>;

/**
 * Seals/opens the confirmation token (authenticated encryption, wired in `apps/api`). Unit 2 stores NOTHING: the exact hypothesis that was
 * shown rides in this opaque token so the student's response is applied to precisely what they saw, and can be neither forged nor altered.
 * `open()` returns `null` for any token that is not authentic.
 */
export interface HypothesisSealer {
  seal(payload: unknown): string;
  open(token: string): unknown | null;
}

export interface PracticeApiDependencies {
  trainingRecommendationService: TrainingRecommendationService;
  practiceLoopService: PracticeLoopService;
  /** Product Phase 2 Unit 5: finds the student's already-open attempt so a reload resumes it instead of starting another. Read-only. */
  inProgressAttemptReader: InProgressAttemptReader;
  enrollmentReader: EnrollmentReader;
  /** Server-side answer-key resolution ONLY (D-048) — never returned to a caller directly; used only to build a post-finalization result view. */
  questionReader: QuestionReader;
  /** Server-side DISPLAY content — never carries an answer key. */
  questionContentReader: QuestionContentReader;
  autopsyReader: Pick<AutopsyRepository, "findByAttemptId">;
  /** Phase 4 Unit 2 (optional). Both must be present for a hypothesis to be offered. */
  hypothesisGenerator?: HypothesisGenerator | null;
  hypothesisSealer?: HypothesisSealer | null;
  /** Phase 4 Unit 3: where offers and the student's answers (and the RepairPlan of a confirmed one) are persisted. Required for any hypothesis to be offered. */
  autopsyStore?: AutopsyDecisionRepository | null;
}

/** The identity claim every operation requires — the same "caller supplies studentId/enrollmentId, this layer verifies the relationship" trust boundary `@ipmat/training-recommendation`/`@ipmat/practice-loop` already have. Resolving this FROM a real authenticated session is explicitly future work (D-004, still open) — this boundary adds no new trust assumption beyond what those two services already require of their own callers. */
export interface StudentRequestClaim {
  studentId: string;
  enrollmentId: string;
}

export type AnswerFormat = "multiple_choice" | "numeric_entry";

/** Never carries `correctAnswer`, `groundTruthDerivation`, `solutionSteps`, or any internal id beyond `questionId`. */
export interface StudentQuestionView {
  questionId: string;
  chapterName: string;
  conceptName: string;
  prompt: string;
  answerFormat: AnswerFormat;
  options: string[] | null;
  expectedTimeSeconds: number;
}

/**
 * Never carries `providerId`, `providerResult`, `diagnostics`, or any raw
 * training-system/repair/adaptive reason code — those are internal
 * orchestration structures (K, B). `modeLabel`/`headline`/`explanation` are
 * this layer's own authored, student-safe translation of an already-made
 * decision (mirrors `apps/web/src/adapter/presentation.ts`'s existing
 * `toRecommendationViewModel()` — this is the SAME kind of translation,
 * independently authored here since this package cannot depend on `apps/web`).
 */
export interface RecommendationView {
  /** `null` only for the genuine "nothing to recommend right now" state. */
  questionId: string | null;
  headline: string;
  explanation: string;
  modeLabel: string;
}

export interface StartAttemptResult {
  attemptId: string;
  question: StudentQuestionView;
  /**
   * Whole seconds since the attempt started, by the SERVER's clock (`now - attempt.startedAt`) --
   * 0 for a brand-new attempt, larger when an already-open attempt was resumed after a reload.
   * The browser only uses it to seed its display; it is never sent back as a duration.
   */
  elapsedSeconds: number;
}

export type AttemptResultStatus = "submitted" | "skipped" | "abandoned";

/** `correctAnswer` is present ONLY when `status === "submitted"` — never before submission, never for a skip (there is no "the" answer a skip was graded against). */
export interface AttemptResultView {
  attemptId: string;
  questionId: string;
  status: AttemptResultStatus;
  isCorrect: boolean | null;
  chosenAnswer: string | null;
  correctAnswer: string | null;
  timeSpentSeconds: number | null;
  expectedTimeSeconds: number | null;
  /** The authored worked solution -- present ONLY when `status === "submitted"` and one is stored; otherwise `[]` (never invented, never before submission). */
  solutionSteps: string[];
  /** The question as the student saw it (already student-visible content), for showing context beside the result. `null` unless `status === "submitted"` and the content could be read. */
  question: { prompt: string; chapterName: string; conceptName: string } | null;
}

/**
 * Phase 4 Unit 1 -- what the system OBSERVED about one finalized attempt, for the student. Observation only: no diagnosis, no cause,
 * no label, no answer key (the verdict is the only answer-related fact and the result already shows it), nothing inferred about the
 * student. `observations` are fixed, hand-authored sentences built from the numbers in `facts`/`history`; `notRecorded` says plainly
 * what this practice flow does not record, instead of guessing it. Only available AFTER the attempt is finalized.
 */
export interface AttemptEvidenceView {
  attemptId: string;
  questionId: string;
  status: AttemptResultStatus;
  observations: string[];
  facts: {
    verdict: "correct" | "incorrect" | "not_graded";
    selectedAnswer: string | null;
    elapsedSeconds: number | null;
    expectedSeconds: number | null;
    timeRatio: number | null;
    /** `null` = unknown (see `notRecorded`), never 0 by default. */
    answerChangeCount: number | null;
  };
  context: { conceptName: string; patternFamilyName: string; difficultyTier: string } | null;
  history: { priorAttempts: number; onConcept: { attempts: number; correct: number; incorrect: number; skipped: number } } | null;
  notRecorded: string[];
}

/**
 * Phase 4 Unit 2 -- a POSSIBLE explanation for an incorrect attempt, offered for the student to confirm, reject or correct. It is a
 * hypothesis, never a diagnosis: `ready` carries only the explanation text, the verbatim observed facts it cites, and the opaque token
 * needed to answer it. It never carries `modelConfidence`, the model/provider, prompts, an error category, or an answer key.
 * `not_applicable` = nothing to explain (not an incorrect submitted attempt); `unavailable` = no explanation could be offered right now
 * (no model configured, a provider failure, or an unsafe/ungrounded proposal) -- the result and Continue are unaffected.
 */
export type HypothesisOfferView =
  | { status: "ready"; attemptId: string; hypothesis: { summary: string; supportingEvidence: string[] }; token: string }
  /** The student already answered the stored offer (a refresh, a restart, another device): the persisted result, never a new offer. */
  | { status: "answered"; attemptId: string; result: HypothesisResponseView }
  | { status: "not_applicable" | "unavailable"; attemptId: string };

export type HypothesisResponseInput = { type: "confirmed" } | { type: "rejected" } | { type: "corrected"; correctedExplanation: string };

/**
 * The PERSISTED outcome of the student's response (Phase 4 Unit 3). `confirmed` means ONLY "the student said this explanation matches"; it is
 * not proof of a cause. `diagnosis.state`: `confirmed` (a student-confirmed diagnosis exists), `not_confirmed` (rejected: no diagnosis), or
 * `awaiting_diagnosis` (the student corrected it in their own words: recorded exactly, but NOT turned into a diagnosis -- that needs a later
 * diagnosis pass). `repairPlan` is only ever present for a confirmed diagnosis, and exposes just the practice focus -- no ids, no internal
 * fields. `alreadyRecorded` is true when an earlier response was already stored and this call changed nothing.
 */
export interface HypothesisResponseView {
  attemptId: string;
  status: "confirmed" | "rejected" | "corrected";
  /** The student's own words, exactly as submitted -- only when `status === "corrected"`. */
  studentCorrectionText: string | null;
  hypothesisSummary: string;
  persisted: true;
  alreadyRecorded: boolean;
  diagnosis: { state: "confirmed" | "not_confirmed" | "awaiting_diagnosis" };
  repairPlan: { conceptName: string; patternFamilyName: string; status: "pending" | "in_progress" | "completed" } | null;
}

/**
 * Never carries `modelConfidence` (D-038: the AI model's own confidence,
 * never to be exposed or reinterpreted as anything student-facing), never
 * carries raw `behaviorSignals`/`historicalSignals`/`candidateErrorEvidence`
 * (internal diagnostics) — only the hypothesis's own explanation text and
 * the plain evidence strings it cites.
 */
export interface PendingAutopsyView {
  attemptId: string;
  /** `false` means "no hypothesis currently awaiting a response" (a valid, ordinary state — most attempts never reach this) — never an error. */
  pending: boolean;
  hypothesis: { summary: string; supportingEvidence: string[] } | null;
}

export const PRACTICE_API_ERROR_CODES = [
  "invalid_request",
  "not_found",
  "ownership_mismatch",
  "question_not_published",
  "invalid_state",
  "infrastructure_failure"
] as const;
export type PracticeApiErrorCode = (typeof PRACTICE_API_ERROR_CODES)[number];

/**
 * The ONE error type this boundary's callers (an HTTP transport, a test)
 * ever need to branch on. `httpStatus` is a suggested mapping only — a
 * transport is free to use its own; this package itself never touches
 * `node:http`. `message` is always a safe, generic, hand-authored string —
 * never a raw domain/repository error's own message (which could echo
 * back internal ids/table names) — see `errors.ts`.
 */
export class PracticeApiError extends Error {
  readonly code: PracticeApiErrorCode;
  readonly httpStatus: number;

  constructor(code: PracticeApiErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "PracticeApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
