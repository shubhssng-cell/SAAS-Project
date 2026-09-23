import { computeExposureCounts } from "@ipmat/adaptive-selection";
import type { MasteryAttemptRecord } from "./types.js";

export interface RepairPriorExposureRecord {
  questionId: string;
  attemptCount: number;
}

/**
 * `@ipmat/repair-selection`'s `selectRepairQuestion()` wants prior
 * exposure as `{questionId, attemptCount}[]` for its own overuse
 * avoidance. Rather than counting attempt records a THIRD time (mastery
 * counts them for accuracy/speed, adaptive-selection counts them for its
 * own overuse/underexposure), this REUSES `@ipmat/adaptive-selection`'s
 * already-exported, already-tested `computeExposureCounts()` and simply
 * reshapes its `byQuestionId` map into the array shape repair-selection's
 * input expects — a trivial Map -> array conversion, never a
 * reimplementation of any ranking or matching logic.
 */
export function derivePriorExposureForRepair(studentId: string, attemptRecords: MasteryAttemptRecord[]): RepairPriorExposureRecord[] {
  const { byQuestionId } = computeExposureCounts(studentId, attemptRecords);
  return Array.from(byQuestionId.entries()).map(([questionId, attemptCount]) => ({ questionId, attemptCount }));
}
