import { AttemptLifecycleError, type AttemptQuestionContext, type AttemptState } from "./types.js";

/**
 * The finalized-attempt data contract the future Mastery Engine will
 * consume (Phase 4A §10) — CONTRACT ONLY, no mastery computation is
 * implemented here or anywhere yet (that's Phase 5's `MasteryState`
 * computation job). This is a PER-ATTEMPT fact record, not a mastery
 * score — `MasteryState`'s `accuracy`/`speedRatio`/`noveltyHandling`/
 * `pressurePerformance`/`patternCoverage` fields (docs/DATABASE.md) are
 * computed by aggregating many of these across a student's attempt
 * history plus Question DNA, not determined by any single attempt or by
 * this contract alone. Nothing here is inferred beyond what's directly
 * observable from the finalized attempt and its authoritative question.
 */
export interface AttemptMasteryContribution {
  attemptId: string;
  studentId: string;
  conceptId: string;
  questionId: string;
  status: "submitted" | "skipped" | "abandoned";
  isCorrect: boolean | null;
  timeTakenSeconds: number | null;
  expectedTimeSeconds: number | null;
  hintsUsed: number;
  skipped: boolean;
  finalizedAt: string | null;
}

/** Builds the mastery-contribution record from a finalized attempt. Throws if the attempt is still `in_progress` — an unfinished attempt contributes nothing yet. */
export function toMasteryContribution(attempt: AttemptState, question: AttemptQuestionContext): AttemptMasteryContribution {
  if (attempt.status === "in_progress") {
    throw new AttemptLifecycleError("attempt_not_found", "Cannot build a mastery contribution for an attempt that is still in_progress");
  }
  if (question.questionId !== attempt.questionId) {
    throw new AttemptLifecycleError(
      "ownership_mismatch",
      `Supplied question context is for questionId="${question.questionId}", but this attempt is for questionId="${attempt.questionId}"`
    );
  }

  return {
    attemptId: attempt.id,
    studentId: attempt.studentId,
    conceptId: question.conceptId,
    questionId: attempt.questionId,
    status: attempt.status as "submitted" | "skipped" | "abandoned",
    isCorrect: attempt.isCorrect,
    timeTakenSeconds: attempt.timeSpentSeconds,
    expectedTimeSeconds: question.expectedTimeSeconds,
    hintsUsed: attempt.hintsUsed,
    skipped: attempt.status === "skipped",
    finalizedAt: attempt.finalizedAt
  };
}
