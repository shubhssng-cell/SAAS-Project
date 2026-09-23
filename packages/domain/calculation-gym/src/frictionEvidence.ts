import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import type { MasteryAttemptRecord } from "@ipmat/training-systems";
import { CALCULATION_GYM_CONSTANTS } from "./constants.js";
import type { CalculationFrictionEvidence, ComputationalLoadSlice } from "./types.js";

function isGraded(record: MasteryAttemptRecord): boolean {
  return record.contribution.status === "submitted" && record.contribution.isCorrect !== null;
}

function buildSlice(records: MasteryAttemptRecord[]): ComputationalLoadSlice {
  const attempts = records.length;
  const correct = records.filter((r) => r.contribution.isCorrect === true).length;
  const accuracy = attempts >= MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT ? correct / attempts : null;
  return { attempts, correct, accuracy };
}

/**
 * Splits this student's graded attempts for ONE concept into a
 * high-computational-load slice and a low-computational-load slice (both
 * from Question DNA's provisional `computationalLoad` metadata — see
 * docs/DECISIONS.md D-054) and compares their accuracy. `frictionDetected`
 * is deterministic and fails closed: it is `false` whenever either slice
 * lacks enough observations to trust, never a guess from a small sample.
 */
export function computeCalculationFrictionEvidence(conceptName: string, studentId: string, attemptRecords: MasteryAttemptRecord[]): CalculationFrictionEvidence {
  const graded = attemptRecords.filter((r) => r.contribution.studentId === studentId && r.question.conceptName === conceptName && isGraded(r));

  const highLoadRecords = graded.filter((r) => r.question.difficultyDimensions.computationalLoad >= CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD);
  const lowLoadRecords = graded.filter((r) => r.question.difficultyDimensions.computationalLoad < CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD);

  const highLoad = buildSlice(highLoadRecords);
  const lowLoad = buildSlice(lowLoadRecords);

  const frictionDetected =
    highLoad.accuracy !== null && lowLoad.accuracy !== null && lowLoad.accuracy - highLoad.accuracy >= CALCULATION_GYM_CONSTANTS.CALCULATION_FRICTION_ACCURACY_GAP;

  return { conceptName, highLoad, lowLoad, frictionDetected };
}
