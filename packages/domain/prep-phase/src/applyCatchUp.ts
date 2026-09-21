import type { CatchUpOverlayData, CatchUpResult, PrepPhaseResult } from "./types.js";

/**
 * Pure function: layers a student's catch-up overlay on top of an
 * already-computed phase, WITHOUT ever writing back to or mutating the
 * PrepPhaseTemplate the phase was derived from. `phase` here is plain data
 * (the output of computePrepPhase) — this function never receives, reads,
 * or could mutate the underlying template row (see docs/DECISIONS.md D-009).
 */
export function applyCatchUp(
  phase: PrepPhaseResult,
  catchUpPlan: CatchUpOverlayData | null
): CatchUpResult {
  if (!catchUpPlan) {
    return {
      ...phase,
      catchUpApplied: false,
      adjustedCoverage: { ...phase.expectedCoverageToday }
    };
  }

  const adjustedCoverage: Record<string, number> = { ...phase.expectedCoverageToday };
  for (const chapter of catchUpPlan.priorityChapters) {
    const base = adjustedCoverage[chapter] ?? 0;
    adjustedCoverage[chapter] = Math.min(1, base * catchUpPlan.paceMultiplier);
  }

  return {
    ...phase,
    catchUpApplied: true,
    adjustedCoverage
  };
}
