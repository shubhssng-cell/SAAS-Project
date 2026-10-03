import type { ExamIntelligenceSource } from "@ipmat/exam-intelligence";
import type {
  AttemptHistoryReader,
  ConceptReader,
  EnrollmentReader,
  PracticeBlockRepository,
  PracticeSessionRepository,
  QuestionReader,
  RepairPlanRepository,
  TrainingQuestionReader, ErrorTaxonomyReader, RepairPlanStatusWriter } from "@ipmat/db";

/**
 * Training Recommendation Composition (docs/project-memory/37_TRAINING_RECOMMENDATION.md).
 * Every dependency is a `@ipmat/db` PORT interface — never a concrete Prisma
 * class, never `@prisma/client`. Repository ports are narrowed with `Pick`
 * to the ONE read method this layer calls, so this package structurally
 * cannot reach a write method (this is a snapshot read, never a mutation —
 * §11: no transaction, no writes).
 */
export interface TrainingRecommendationDependencies {
  enrollmentReader: EnrollmentReader;
  attemptHistoryReader: AttemptHistoryReader;
  repairPlanReader: Pick<RepairPlanRepository, "findConfirmedActiveByStudentId">;
  trainingQuestionReader: TrainingQuestionReader;
  /**
   * The D-048 canonical reader — used ONLY to build the `AttemptQuestionContext`
   * that `@ipmat/attempt`'s `toMasteryContribution()` requires. The answer
   * key it carries is never copied into anything handed to
   * `@ipmat/training-orchestration` (`MasteryAttemptRecord` has no
   * answer-bearing field).
   */
  questionReader: QuestionReader;
  conceptReader: ConceptReader;
  practiceSessionReader: Pick<PracticeSessionRepository, "findActiveByEnrollmentId">;
  practiceBlockReader: Pick<PracticeBlockRepository, "findBySessionId">;
  /** Phase 4 Unit 3 (optional): the existing error taxonomy, used only to resolve a question's designed trap to its category for the Autopsy output. Absent -> an empty taxonomy (no category is invented). */
  errorTaxonomyReader?: ErrorTaxonomyReader;
  /** Phase 4 Unit 4 (optional): keeps the stored RepairPlan status in step with the status derived from attempts (forward-only, idempotent). Decisions never depend on it succeeding. */
  repairPlanStatusWriter?: RepairPlanStatusWriter;
  /** Phase 7 Unit 3 (optional): Phase 6 Exam Intelligence source. When supplied, the curriculum view attaches content availability per concept (availability only); absent -> `null`. Nothing else reads it. */
  examIntelligenceSource?: ExamIntelligenceSource;
  /** Supplies `computeMasteryState()`'s `now` (pure mastery functions never read the clock themselves). Defaults to the system clock. */
  now?: () => string;
}

/** The ONLY caller-supplied input. `studentId` is a claim until `enrollment.studentId` confirms it. */
export interface TrainingRecommendationRequest {
  studentId: string;
  enrollmentId: string;
}

export const TRAINING_RECOMMENDATION_ERROR_CODES = [
  "invalid_request",
  "enrollment_not_found",
  "enrollment_ownership_mismatch",
  "ownership_inconsistency",
  "repository_contract_violation"
] as const;
export type TrainingRecommendationErrorCode = (typeof TRAINING_RECOMMENDATION_ERROR_CODES)[number];

/**
 * Typed, fail-closed error for THIS layer's own rules — mirrors
 * `PracticeLoopError`/`PersistenceError`. `ownership_inconsistency` means a
 * repository returned a row that does not belong to the verified
 * student/enrollment/session/block chain; `repository_contract_violation`
 * means a row violated a documented reader contract (e.g. a "finalized"
 * attempt still `in_progress`). Both are raised rather than silently
 * filtered — cross-student data is never quietly continued past. Repository
 * errors themselves are never caught or re-wrapped; they propagate as thrown.
 */
export class TrainingRecommendationError extends Error {
  readonly code: TrainingRecommendationErrorCode;

  constructor(code: TrainingRecommendationErrorCode, message: string) {
    super(message);
    this.name = "TrainingRecommendationError";
    this.code = code;
  }
}
