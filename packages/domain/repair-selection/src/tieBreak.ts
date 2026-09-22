import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import type { BehaviorSignals, DifficultyTier, RepairCandidateQuestion, RepairPriorExposureRecord } from "./types.js";
import { REPAIR_SELECTION_CONSTANTS } from "./types.js";

/**
 * A speed weakness is recognized ONLY from the SAME `behaviorSignals` the
 * confirmed diagnosis was built from, using the SAME threshold
 * `@ipmat/autopsy` itself already uses to derive `correctSlow`/
 * `incorrectSlow` (`AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO`) — never a second,
 * independently invented number. Absent signals mean "no speed weakness
 * was observed," not "assume one."
 */
export function detectSpeedProblem(signals?: BehaviorSignals | null): boolean {
  if (!signals) return false;
  return Boolean(signals.correctSlow || signals.incorrectSlow || (signals.speedRatio !== null && signals.speedRatio >= AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO));
}

/**
 * Excludes candidates the student has already attempted at least
 * `REPAIR_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT` times — but ONLY
 * when at least one non-overused alternative remains in the pool (point O:
 * "avoided when enough alternatives exist"). Never allowed to empty a
 * match tier down to zero candidates — repeating a well-targeted question
 * is still better than falling through to a less-targeted one.
 */
export function applyOveruseAvoidance(pool: RepairCandidateQuestion[], priorExposure: RepairPriorExposureRecord[]): RepairCandidateQuestion[] {
  const exposureById = new Map(priorExposure.map((e) => [e.questionId, e.attemptCount]));
  const notOverused = pool.filter((c) => (exposureById.get(c.question.questionId) ?? 0) < REPAIR_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT);
  return notOverused.length > 0 ? notOverused : pool;
}

/**
 * A deliberate, explicit rank order for tie-breaking on "difficulty
 * suitability" only — not a claim that these tiers are linearly ordered by
 * inherent difficulty in general (docs/DECISIONS.md D-021 already flags
 * difficulty dimensions as provisional). This is scoped narrowly to
 * "which of these candidates is closer to the originally diagnosed
 * question's tier," nothing more.
 */
const DIFFICULTY_RANK: DifficultyTier[] = ["standard", "advanced", "hard", "extreme", "novel"];

function difficultyDistance(a: DifficultyTier, b: DifficultyTier): number {
  return Math.abs(DIFFICULTY_RANK.indexOf(a) - DIFFICULTY_RANK.indexOf(b));
}

export interface PickWinnerOptions {
  speedProblem: boolean;
  targetDifficultyTier?: DifficultyTier | null;
}

/**
 * Deterministic tie-breaking, in a FIXED, documented priority order — never
 * a weighted composite score (Phase 5C-2 §5):
 *
 * 1. If a speed weakness was detected, prefer the candidate with the
 *    SHORTER `expectedTimeSeconds` (forces faster resolution practice).
 * 2. Prefer the candidate whose `difficultyTier` is closer to the
 *    originally diagnosed question's tier, when supplied.
 * 3. Prefer the lexicographically smaller `questionId` — a final,
 *    fully deterministic tie-breaker that always yields exactly one
 *    winner, making every selection reproducible and testable.
 */
export function pickWinner(pool: RepairCandidateQuestion[], options: PickWinnerOptions): RepairCandidateQuestion {
  const sorted = [...pool].sort((a, b) => {
    if (options.speedProblem) {
      const timeDiff = a.expectedTimeSeconds - b.expectedTimeSeconds;
      if (timeDiff !== 0) return timeDiff;
    }
    if (options.targetDifficultyTier) {
      const distDiff =
        difficultyDistance(a.question.difficultyTier, options.targetDifficultyTier) -
        difficultyDistance(b.question.difficultyTier, options.targetDifficultyTier);
      if (distDiff !== 0) return distDiff;
    }
    return a.question.questionId.localeCompare(b.question.questionId);
  });

  const [winner] = sorted;
  if (!winner) {
    throw new Error("pickWinner() called with an empty candidate pool — this is a caller invariant violation, not a valid 'no match' outcome.");
  }
  return winner;
}
