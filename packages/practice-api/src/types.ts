import type { AutopsyRepository, EnrollmentReader, QuestionContentReader, QuestionReader } from "@ipmat/db";
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
export interface PracticeApiDependencies {
  trainingRecommendationService: TrainingRecommendationService;
  practiceLoopService: PracticeLoopService;
  enrollmentReader: EnrollmentReader;
  /** Server-side answer-key resolution ONLY (D-048) — never returned to a caller directly; used only to build a post-finalization result view. */
  questionReader: QuestionReader;
  /** Server-side DISPLAY content — never carries an answer key. */
  questionContentReader: QuestionContentReader;
  autopsyReader: Pick<AutopsyRepository, "findByAttemptId">;
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
