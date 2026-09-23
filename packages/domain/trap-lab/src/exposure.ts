import type { MasteryAttemptRecord } from "@ipmat/training-systems";

/**
 * A small, self-contained per-questionId exposure count for THIS student,
 * independently implemented rather than importing any sibling provider's
 * exposure helper (`@ipmat/calculation-gym`/`@ipmat/speed-lab`) -- Trap
 * Lab is a peer provider, not a coordinator, and never introduces a
 * peer-to-peer dependency to reuse a few lines of counting logic
 * (docs/DECISIONS.md D-054/D-055/D-056).
 */
export function computeLocalExposureCounts(studentId: string, attemptRecords: MasteryAttemptRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    counts.set(record.contribution.questionId, (counts.get(record.contribution.questionId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which `patternTaxonomyCellId`s this student has ALREADY attempted
 * (correct or incorrect, graded only) against the SAME trap-taxonomy
 * code -- the anti-memorization "seen surface" set `selection.ts` uses to
 * prefer variation (docs/DECISIONS.md D-056): "repeat the trap, vary the
 * surface," never "repeat the same question until correct."
 */
export function computeSeenTaxonomyCellIds(studentId: string, attemptRecords: MasteryAttemptRecord[], targetErrorTaxonomyCode: string): Set<string> {
  const seen = new Set<string>();
  for (const record of attemptRecords) {
    const contribution = record.contribution;
    if (contribution.studentId !== studentId) continue;
    if (contribution.status !== "submitted" || contribution.isCorrect === null) continue;
    if (record.question.trapErrorTaxonomyCode !== targetErrorTaxonomyCode) continue;
    seen.add(record.question.patternTaxonomyCellId);
  }
  return seen;
}
