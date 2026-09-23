import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import type { MasteryAttemptRecord } from "@ipmat/training-systems";
import { SPEED_LAB_CONSTANTS } from "./constants.js";
import { computeSpeedRatio } from "./speedRatio.js";
import type { SpeedLabStage } from "./types.js";

/** Correct, hint-free, non-time-pressured, validly-timed attempts for this student/concept -- the shared base filter both progression gates narrow further. */
function baseProgressionPool(conceptName: string, studentId: string, attemptRecords: MasteryAttemptRecord[]): MasteryAttemptRecord[] {
  return attemptRecords.filter((r) => {
    const c = r.contribution;
    if (c.studentId !== studentId) return false;
    if (r.question.conceptName !== conceptName) return false;
    if (c.status !== "submitted" || c.isCorrect !== true) return false;
    if (computeSpeedRatio(c.timeTakenSeconds, c.expectedTimeSeconds) === null) return false;
    if (c.hintsUsed > 0) return false;
    if (r.question.testingModes.includes("time_pressured")) return false;
    return true;
  });
}

function isGoodPace(record: MasteryAttemptRecord): boolean {
  return (computeSpeedRatio(record.contribution.timeTakenSeconds, record.contribution.expectedTimeSeconds) as number) <= SPEED_LAB_CONSTANTS.GOOD_PACE_SPEED_RATIO;
}

function goodPaceCount(records: MasteryAttemptRecord[]): number {
  return records.filter(isGoodPace).length;
}

/**
 * Determines which stage of speed training to give the student next,
 * gating EACH transition on its own independent, DISJOINT evidence slice
 * (docs/DECISIONS.md D-055) -- mirroring `@ipmat/calculation-gym`'s own
 * foundational/mixed split (D-054), never reusing the SAME slice for two
 * gates:
 *
 * - `steady_pace -> mixed_pace`: requires at least
 *   `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` good-paced attempts
 *   on LOW-conceptualLoad content.
 * - `mixed_pace -> time_constrained`: requires its OWN, SEPARATE count of
 *   good-paced attempts on the COMPLEMENTARY (moderate/high)
 *   conceptualLoad slice -- disjoint from the steady-pace slice, so
 *   clearing `steady_pace` never contributes to this gate. Clearing
 *   `steady_pace` is necessary but never sufficient on its own.
 *
 * These gates are deliberately COUNT-based (see `constants.ts`), not
 * rate-based -- a rate-based gate would directly contradict
 * `evaluateSpeedLab()`'s own applicability trigger over the same
 * population. Under insufficient evidence at any gate, returns the
 * highest stage whose own gate actually cleared, defaulting to
 * `steady_pace`.
 */
export function determineSpeedLabStage(conceptName: string, studentId: string, attemptRecords: MasteryAttemptRecord[]): SpeedLabStage {
  const base = baseProgressionPool(conceptName, studentId, attemptRecords);

  const steadyShaped = base.filter((r) => r.question.difficultyDimensions.conceptualLoad < SPEED_LAB_CONSTANTS.LOW_CONCEPTUAL_LOAD_THRESHOLD);
  const steadyCleared = goodPaceCount(steadyShaped) >= MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT;
  if (!steadyCleared) return "steady_pace";

  const broaderShaped = base.filter((r) => r.question.difficultyDimensions.conceptualLoad >= SPEED_LAB_CONSTANTS.LOW_CONCEPTUAL_LOAD_THRESHOLD);
  const mixedCleared = goodPaceCount(broaderShaped) >= MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT;
  if (!mixedCleared) return "mixed_pace";

  return "time_constrained";
}
