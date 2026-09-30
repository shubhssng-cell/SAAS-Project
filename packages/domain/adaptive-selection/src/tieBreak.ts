import type { ExposureCounts } from "./exposure.js";
import { ADAPTIVE_SELECTION_CONSTANTS, DIFFICULTY_TIER_ORDER, type AdaptiveCandidateQuestion, type DifficultyTier } from "./types.js";

/**
 * Excludes candidates already attempted at least
 * `ADAPTIVE_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT` times — but
 * ONLY when at least one non-overused alternative remains in the pool,
 * mirroring `@ipmat/repair-selection`'s `applyOveruseAvoidance()` exactly
 * (never allowed to empty a bucket down to zero candidates; repeating a
 * well-targeted question is still better than returning nothing).
 *
 * Phase 3 Unit 4: this stays WITHIN one reason bucket on purpose. An overused
 * candidate that satisfies a real need still beats an unseen candidate that
 * satisfies only a weaker need -- novelty never defeats an active need.
 */
export function applyOveruseAvoidance(pool: AdaptiveCandidateQuestion[], exposure: ExposureCounts): AdaptiveCandidateQuestion[] {
  const notOverused = pool.filter((c) => (exposure.byQuestionId.get(c.question.questionId) ?? 0) < ADAPTIVE_SELECTION_CONSTANTS.OVERUSE_MIN_ATTEMPT_COUNT);
  return notOverused.length > 0 ? notOverused : pool;
}

function tierRank(tier: DifficultyTier): number {
  return DIFFICULTY_TIER_ORDER.indexOf(tier);
}

function difficultyDistance(a: DifficultyTier, b: DifficultyTier): number {
  return Math.abs(tierRank(a) - tierRank(b));
}

export interface RankCandidatesOptions {
  exposure: ExposureCounts;
  /** Selection is GLOBAL (candidates can span multiple concepts), so the progression target tier is looked up PER CANDIDATE by its own `conceptName` — never one shared tier assumed for the whole pool. Missing entries default to `"standard"`, the same safe default `computeProgressionTargetTier()` itself returns for a concept with no mastery data. */
  progressionTargetTierByConcept: Map<string, DifficultyTier>;
  /** Phase 3 Unit 4: the tier the student last answered on each concept. Only consulted when `remediation` is true. */
  lastGradedTierByConcept?: Map<string, DifficultyTier>;
  /** Phase 3 Unit 4: true when the winning reason is a remediation reason (see `REMEDIATION_REASONS`): difficulty fit is then measured against the LAST GRADED tier, not the progression target. */
  remediation?: boolean;
}

/**
 * Deterministic ordering within one winning reason-bucket, as FIXED, NAMED, LEXICOGRAPHIC stages (Phase 3 Unit 4) — never a weighted
 * composite score, the same shape `@ipmat/repair-selection`'s `pickWinner()` uses. A later stage only decides when every earlier stage ties:
 *
 * 1. DIFFICULTY FIT. Remediation buckets: a candidate harder than the tier last answered on its concept sorts after every one that is not,
 *    then by distance to that last tier (same tier, then nearest). Every other bucket: distance to the concept's progression target tier.
 *    Fit comes BEFORE coverage: a novel question at the wrong level must not beat a right-level one (novelty never blindly wins).
 * 2. PATTERN-FAMILY coverage: fewer prior attempts in the candidate's family first.
 * 3. TAXONOMY-CELL coverage: fewer prior attempts in its exact cell first (the finer grain, so it only breaks family ties).
 * 4. QUESTION exposure: fewer prior attempts at this exact question first (graded overuse, on top of the binary overuse filter).
 * 5. EASIER first: on an otherwise equal fit, the lower tier (never gratuitously aggressive).
 * 6. Lexicographically smaller `questionId` — a final, fully deterministic tie-break that always yields exactly one ordering.
 *
 * Returns the FULL pool in ranked order (not just the winner) so a caller can report `rankedAlternatives` for explainability/testing.
 */
export function rankCandidates(pool: AdaptiveCandidateQuestion[], options: RankCandidatesOptions): AdaptiveCandidateQuestion[] {
  const fit = (c: AdaptiveCandidateQuestion): number => {
    const last = options.remediation ? options.lastGradedTierByConcept?.get(c.question.conceptName) : undefined;
    if (last) return (tierRank(c.question.difficultyTier) > tierRank(last) ? 100 : 0) + difficultyDistance(c.question.difficultyTier, last);
    return difficultyDistance(c.question.difficultyTier, options.progressionTargetTierByConcept.get(c.question.conceptName) ?? "standard");
  };
  const count = (m: Map<string, number>, k: string): number => m.get(k) ?? 0;
  return [...pool].sort((a, b) => {
    const fitDiff = fit(a) - fit(b);
    if (fitDiff !== 0) return fitDiff;
    const familyDiff = count(options.exposure.byPatternFamilyName, a.question.patternFamilyName) - count(options.exposure.byPatternFamilyName, b.question.patternFamilyName);
    if (familyDiff !== 0) return familyDiff;
    const cellDiff = count(options.exposure.byTaxonomyCellId, a.question.patternTaxonomyCellId) - count(options.exposure.byTaxonomyCellId, b.question.patternTaxonomyCellId);
    if (cellDiff !== 0) return cellDiff;
    const questionDiff = count(options.exposure.byQuestionId, a.question.questionId) - count(options.exposure.byQuestionId, b.question.questionId);
    if (questionDiff !== 0) return questionDiff;
    const easier = tierRank(a.question.difficultyTier) - tierRank(b.question.difficultyTier);
    if (easier !== 0) return easier;
    return a.question.questionId.localeCompare(b.question.questionId);
  });
}
