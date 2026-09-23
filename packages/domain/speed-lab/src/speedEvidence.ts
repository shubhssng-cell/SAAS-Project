import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import type { MasteryAttemptRecord } from "@ipmat/training-systems";
import { SPEED_LAB_CONSTANTS } from "./constants.js";
import { computeSpeedRatio } from "./speedRatio.js";
import type { SpeedEvidenceSlice } from "./types.js";

/**
 * The EXACT, immutable denominator population (docs/DECISIONS.md D-055
 * adjustment 3) — every condition below is required, none optional, and
 * NOTHING outside this population may influence the slow fraction.
 * Deliberately independent of correctness: an incorrect-but-otherwise-
 * eligible attempt is still counted here (diluting the fraction if it
 * never becomes a `correctSlow`), never silently dropped.
 */
function isEligible(record: MasteryAttemptRecord, studentId: string, conceptName: string): boolean {
  const contribution = record.contribution;
  if (contribution.studentId !== studentId) return false;
  if (record.question.conceptName !== conceptName) return false;
  if (contribution.status !== "submitted") return false;
  if (contribution.isCorrect === null) return false;
  if (computeSpeedRatio(contribution.timeTakenSeconds, contribution.expectedTimeSeconds) === null) return false;
  if (contribution.hintsUsed > 0) return false;
  if (record.question.testingModes.includes("time_pressured")) return false;
  if (record.question.difficultyDimensions.conceptualLoad >= SPEED_LAB_CONSTANTS.LOW_CONCEPTUAL_LOAD_THRESHOLD) return false;
  return true;
}

/**
 * Splits this student's eligible attempts for ONE concept into
 * correct-and-slow (the ONLY population that can trigger applicability —
 * accurate but consistently too slow is unambiguous speed evidence
 * because correctness rules out "didn't know how") and incorrect-and-slow
 * (diagnostic-only, surfaced but NEVER used to trigger or block
 * applicability — wrongness may reflect a conceptual or calculation
 * difficulty this provider cannot, and does not claim to, distinguish
 * from observable data alone).
 */
export function computeSpeedEvidence(conceptName: string, studentId: string, attemptRecords: MasteryAttemptRecord[]): SpeedEvidenceSlice {
  const eligible = attemptRecords.filter((r) => isEligible(r, studentId, conceptName));
  const eligibleGradedCount = eligible.length;

  let correctSlowCount = 0;
  let incorrectSlowCount = 0;
  for (const record of eligible) {
    const ratio = computeSpeedRatio(record.contribution.timeTakenSeconds, record.contribution.expectedTimeSeconds) as number;
    if (ratio < AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO) continue;
    if (record.contribution.isCorrect === true) correctSlowCount += 1;
    else incorrectSlowCount += 1;
  }

  const slowFraction = eligibleGradedCount >= MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT ? correctSlowCount / eligibleGradedCount : null;

  return { eligibleGradedCount, correctSlowCount, incorrectSlowCount, slowFraction };
}
