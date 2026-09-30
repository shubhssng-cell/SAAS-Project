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
 *                                    `novelty_gap`, `recent_correct_on_pace`) -- provided another eligible candidate on the concept is AT the target tier.
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

  for (const candidate of eligible) {
    const q = candidate.question;
    const original = reasonsByQuestionId.get(q.questionId) ?? [];
    let reasons = original;
    const sameConcept = eligible.filter((c) => c.question.conceptName === q.conceptName);

    const lastTier = ctx.trendByConcept.get(q.conceptName)?.lastGradedTier;
    if (lastTier && rank(q.difficultyTier) > rank(lastTier) && sameConcept.some((c) => rank(c.question.difficultyTier) <= rank(lastTier))) {
      const removed = reasons.filter((r) => REMEDIATION_REASONS.includes(r));
      if (removed.length > 0) {
        reasons = reasons.filter((r) => !removed.includes(r));
        adjustments.push({ questionId: q.questionId, rule: "too_aggressive_for_remediation", reasonsRemoved: removed });
      }
    }

    // The exploration band for a progression-ready concept is EXACTLY its target tier (one step up): a candidate on either side of it loses its
    // exploration reasons, provided an at-target alternative exists. Above-target is "too aggressive" (a two-step jump), below is "gratuitously easy".
    const target = ctx.progressionTargetTierByConcept.get(q.conceptName);
    if (target && rank(q.difficultyTier) !== rank(target) && isProgressionReady(q.conceptName, ctx) && sameConcept.some((c) => rank(c.question.difficultyTier) === rank(target))) {
      const removed = reasons.filter((r) => EXPLORATION_REASONS.includes(r));
      if (removed.length > 0) {
        reasons = reasons.filter((r) => !removed.includes(r));
        adjustments.push({ questionId: q.questionId, rule: rank(q.difficultyTier) < rank(target) ? "below_progression_level" : "above_progression_level", reasonsRemoved: removed });
      }
    }
    adjusted.set(q.questionId, reasons);
  }
  adjustments.sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)); // input-order independent
  return { reasonsByQuestionId: adjusted, adjustments };
}
