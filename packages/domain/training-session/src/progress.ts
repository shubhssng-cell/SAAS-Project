import type { AttemptStatus } from "@ipmat/attempt";
import type { PracticeBlockState } from "@ipmat/practice-block";

/**
 * Phase 5 Unit 1 -- everything about a session's progress is DERIVED on every read from
 * (a) its `PracticeBlock` (the persisted lifecycle + configured completion rule) and
 * (b) the attempts recorded in that block -- never stored as its own column (the same
 * "derive, don't cache" discipline as mastery and coverage, D-015). A restart therefore
 * reconstructs exactly the same progress from the same persisted rows.
 *
 * Nothing here reads a clock: `now` is supplied by the caller (the server's clock).
 */
export interface TrainingSessionAttemptFact {
  id: string;
  status: AttemptStatus;
}

export interface TrainingSessionProgress {
  status: PracticeBlockState["status"];
  /** Attempts that ended as `submitted` or `skipped` (an `abandoned` attempt is not a completed question). */
  completedQuestionCount: number;
  submittedCount: number;
  skippedCount: number;
  /** The one attempt still `in_progress` in this session, if any. */
  openAttemptId: string | null;
  elapsedSeconds: number;
  targetQuestionCount: number | null;
  timeBudgetSeconds: number | null;
  remainingQuestions: number | null;
  remainingSeconds: number | null;
  /** True once the configured completion rule is met. It never auto-completes anything by itself -- completion is always an explicit transition (D-060). */
  completionReached: boolean;
}

function wholeSecondsBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
}

export function deriveTrainingSessionProgress(input: { block: PracticeBlockState; attempts: TrainingSessionAttemptFact[]; now: string }): TrainingSessionProgress {
  const { block, attempts } = input;
  const submittedCount = attempts.filter((attempt) => attempt.status === "submitted").length;
  const skippedCount = attempts.filter((attempt) => attempt.status === "skipped").length;
  const completedQuestionCount = submittedCount + skippedCount;
  const open = attempts.filter((attempt) => attempt.status === "in_progress");
  const openAttemptId = open.length > 0 ? open[0]!.id : null;

  const endForElapsed = block.endedAt ?? input.now;
  const elapsedSeconds = wholeSecondsBetween(block.startedAt, endForElapsed);

  const remainingQuestions = block.targetQuestionCount === null ? null : Math.max(0, block.targetQuestionCount - completedQuestionCount);
  const remainingSeconds = block.blockTimeBudgetSeconds === null ? null : Math.max(0, block.blockTimeBudgetSeconds - elapsedSeconds);

  const completionReached = (remainingQuestions !== null && remainingQuestions === 0) || (remainingSeconds !== null && remainingSeconds === 0);

  return {
    status: block.status,
    completedQuestionCount,
    submittedCount,
    skippedCount,
    openAttemptId,
    elapsedSeconds,
    targetQuestionCount: block.targetQuestionCount,
    timeBudgetSeconds: block.blockTimeBudgetSeconds,
    remainingQuestions,
    remainingSeconds,
    completionReached
  };
}
