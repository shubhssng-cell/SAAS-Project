import { deriveAnswerChangeHistory, type AnswerChangeHistory } from "./answerHistory.js";
import { AttemptLifecycleError, type AttemptEventRecord, type AttemptQuestionContext, type AttemptState } from "./types.js";

/**
 * The clean output contract a finalized Attempt provides to the future
 * Question Autopsy system (Phase 4A §9 / docs/AI_ARCHITECTURE.md §10) —
 * CONTRACT ONLY, no hypothesis generation is implemented here or anywhere
 * yet (that's Phase 5). Every field is an OBSERVABLE FACT reconstructible
 * from `Attempt`/`AttemptEvent` rows and the authoritative question
 * record. This type structurally CANNOT express confidence, motivation,
 * intelligence, emotion, or any other private mental state — there is no
 * field for any of them, and none should ever be added here (docs/
 * DECISIONS.md D-005, D-006). `reasoningText`/`workingSteps` (Phase 1
 * schema fields, docs/DECISIONS.md D-011) are deliberately NOT included —
 * they remain reserved for Phase 5's evidence assembly
 * (docs/AI_ARCHITECTURE.md §10), not an oversight here.
 */
export interface AttemptAutopsyEvidence {
  attemptId: string;
  studentId: string;
  questionId: string;
  conceptId: string;
  status: "submitted" | "skipped" | "abandoned";
  correctAnswer: string;
  finalAnswer: string | null;
  isCorrect: boolean | null;
  answerChangeHistory: AnswerChangeHistory;
  timeTakenSeconds: number | null;
  expectedTimeSeconds: number | null;
  hintsUsed: number;
  solutionOpenedAt: string | null;
  /** Observable, not inferred: did the recorded solution_opened event (if any) occur before finalization? Null if the solution was never opened. */
  solutionOpenedBeforeFinalization: boolean | null;
  skipped: boolean;
  eventTimeline: AttemptEventRecord[];
}

/**
 * Builds the evidence contract from a FINALIZED attempt only — throws
 * `already_finalized`'s inverse case is not a real code, so this reuses
 * `attempt_not_found`'s "the operation doesn't apply" spirit via a
 * dedicated message; evidence assembly for an in-progress attempt makes no
 * sense (there is nothing finished to diagnose yet, and Autopsy is always
 * a hypothesis about a COMPLETED attempt — docs/DECISIONS.md D-006).
 */
export function toAutopsyEvidence(attempt: AttemptState, question: AttemptQuestionContext): AttemptAutopsyEvidence {
  if (attempt.status === "in_progress") {
    throw new AttemptLifecycleError("attempt_not_found", "Cannot build autopsy evidence for an attempt that is still in_progress");
  }
  if (question.questionId !== attempt.questionId) {
    throw new AttemptLifecycleError(
      "ownership_mismatch",
      `Supplied question context is for questionId="${question.questionId}", but this attempt is for questionId="${attempt.questionId}"`
    );
  }

  const solutionOpenedBeforeFinalization =
    attempt.solutionOpenedAt === null || attempt.finalizedAt === null
      ? null
      : Date.parse(attempt.solutionOpenedAt) <= Date.parse(attempt.finalizedAt);

  return {
    attemptId: attempt.id,
    studentId: attempt.studentId,
    questionId: attempt.questionId,
    conceptId: question.conceptId,
    status: attempt.status as "submitted" | "skipped" | "abandoned",
    correctAnswer: question.correctAnswer,
    finalAnswer: attempt.chosenAnswer,
    isCorrect: attempt.isCorrect,
    answerChangeHistory: deriveAnswerChangeHistory(attempt),
    timeTakenSeconds: attempt.timeSpentSeconds,
    expectedTimeSeconds: question.expectedTimeSeconds,
    hintsUsed: attempt.hintsUsed,
    solutionOpenedAt: attempt.solutionOpenedAt,
    solutionOpenedBeforeFinalization,
    skipped: attempt.status === "skipped",
    eventTimeline: attempt.events
  };
}
