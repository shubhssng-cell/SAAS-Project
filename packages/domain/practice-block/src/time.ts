import type { PracticeBlockState } from "./types.js";

/**
 * D-060's three independently-derived, non-summing time measures, the
 * PracticeBlock half. No algebraic relationship is asserted between them —
 * a block can contain idle time before its first attempt, after its last
 * attempt, or time `timeSpentSeconds` never captured at all (corrected
 * explicitly during D-060's design review).
 *
 * Deliberately structural (no `@ipmat/attempt` import) — this package
 * stays dependency-free; callers pass whatever plain-shaped attempt data
 * they already loaded.
 */

/** `endedAt - startedAt` in whole seconds. Null while the block is still `active`. */
export function deriveBlockWallClockDurationSeconds(block: PracticeBlockState): number | null {
  if (block.endedAt === null) return null;
  const startedMs = Date.parse(block.startedAt);
  const endedMs = Date.parse(block.endedAt);
  return Math.round((endedMs - startedMs) / 1000);
}

/** `sum(Attempt.timeSpentSeconds)` across every attempt the caller supplies (the attempts belonging to this one block). Reuses the existing event-sourced field (docs/DECISIONS.md D-034); an attempt still `in_progress` contributes 0. */
export function deriveBlockActiveSolvingTimeSeconds(attempts: ReadonlyArray<{ timeSpentSeconds: number | null }>): number {
  return attempts.reduce((sum, attempt) => sum + (attempt.timeSpentSeconds ?? 0), 0);
}

export interface AttemptForGapCalculation {
  blockSequenceNumber: number;
  startedAt: string;
  /** Null for a still-`in_progress` attempt — the gap AFTER such an attempt is undefined (there is no next attempt to measure to yet), so it is simply omitted from the result, never coerced to 0. */
  finalizedAt: string | null;
}

/**
 * The gap between each attempt's `finalizedAt` and the NEXT attempt's
 * `startedAt`, ordered by `blockSequenceNumber` — computed ONLY between
 * consecutive attempts the caller has already scoped to ONE block (this
 * function does not check `practiceBlockId` itself; it trusts the caller's
 * scoping). Never computed for ordinary, non-block attempts, and never
 * inferred from raw timestamp adjacency across different blocks or
 * sessions (docs/DECISIONS.md D-060). Returns one gap per adjacent pair,
 * in sequence order; a pair whose earlier attempt was never finalized
 * contributes no gap.
 */
export function deriveInterAttemptGapsSeconds(attempts: ReadonlyArray<AttemptForGapCalculation>): number[] {
  const sorted = [...attempts].sort((a, b) => a.blockSequenceNumber - b.blockSequenceNumber);
  const gaps: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (!previous || !current || previous.finalizedAt === null) continue;
    const gapMs = Date.parse(current.startedAt) - Date.parse(previous.finalizedAt);
    gaps.push(Math.round(gapMs / 1000));
  }

  return gaps;
}
