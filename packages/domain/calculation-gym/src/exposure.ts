import type { MasteryAttemptRecord } from "@ipmat/training-systems";

/**
 * A small, self-contained per-questionId exposure count for THIS student,
 * independently implemented rather than importing `@ipmat/adaptive-selection`'s
 * `computeExposureCounts()` — siblings restate small counting utilities
 * rather than cross-depend on each other's packages (the same convention
 * `@ipmat/repair-selection`/`@ipmat/adaptive-selection` already established
 * between themselves; `@ipmat/training-orchestration` is the one package
 * that legitimately reuses it, because it sits ABOVE both as their
 * coordinator — this provider is a peer, not a coordinator).
 */
export function computeLocalExposureCounts(studentId: string, attemptRecords: MasteryAttemptRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    counts.set(record.contribution.questionId, (counts.get(record.contribution.questionId) ?? 0) + 1);
  }
  return counts;
}
