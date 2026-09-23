import type { MasteryAttemptRecord } from "@ipmat/training-systems";

/**
 * A small, self-contained per-questionId exposure count for THIS student,
 * independently implemented rather than importing any sibling provider's
 * exposure helper — Pressure Training is a peer provider, not a
 * coordinator, and never introduces a peer-to-peer dependency to reuse a
 * few lines of counting logic (docs/DECISIONS.md D-054/D-055/D-056/D-058,
 * D-061).
 */
export function computeLocalExposureCounts(studentId: string, attemptRecords: readonly MasteryAttemptRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    counts.set(record.contribution.questionId, (counts.get(record.contribution.questionId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which `patternTaxonomyCellId`s this student has ALREADY attempted
 * (graded only) for the target concept — the anti-repetition "seen
 * surface" set `selection.ts` uses to prefer variation.
 */
export function computeSeenTaxonomyCellsForConcept(studentId: string, attemptRecords: readonly MasteryAttemptRecord[], conceptName: string): Set<string> {
  const seen = new Set<string>();
  for (const record of attemptRecords) {
    const contribution = record.contribution;
    if (contribution.studentId !== studentId) continue;
    if (contribution.status !== "submitted" || contribution.isCorrect === null) continue;
    if (record.question.conceptName !== conceptName) continue;
    seen.add(record.question.patternTaxonomyCellId);
  }
  return seen;
}
