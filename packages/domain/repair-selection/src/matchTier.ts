import type { AutopsyQuestionContext, RepairMatchTier, RepairPlan } from "./types.js";

/**
 * Six explicit, named tiers, ORDERED most to least specific — a fixed
 * classification rule, never a black-box numeric score (Phase 5C-2 §5).
 * A repair question is always preferred in this order:
 *
 * 1. `direct_cell_and_trap` — the EXACT diagnosed taxonomy cell (and the
 *    confirmed error category too, when one was targeted at all).
 * 2. `direct_cell` — the exact diagnosed cell, but its trap code doesn't
 *    match the targeted error category (or the cell simply has none).
 * 3. `pattern_family_and_trap` — same structural pattern family AND the
 *    same confirmed error category: this is the "repeated error
 *    category" repair case (§2), one level broader than an exact cell.
 * 4. `trap_only` — the SAME confirmed error category in a DIFFERENT
 *    pattern family. Ranked above a bare pattern-family match on the
 *    judgment that repairing the actual diagnosed error is more directly
 *    relevant than merely repairing the same question structure without
 *    addressing why the student got it wrong — a documented design
 *    choice (docs/DECISIONS.md D-044), not an arbitrary weight.
 * 5. `pattern_family` — same structure, no error-category signal at all.
 * 6. `concept_fallback` — same concept only. The ONE deliberate fallback
 *    tier (Phase 5C-2 §4): every candidate that reaches this function
 *    lands in SOME tier, and this is the catch-all, so "no suitable
 *    question" is reported only when the concept/training-mode gates
 *    upstream in `selectRepairQuestion.ts` already eliminated every
 *    candidate before tiering is ever reached.
 */
export const REPAIR_MATCH_TIER_ORDER: RepairMatchTier[] = [
  "direct_cell_and_trap",
  "direct_cell",
  "pattern_family_and_trap",
  "trap_only",
  "pattern_family",
  "concept_fallback"
];

export function classifyMatchTier(question: AutopsyQuestionContext, plan: RepairPlan): RepairMatchTier {
  const cellMatch = question.patternTaxonomyCellId === plan.targetTaxonomyCellId;
  const familyMatch = question.patternFamilyName === plan.targetPatternFamilyName;
  const trapTargeted = plan.targetErrorTaxonomyCode !== null;
  const trapMatch = trapTargeted && question.trapErrorTaxonomyCode === plan.targetErrorTaxonomyCode;

  if (cellMatch && (!trapTargeted || trapMatch)) return "direct_cell_and_trap";
  if (cellMatch) return "direct_cell";
  if (familyMatch && trapMatch) return "pattern_family_and_trap";
  if (trapMatch) return "trap_only";
  if (familyMatch) return "pattern_family";
  return "concept_fallback";
}
