import type { MasteryAttemptRecord } from "./types.js";

/**
 * Per-question and per-pattern-family attempt counts, derived directly
 * from the SAME `MasteryAttemptRecord[]` `@ipmat/mastery` already
 * consumes — never a second, independently-tracked exposure/history
 * input. This is the source for overuse avoidance (a specific question
 * seen too many times) and underexposure detection (a whole pattern
 * family barely touched), the same two ends of the same signal
 * `@ipmat/repair-selection`'s `RepairPriorExposureRecord` covers only the
 * first half of.
 */
export interface ExposureCounts {
  byQuestionId: Map<string, number>;
  byPatternFamilyName: Map<string, number>;
  /** Total attempts across every concept for this student, regardless of family/question — used to distinguish "this family is underexposed" from "this student has no history at all" (cold start), which is not a special case here but is worth being able to name explicitly in a test. */
  totalAttempts: number;
}

export function computeExposureCounts(studentId: string, attemptRecords: MasteryAttemptRecord[]): ExposureCounts {
  const byQuestionId = new Map<string, number>();
  const byPatternFamilyName = new Map<string, number>();
  let totalAttempts = 0;

  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    totalAttempts += 1;
    byQuestionId.set(record.contribution.questionId, (byQuestionId.get(record.contribution.questionId) ?? 0) + 1);
    byPatternFamilyName.set(record.question.patternFamilyName, (byPatternFamilyName.get(record.question.patternFamilyName) ?? 0) + 1);
  }

  return { byQuestionId, byPatternFamilyName, totalAttempts };
}
