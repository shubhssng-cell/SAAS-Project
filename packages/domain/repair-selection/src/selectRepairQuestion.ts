import type { AutopsyQuestionContext, RecommendedTrainingMode, RepairPlan } from "@ipmat/autopsy";
import { validateRepairCandidateQuestion } from "./candidateValidation.js";
import { classifyMatchTier, REPAIR_MATCH_TIER_ORDER } from "./matchTier.js";
import { applyOveruseAvoidance, detectSpeedProblem, pickWinner } from "./tieBreak.js";
import {
  RepairSelectionError,
  type RepairCandidateQuestion,
  type RepairMatchTier,
  type RepairSelectionInput,
  type RepairSelectionOutcome,
  type RepairSelectionResult
} from "./types.js";

/**
 * `buildRepairPlan()` (`@ipmat/autopsy`, Phase 5B) is the ONLY function
 * that constructs a `RepairPlan`, and it refuses unless
 * `hypothesis.confirmationStatus === "confirmed"` — a plan it produces
 * always carries a real `confirmationSource.hypothesisConfirmedAt`.
 * TypeScript's structural typing cannot stop a caller from constructing a
 * `RepairPlan`-shaped object some OTHER way, bypassing that gate entirely
 * — this is this package's OWN re-verification of the same invariant at
 * its own boundary, the same defense-in-depth discipline `@ipmat/db`'s
 * repository layer already applies for the identical reason (docs/
 * DECISIONS.md D-043). Awaiting/rejected/corrected hypotheses never reach
 * this point at all in practice, because `buildRepairPlan()` itself
 * already refused to construct a `RepairPlan` for any of them — this is
 * the second, independent line of defense, not the first.
 */
function assertRepairPlanConfirmed(plan: RepairPlan): void {
  if (!plan.confirmationSource?.hypothesisConfirmedAt) {
    throw new RepairSelectionError(
      "not_confirmed",
      "Cannot select a repair question from a RepairPlan without confirmationSource.hypothesisConfirmedAt — a RepairPlan must be built via buildRepairPlan() (@ipmat/autopsy) from a confirmed hypothesis."
    );
  }
}

function satisfiesTrainingMode(question: AutopsyQuestionContext, mode: RecommendedTrainingMode): boolean {
  switch (mode) {
    case "timed_pressure_drill":
      return question.testingModes.includes("time_pressured");
    case "novelty_exposure":
      return question.noveltyLevel !== "standard";
    case "guided_hint_first":
    case "standard_practice":
      return true;
  }
}

function explainTier(tier: RepairMatchTier, plan: RepairPlan): string {
  switch (tier) {
    case "direct_cell_and_trap":
      return plan.targetErrorTaxonomyCode
        ? `Matches the exact diagnosed taxonomy cell (${plan.targetTaxonomyCellId}) and the confirmed error category ("${plan.targetErrorTaxonomyCode}").`
        : `Matches the exact diagnosed taxonomy cell (${plan.targetTaxonomyCellId}).`;
    case "direct_cell":
      return `Matches the exact diagnosed taxonomy cell (${plan.targetTaxonomyCellId}); the specific error category was not also matched.`;
    case "pattern_family_and_trap":
      return `Matches the diagnosed pattern family ("${plan.targetPatternFamilyName}") and the confirmed error category ("${plan.targetErrorTaxonomyCode}").`;
    case "trap_only":
      return `Directly matches the confirmed error category ("${plan.targetErrorTaxonomyCode}"), though in a different pattern family than the one originally diagnosed.`;
    case "pattern_family":
      return `Matches the diagnosed pattern family ("${plan.targetPatternFamilyName}"); a direct taxonomy-cell or error-category match was unavailable.`;
    case "concept_fallback":
      return `Direct repair unavailable for "${plan.targetConceptName}" (no matching pattern family or error category found); broader concept-level repair selected as a deliberate fallback.`;
  }
}

function coverageGapFor(tier: RepairMatchTier, plan: RepairPlan): string {
  switch (tier) {
    case "direct_cell_and_trap":
    case "direct_cell":
      return `Repairs the specific taxonomy cell (${plan.targetTaxonomyCellId}) this diagnosis targeted.`;
    case "pattern_family_and_trap":
    case "trap_only":
      return `Repairs the recurring "${plan.targetErrorTaxonomyCode}" error category observed on this concept.`;
    case "pattern_family":
      return `Repairs general weakness in the "${plan.targetPatternFamilyName}" pattern family.`;
    case "concept_fallback":
      return `Repairs general weakness in "${plan.targetConceptName}" broadly, since no more specific coverage gap could be matched.`;
  }
}

/**
 * The Repair Selection domain contract (Phase 5C-2). Deterministically
 * turns a CONFIRMED `RepairPlan` plus the available Question DNA into
 * either a `"selected"` outcome (one specific question, with an
 * explanation and the coverage gap it addresses) or an explicit
 * `"no_match"` outcome — never an opaque "AI chooses the question"
 * mechanism, and never a silent substitution of an unrelated question.
 *
 * Selection order (Phase 5C-2 §2/§4/§5):
 * 1. Structural validity (malformed candidates excluded, never silently accepted).
 * 2. Published + target-concept eligibility (a repair question is always about the diagnosed concept).
 * 3. The recommended training mode's hard DNA requirement (pressure -> `time_pressured`; novelty -> non-standard `noveltyLevel`), applied uniformly — never relaxed by a "fallback."
 * 4. Explicit match-tier classification (`matchTier.ts`), most to least specific — a `concept_fallback` result is always labeled as such via `isFallback`.
 * 5. Deterministic tie-breaking within the winning tier (`tieBreak.ts`): overuse avoidance, then speed-problem preference, then difficulty suitability, then questionId as the final deterministic tie-break.
 */
export function selectRepairQuestion(input: RepairSelectionInput): RepairSelectionOutcome {
  const { repairPlan, candidateQuestions, behaviorSignals, targetDifficultyTier, priorExposure = [] } = input;

  assertRepairPlanConfirmed(repairPlan);

  const structurallyValid: RepairCandidateQuestion[] = [];
  let excludedMalformedCount = 0;
  for (const candidate of candidateQuestions) {
    if (validateRepairCandidateQuestion(candidate).valid) {
      structurallyValid.push(candidate);
    } else {
      excludedMalformedCount += 1;
    }
  }

  const conceptEligible = structurallyValid.filter(
    (c) => c.validationState === "published" && c.question.conceptName === repairPlan.targetConceptName
  );

  if (conceptEligible.length === 0) {
    return {
      status: "no_match",
      reason: "no_candidates_for_concept",
      explanation: `No published, structurally valid question exists for concept "${repairPlan.targetConceptName}" — the diagnosis targets a category not represented in the available question universe.`,
      candidatesConsidered: candidateQuestions.length,
      excludedMalformedCount
    };
  }

  const trainingModeEligible = conceptEligible.filter((c) => satisfiesTrainingMode(c.question, repairPlan.recommendedTrainingMode));

  if (trainingModeEligible.length === 0) {
    return {
      status: "no_match",
      reason: "training_mode_constraint_unsatisfied",
      explanation: `${conceptEligible.length} published question(s) exist for "${repairPlan.targetConceptName}", but none satisfy the recommended training mode ("${repairPlan.recommendedTrainingMode}") this repair requires — the available questions do not satisfy the required repair constraints.`,
      candidatesConsidered: candidateQuestions.length,
      excludedMalformedCount
    };
  }

  const byTier = new Map<RepairMatchTier, RepairCandidateQuestion[]>();
  for (const candidate of trainingModeEligible) {
    const tier = classifyMatchTier(candidate.question, repairPlan);
    const bucket = byTier.get(tier) ?? [];
    bucket.push(candidate);
    byTier.set(tier, bucket);
  }

  for (const tier of REPAIR_MATCH_TIER_ORDER) {
    const bucket = byTier.get(tier);
    if (!bucket || bucket.length === 0) continue;

    const pool = applyOveruseAvoidance(bucket, priorExposure);
    const speedProblem = detectSpeedProblem(behaviorSignals);
    const winner = pickWinner(pool, { speedProblem, targetDifficultyTier });

    const result: RepairSelectionResult = {
      question: winner.question,
      matchTier: tier,
      isFallback: tier === "concept_fallback",
      targetConceptName: repairPlan.targetConceptName,
      targetPatternFamilyName: repairPlan.targetPatternFamilyName,
      targetTaxonomyCellId: repairPlan.targetTaxonomyCellId,
      targetErrorCategory: repairPlan.targetErrorCategory,
      targetErrorTaxonomyCode: repairPlan.targetErrorTaxonomyCode,
      recommendedTrainingMode: repairPlan.recommendedTrainingMode,
      priority: repairPlan.priority,
      explanation: explainTier(tier, repairPlan),
      coverageGapAddressed: coverageGapFor(tier, repairPlan),
      candidatesConsidered: candidateQuestions.length,
      excludedMalformedCount
    };
    return { status: "selected", result };
  }

  // Structurally unreachable: `classifyMatchTier()` always returns SOME tier
  // (its final fallback case is "concept_fallback", not undefined), so
  // `trainingModeEligible.length > 0` guarantees at least one non-empty
  // bucket above. Checked explicitly rather than assumed, consistent with
  // this codebase's fail-closed style (e.g. `buildRepairPlan()`'s own
  // `respondedAt === null` check).
  return {
    status: "no_match",
    reason: "no_structurally_valid_candidates",
    explanation: "No candidate could be classified into any match tier despite passing concept/training-mode eligibility — this should not be reachable.",
    candidatesConsidered: candidateQuestions.length,
    excludedMalformedCount
  };
}
