import type { MasteryStatePersistenceRecord, MasteryStateResult } from "./types.js";

/**
 * Maps a `MasteryStateResult` to the exact shape a Prisma adapter would
 * write to `mastery_states` — requires the new `component_detail` column
 * (migration `0004_mastery_component_detail`, generated but NOT applied;
 * no live database has ever been reachable — see docs/PHASE_5B_REVIEW.md
 * §5). NOTHING calls `prisma.masteryState.upsert()` anywhere in this
 * package; no adapter is implemented this phase.
 *
 * Returns `null` — writes NOTHING — when any of the 5 headline measures is
 * still `null` (insufficient data). The real `mastery_states.accuracy`/
 * `speed_ratio`/`novelty_handling`/`pressure_performance`/
 * `pattern_coverage` columns are all NON-NULLABLE `Float`; writing a
 * default like `0` for "we don't know yet" would misrepresent "no data"
 * as "0% mastery" — exactly the kind of misleading collapse this phase
 * was told to avoid. This is a real, documented tension between the
 * existing schema and this phase's deliberately-nullable domain model,
 * not silently resolved here: a future persistence adapter may need
 * either a smarter per-field write policy or to widen these columns to
 * nullable `Float` — a decision for whoever builds that adapter, not made
 * unilaterally in this phase.
 */
export function toMasteryStatePersistenceRecord(result: MasteryStateResult): MasteryStatePersistenceRecord | null {
  const { accuracy, speedRatio, noveltyHandling, pressurePerformance, patternCoverage } = result.measures;
  if (accuracy === null || speedRatio === null || noveltyHandling === null || pressurePerformance === null || patternCoverage === null) {
    return null;
  }

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
