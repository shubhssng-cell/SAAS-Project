import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import type { MasteryAttemptRecord } from "@ipmat/training-systems";
import { CALCULATION_GYM_CONSTANTS } from "./constants.js";
import type { CalculationTrainingStage } from "./types.js";

function isGraded(record: MasteryAttemptRecord): boolean {
  return record.contribution.status === "submitted" && record.contribution.isCorrect !== null;
}

function accuracyOf(records: MasteryAttemptRecord[]): number | null {
  if (records.length < MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT) return null;
  const correct = records.filter((r) => r.contribution.isCorrect === true).length;
  return correct / records.length;
}

/**
 * Determines which stage of calculation training to GIVE the student next,
 * gating EACH transition on its own independent evidence slice
 * (docs/DECISIONS.md D-054, adjustment 3):
 *
 * - foundational -> mixed: requires `STAGE_MASTERY_ACCURACY` on
 *   foundational-shaped attempts (low computational load, not multi-step).
 * - mixed -> time_pressured: requires `STAGE_MASTERY_ACCURACY` on
 *   mixed-shaped attempts (high computational load, not time-pressured) —
 *   this is a SEPARATE, independently-gated slice from the foundational
 *   one above. Clearing foundational is necessary but never sufficient on
 *   its own to unlock time pressure.
 *
 * Under insufficient evidence at any gate, the function returns the
 * highest stage whose OWN gate was actually cleared (never skips ahead on
 * an earlier stage's evidence, and defaults to "foundational" with zero
 * evidence).
 */
export function determineCalculationTrainingStage(conceptName: string, studentId: string, attemptRecords: MasteryAttemptRecord[]): CalculationTrainingStage {
  const graded = attemptRecords.filter((r) => r.contribution.studentId === studentId && r.question.conceptName === conceptName && isGraded(r));

  const foundationalShaped = graded.filter(
    (r) => r.question.difficultyDimensions.computationalLoad < CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD && !r.question.testingModes.includes("multi_step")
  );
  const foundationalAccuracy = accuracyOf(foundationalShaped);
  const foundationalCleared = foundationalAccuracy !== null && foundationalAccuracy >= CALCULATION_GYM_CONSTANTS.STAGE_MASTERY_ACCURACY;
  if (!foundationalCleared) return "foundational";

  const mixedShaped = graded.filter(
    (r) => r.question.difficultyDimensions.computationalLoad >= CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD && !r.question.testingModes.includes("time_pressured")
  );
  const mixedAccuracy = accuracyOf(mixedShaped);
  const mixedCleared = mixedAccuracy !== null && mixedAccuracy >= CALCULATION_GYM_CONSTANTS.STAGE_MASTERY_ACCURACY;
  if (!mixedCleared) return "mixed";

  return "time_pressured";
}
