import type { ExposureCounts } from "./exposure.js";
import { ADAPTIVE_SELECTION_CONSTANTS, DIFFICULTY_TIER_ORDER, type AdaptiveCandidateQuestion, type DifficultyTier } from "./types.js";

/**
 * Excludes candidates already attempted at least
 * `ADAPTIVE_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT` times — but
 * ONLY when at least one non-overused alternative remains in the pool,
 * mirroring `@ipmat/repair-selection`'s `applyOveruseAvoidance()` exactly
 * (never allowed to empty a bucket down to zero candidates; repeating a
 * well-targeted question is still better than returning nothing).
 */
export function applyOveruseAvoidance(pool: AdaptiveCandidateQuestion[], exposure: ExposureCounts): AdaptiveCandidateQuestion[] {
  const notOverused = pool.filter((c) => (exposure.byQuestionId.get(c.question.questionId) ?? 0) < ADAPTIVE_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT);
  return notOverused.length > 0 ? notOverused : pool;
}

function difficultyDistance(a: DifficultyTier, b: DifficultyTier): number {
  return Math.abs(DIFFICULTY_TIER_ORDER.indexOf(a) - DIFFICULTY_TIER_ORDER.indexOf(b));
}

export interface RankCandidatesOptions {
  exposure: ExposureCounts;
  /** Selection is GLOBAL (candidates can span multiple concepts), so the progression target tier is looked up PER CANDIDATE by its own `conceptName` — never one shared tier assumed for the whole pool. Missing entries default to `"standard"`, the same safe default `computeProgressionTargetTier()` itself returns for a concept with no mastery data. */
  progressionTargetTierByConcept: Map<string, DifficultyTier>;
}

/**
 * Deterministic tie-breaking within one winning reason-bucket, in a FIXED,
 * documented priority order — never a weighted composite score
 * (requirement 12), the same shape `@ipmat/repair-selection`'s
 * `pickWinner()` uses:
 *
 * 1. Prefer the candidate whose PATTERN FAMILY has fewer prior attempts
 *    by this student (coverage preference — a less-explored family wins
 *    over a well-trodden one within the same need bucket).
 * 2. Prefer the candidate whose `difficultyTier` is closer to ITS OWN
 *    concept's progression target tier (appropriate difficulty proximity
 *    — never "harder is always better").
 * 3. Prefer the lexicographically smaller `questionId` — a final, fully
 *    deterministic tie-break that always yields exactly one ordering.
 *
 * Returns the FULL pool in ranked order (not just the winner) so a caller
 * can report `rankedAlternatives` for explainability/testing.
 */
export function rankCandidates(pool: AdaptiveCandidateQuestion[], options: RankCandidatesOptions): AdaptiveCandidateQuestion[] {
  return [...pool].sort((a, b) => {
    const familyDiff =
      (options.exposure.byPatternFamilyName.get(a.question.patternFamilyName) ?? 0) -
      (options.exposure.byPatternFamilyName.get(b.question.patternFamilyName) ?? 0);
    if (familyDiff !== 0) return familyDiff;

    const targetA = options.progressionTargetTierByConcept.get(a.question.conceptName) ?? "standard";
    const targetB = options.progressionTargetTierByConcept.get(b.question.conceptName) ?? "standard";
    const distDiff = difficultyDistance(a.question.difficultyTier, targetA) - difficultyDistance(b.question.difficultyTier, targetB);
    if (distDiff !== 0) return distDiff;

    return a.question.questionId.localeCompare(b.question.questionId);
  });
}
