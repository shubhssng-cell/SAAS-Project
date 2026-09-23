import type { MasteryAttemptRecord } from "@ipmat/training-systems";

/**
 * A small, self-contained per-questionId exposure count for THIS student,
 * independently implemented rather than importing
 * `@ipmat/calculation-gym`'s or `@ipmat/adaptive-selection`'s exposure
 * helpers -- Speed Lab is a peer provider, not a coordinator, and never
 * introduces a peer-to-peer dependency to reuse a few lines of counting
 * logic (docs/DECISIONS.md D-054/D-055).
 */
export function computeLocalExposureCounts(studentId: string, attemptRecords: MasteryAttemptRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    counts.set(record.contribution.questionId, (counts.get(record.contribution.questionId) ?? 0) + 1);
  }
  return counts;
}
