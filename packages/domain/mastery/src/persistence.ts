import type { MasteryStatePersistenceRecord, MasteryStateResult } from "./types.js";

/**
 * Maps a `MasteryStateResult` to the exact shape a Prisma adapter writes to
 * `mastery_states` (the real adapter lives in `@ipmat/db` — this package
 * stays database-independent; see `@ipmat/db/src/repositories`).
 *
 * Phase 5C-1 (docs/DECISIONS.md D-043) replaced Phase 5B's all-or-nothing
 * rule — "write nothing unless every headline measure has data" — with a
 * three-state model that preserves the distinction the domain layer already
 * makes, instead of collapsing it at the persistence boundary:
 *
 *  1. **Never computed at all** — zero contributing attempts
 *     (`result.detail.totalAttempts === 0`). Nothing is written: this
 *     function returns `null` and the caller writes no row. There is
 *     nothing yet to say about this student/concept pair.
 *  2. **Computed, but insufficient evidence for this dimension** — a
 *     per-measure `null`, written as SQL `NULL` (the 5 `mastery_states`
 *     columns are nullable `Float?` as of migration
 *     `0005_mastery_state_nullable_measures`). This is NOT the same as (1):
 *     the row exists, other dimensions on it may be fully measured, and
 *     `componentDetail` always preserves the raw counts explaining *why*
 *     this one dimension is still null.
 *  3. **Measured** — a real number, including legitimately `0` (e.g. 0%
 *     accuracy after enough graded attempts). SQL `NULL` and the float
 *     `0` are never confused: `null !== 0` at both the TypeScript and SQL
 *     level, so "zero" and "unknown" stay distinguishable without a
 *     separate "is this measured" status column per field — the standard,
 *     minimal way to represent this in a relational column, and the
 *     reason a companion status column was considered and rejected (it
 *     would duplicate information `NULL` already carries unambiguously).
 *
 * Once a row is written, EVERY headline measure is included verbatim from
 * `result.measures` — some may be `null`, some may be real numbers. This is
 * the key behavior change from Phase 5B: previously ANY null component
 * blocked the ENTIRE row; now only true emptiness (no attempts at all)
 * blocks it, so a student with enough data for `accuracy` but not yet for
 * `patternCoverage` gets a row with `accuracy` populated and
 * `patternCoverage` left `NULL`, rather than nothing at all.
 */
export function toMasteryStatePersistenceRecord(result: MasteryStateResult): MasteryStatePersistenceRecord | null {
  if (result.detail.totalAttempts === 0) {
    return null;
  }

  const { accuracy, speedRatio, noveltyHandling, pressurePerformance, patternCoverage } = result.measures;

  return {
    studentId: result.studentId,
    conceptId: result.conceptId,
    accuracy,
    speedRatio,
    noveltyHandling,
    pressurePerformance,
    patternCoverage,
    componentDetail: result.detail as unknown as Record<string, unknown>,
    computedAt: result.computedAt
  };
}
