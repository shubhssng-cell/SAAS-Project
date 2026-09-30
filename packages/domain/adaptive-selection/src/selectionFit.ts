import { highestDemonstratedTier } from "./accumulatedEvidence.js";
import type { TrendEvidence } from "./trendEvidence.js";
import {
  DIFFICULTY_TIER_ORDER,
  type AdaptiveCandidateQuestion,
  type DifficultyTier,
  type MasteryStateResult,
  type RecentEvidence,
  type TrainingNeedReasonCode
} from "./types.js";

/**
 * PHASE 3 UNIT 4 -- the DIFFICULTY-FIT stage of selection.
 *
 * Before this stage a candidate's bucket was decided by its highest-priority reason alone, and a reason says nothing about difficulty:
 * a student with an accuracy problem at the "standard" tier satisfied `accuracy_weakness` with an "advanced" question too (pushed
 * upward), and a student who had demonstrated the standard tier satisfied `coverage_gap` with a basic, never-seen question (pulled
 * back down) that outranked the genuine progression step. This stage removes exactly those two mismatches -- nothing else:
 *
 *   too_aggressive_for_remediation   A candidate HARDER than the tier the student last answered on that concept loses its REMEDIATION
 *                                    reasons (`repeated_error`, `recent_deterioration`, `accuracy_weakness`, `speed_weakness`,
 *                                    `prerequisite_weakness`) -- provided another eligible candidate on the same concept is not harder.
 *   below_progression_level /        When a concept is PROGRESSION-READY, a candidate EASIER than (below_) or HARDER than (above_) its
 *   above_progression_level          progression target tier loses its EXPLORATION reasons (`coverage_gap`, `underexposure`, `pressure_gap`,
 *                                    `novelty_gap`, `recent_correct_on_pace`) -- provided the pool has a question at the concept BAND: the target tier, or the demonstrated tier when nothing sits at the target.
 *
 * "Progression-ready" = the student has a demonstrated tier on the concept (the EXISTING `highestDemonstratedTier()` rule: >= 3 graded
 * attempts on a tier at >= 0.8) AND the concept shows no active problem: the trend is not `deteriorating`/`persistent_difficulty` and the
 * latest attempt on the concept was not incorrect / skipped / slow. Both rules are GUARDED by "an alternative exists": when no suitable
 * alternative is in the pool the reasons are kept (a thin pool must still yield an answer) and nothing is hidden -- the adjustments that DID
 * happen are returned for explainability. A reason is never ADDED here, and `repair_priority` / recent-attempt reasons are never touched.
 *
 * Purely a function of already-derived evidence: no stored state, no score, no new Question DNA.
 */

export const REMEDIATION_REASONS: TrainingNeedReasonCode[] = ["repeated_error", "recent_deterioration", "accuracy_weakness", "speed_weakness", "prerequisite_weakness"];
export const EXPLORATION_REASONS: TrainingNeedReasonCode[] = ["coverage_gap", "underexposure", "pressure_gap", "novelty_gap", "recent_correct_on_pace"];

export type DifficultyFitRule = "too_aggressive_for_remediation" | "below_progression_level" | "above_progression_level";

export interface DifficultyFitAdjustment {
  questionId: string;
  rule: DifficultyFitRule;
  reasonsRemoved: TrainingNeedReasonCode[];
}

const rank = (tier: DifficultyTier): number => DIFFICULTY_TIER_ORDER.indexOf(tier);

export interface DifficultyFitContext {
  masteryByConcept: Map<string, MasteryStateResult>;
  trendByConcept: Map<string, TrendEvidence>;
  recentEvidence: RecentEvidence | null;
  progressionTargetTierByConcept: Map<string, DifficultyTier>;
}

/** Whether the concept is progression-ready (see the file comment). Exported so the rule is testable on its own. */
export function isProgressionReady(conceptName: string, ctx: Pick<DifficultyFitContext, "masteryByConcept" | "trendByConcept" | "recentEvidence">): boolean {
  if (!highestDemonstratedTier(ctx.masteryByConcept.get(conceptName))) return false;
  const kind = ctx.trendByConcept.get(conceptName)?.kind;
  if (kind === "deteriorating" || kind === "persistent_difficulty") return false;
  const recent = ctx.recentEvidence;
  if (recent && recent.question.conceptName === conceptName && (recent.signal === "incorrect" || recent.signal === "skipped" || recent.signal === "correct_slow")) return false;
  return true;
}

export function applyDifficultyFit(
  eligible: AdaptiveCandidateQuestion[],
  reasonsByQuestionId: Map<string, TrainingNeedReasonCode[]>,
  ctx: DifficultyFitContext
): { reasonsByQuestionId: Map<string, TrainingNeedReasonCode[]>; adjustments: DifficultyFitAdjustment[] } {
  const adjusted = new Map<string, TrainingNeedReasonCode[]>();
  const adjustments: DifficultyFitAdjustment[] = [];

  // One pass per concept (the tiers present), instead of re-filtering the whole pool for every candidate: O(N), not O(N x concept size).
  const tiersByConcept = new Map<string, Set<number>>();
  for (const c of eligible) {
    const set = tiersByConcept.get(c.question.conceptName) ?? new Set<number>();
    set.add(rank(c.question.difficultyTier));
    tiersByConcept.set(c.question.conceptName, set);
  }
  const anyAtOrBelow = (concept: string, limit: number): boolean => [...(tiersByConcept.get(concept) ?? [])].some((r) => r <= limit);
  const anyAt = (concept: string, exact: number): boolean => tiersByConcept.get(concept)?.has(exact) ?? false;
  // The exploration BAND of a progression-ready concept (one fact per concept, computed once): its progression target tier when the pool has a
  // question there, otherwise the tier the student has already demonstrated (when the pool has one), otherwise none (nothing is adjusted).
  // The fallback matters at the top of the pool: with a demonstrated "hard" tier and no "extreme" question, a basic question must not win
  // exploration merely because nothing sits at the target.
  const bandByConcept = new Map<string, number | null>();
  const bandFor = (concept: string): number | null => {
    if (!bandByConcept.has(concept)) {
      let band: number | null = null;
      if (isProgressionReady(concept, ctx)) {
        const target = ctx.progressionTargetTierByConcept.get(concept);
        const demonstrated = highestDemonstratedTier(ctx.masteryByConcept.get(concept))?.tier;
        if (target && anyAt(concept, rank(target))) band = rank(target);
        else if (demonstrated && anyAt(concept, rank(demonstrated))) band = rank(demonstrated);
      }
      bandByConcept.set(concept, band);
    }
    return bandByConcept.get(concept) ?? null;
  };

  for (const candidate of eligible) {
    const q = candidate.question;
    const original = reasonsByQuestionId.get(q.questionId) ?? [];
    let reasons = original;

    const lastTier = ctx.trendByConcept.get(q.conceptName)?.lastGradedTier;
    if (lastTier && rank(q.difficultyTier) > rank(lastTier) && anyAtOrBelow(q.conceptName, rank(lastTier))) {
      const removed = reasons.filter((r) => REMEDIATION_REASONS.includes(r));
      if (removed.length > 0) {
        reasons = reasons.filter((r) => !removed.includes(r));
        adjustments.push({ questionId: q.questionId, rule: "too_aggressive_for_remediation", reasonsRemoved: removed });
      }
    }

    // A candidate on either side of the concept's band loses its exploration reasons (above = "too aggressive", below = "gratuitously easy");
    // a band exists only when the pool actually has a question there, so a thin pool is never emptied.
    const band = bandFor(q.conceptName);
    if (band !== null && rank(q.difficultyTier) !== band) {
      const removed = reasons.filter((r) => EXPLORATION_REASONS.includes(r));
      if (removed.length > 0) {
        reasons = reasons.filter((r) => !removed.includes(r));
        adjustments.push({ questionId: q.questionId, rule: rank(q.difficultyTier) < band ? "below_progression_level" : "above_progression_level", reasonsRemoved: removed });
      }
    }
    adjusted.set(q.questionId, reasons);
  }
  adjustments.sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)); // input-order independent
  return { reasonsByQuestionId: adjusted, adjustments };
}
