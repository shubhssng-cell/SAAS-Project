import type { PracticeBlockState } from "./types.js";

/**
 * Always computed on read from a caller-supplied attempt count — never
 * cached on `PracticeBlockState` itself (docs/DECISIONS.md D-015's
 * "derive, never cache" discipline, the same rule mastery/coverage/
 * Examiner-Lens combinations already follow).
 */
export interface PracticeBlockProgress {
  attemptCount: number;
  targetQuestionCount: number | null;
  /** True once `attemptCount >= targetQuestionCount`. Purely informational — nothing in this package (or anywhere else) reads this to auto-complete a block. Always false when `targetQuestionCount` is null (no target was set). */
  targetReached: boolean;
}

export function deriveBlockProgress(block: PracticeBlockState, attemptCount: number): PracticeBlockProgress {
  return {
    attemptCount,
    targetQuestionCount: block.targetQuestionCount,
    targetReached: block.targetQuestionCount !== null && attemptCount >= block.targetQuestionCount
  };
}
