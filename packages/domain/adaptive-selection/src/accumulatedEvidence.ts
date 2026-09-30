import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import { ADAPTIVE_SELECTION_CONSTANTS, DIFFICULTY_TIER_ORDER, type DifficultyTier, type MasteryStateResult } from "./types.js";

/**
 * PHASE 3.2 -- ACCUMULATED evidence, as opposed to Phase 3.1's RECENT evidence.
 *
 *   RECENT      "what just happened?"        the single most recent finalized attempt        (recentEvidence.ts)
 *   ACCUMULATED "what has been demonstrated  the existing per-concept mastery aggregates       (this file + the mastery
 *                over enough observations?"   over ALL of the student's persisted attempts      measures in trainingNeeds.ts)
 *
 * No second mastery system: accumulated evidence is READ from the existing `MasteryStateResult` (`@ipmat/mastery`), which is
 * recomputed from persisted attempts on every request -- never stored, never a running counter. The multi-attempt reasons
 * that consume it, and the ONE minimum-observation rule they share (`MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT`, 3):
 *   - `accuracy_weakness`  mean accuracy < 0.6, WHEN measured (>= 3 graded attempts on the concept, else `null` = no claim)
 *   - `speed_weakness`     mean time/expected >= 1.3, WHEN measured (>= 3 timed attempts on the concept)
 *   - `repeated_error`     the CURRENT run of consecutive incorrect graded answers is >= 2 (see `trailingIncorrectStreak`)
 *   - `difficulty_progression` a tier with >= 3 attempts and accuracy >= 0.8 makes the next tier the progression target
 * Everything here stays DESCRIPTIVE: counts and ratios of observed performance. It is evidence about what was observed, not a
 * diagnosis, and never a claim about the student.
 */

/**
 * The number of consecutive incorrect graded answers ENDING at the student's most recent graded attempt (0 when the latest
 * graded answer was correct, or there are none). Phase 3.2 uses this instead of the mastery detail's `longestIncorrectStreak`
 * (the longest run EVER): two misses early in a long history would otherwise mark the concept `repeated_error` forever,
 * outranking everything, however many answers have been correct since. Skipped attempts are not graded and do not break a run
 * (the same convention the mastery sequence already follows).
 */
export function trailingIncorrectStreak(gradedCorrectnessSequence: boolean[]): number {
  let streak = 0;
  for (let i = gradedCorrectnessSequence.length - 1; i >= 0; i--) {
    if (gradedCorrectnessSequence[i] === false) streak += 1;
    else break;
  }
  return streak;
}

/**
 * The highest difficulty tier this student has demonstrated enough on -- at least `MIN_OBSERVATIONS_FOR_COMPONENT` graded attempts
 * on that tier AND accuracy on it at or above `PROGRESSION_ACCURACY_THRESHOLD` -- with the counts it rests on, or `null`. This is
 * the ONE implementation of that rule: `computeProgressionTargetTier()` (trainingNeeds.ts) is defined in terms of it, so the
 * progression decision and its explanation can never disagree. Reads only `difficultyBreakdown.byTier`.
 */
export function highestDemonstratedTier(mastery: MasteryStateResult | undefined): { tier: DifficultyTier; attempts: number; correct: number } | null {
  if (!mastery) return null;
  let highest: { tier: DifficultyTier; attempts: number; correct: number } | null = null;
  for (const tier of DIFFICULTY_TIER_ORDER) {
    const stats = mastery.detail.difficultyBreakdown.byTier[tier];
    if (!stats || stats.attempts < MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT) continue;
    if (stats.correct / stats.attempts >= ADAPTIVE_SELECTION_CONSTANTS.PROGRESSION_ACCURACY_THRESHOLD) {
      highest = { tier, attempts: stats.attempts, correct: stats.correct };
    }
  }
  return highest;
}

/** Descriptive facts about the accumulated, persisted evidence for ONE concept -- counts and a ratio, nothing inferred. */
export interface AccumulatedEvidence {
  conceptName: string;
  /** Graded (submitted) attempts on this concept. */
  gradedAttempts: number;
  incorrectCount: number;
  /** Consecutive incorrect graded answers ending at the most recent graded attempt. */
  trailingIncorrectStreak: number;
  /** Attempts with a computable time/expected ratio (`null` mean below one). */
  speedObservations: number;
  meanSpeedRatio: number | null;
  /** The highest tier with enough graded attempts and accuracy at/above the existing progression threshold, with its counts -- `null` when none. */
  highestDemonstratedTier: { tier: DifficultyTier; attempts: number; correct: number } | null;
}

/** `null` when the student has no attempts on this concept at all. Reads only the existing mastery aggregates. */
export function deriveAccumulatedEvidence(mastery: MasteryStateResult | undefined): AccumulatedEvidence | null {
  if (!mastery || mastery.detail.totalAttempts === 0) return null;
  const d = mastery.detail;
  return {
    conceptName: mastery.conceptName,
    gradedAttempts: d.submittedAttempts,
    incorrectCount: d.incorrectCount,
    trailingIncorrectStreak: trailingIncorrectStreak(d.accuracyStability.sequence),
    speedObservations: d.speedStatistics.observationCount,
    meanSpeedRatio: d.speedStatistics.meanSpeedRatio,
    highestDemonstratedTier: highestDemonstratedTier(mastery)
  };
}
