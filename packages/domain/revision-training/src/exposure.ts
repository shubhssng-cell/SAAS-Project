import type { MasteryAttemptRecord } from "@ipmat/training-systems";

/** Per-questionId attempt count for THIS student (independently implemented -- Revision is a peer provider and never imports a sibling's helper, D-081). */
export function computeLocalExposureCounts(studentId: string, attemptRecords: readonly MasteryAttemptRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    counts.set(record.contribution.questionId, (counts.get(record.contribution.questionId) ?? 0) + 1);
  }
  return counts;
}

/** The `patternTaxonomyCellId`s this student has already attempted (graded only) for the target concept -- the "seen surface" set. */
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
