import { getPrerequisites, type ConceptGraph } from "@ipmat/concept-graph";
import { buildRepairContext } from "./repairContext.js";
import { HypothesisError, type AutopsyHypothesis, type AutopsyOutput, type RepairPlan } from "./types.js";

export interface BuildRepairPlanOptions {
  /** When supplied, real concept-graph prerequisites for the target concept are looked up (`getPrerequisites()`) rather than left empty — reuses the EXISTING concept graph, never a second one (Phase 5B §18). */
  graph?: ConceptGraph;
}

/**
 * Turns a CONFIRMED diagnosis into a deterministic `RepairPlan` (Phase 5B
 * §6). Requires `hypothesis.confirmationStatus === "confirmed"` —
 * `RepairContext` (Phase 5A) can be built from evidence alone for any
 * incorrect attempt; a `RepairPlan` additionally requires the STUDENT to
 * have validated the proposed category, which is what makes
 * `targetErrorCategory` trustworthy enough to act on. A `"corrected"`
 * hypothesis is deliberately NOT accepted here — the student's free-text
 * correction has no structured category to target without another
 * (unbuilt) diagnosis pass; see docs/PHASE_5B_REVIEW.md for this scope
 * boundary.
 */
export function buildRepairPlan(
  hypothesis: AutopsyHypothesis,
  output: AutopsyOutput,
  options: BuildRepairPlanOptions = {}
): RepairPlan {
  if (hypothesis.confirmationStatus !== "confirmed") {
    throw new HypothesisError(
      "not_confirmed",
      `Cannot build a RepairPlan: hypothesis confirmationStatus is "${hypothesis.confirmationStatus}", not "confirmed"`
    );
  }
  if (hypothesis.attemptId !== output.attemptFacts.attemptId) {
    throw new HypothesisError(
      "mismatched_attempt",
      `Hypothesis is for attemptId="${hypothesis.attemptId}", but the supplied AutopsyOutput is for attemptId="${output.attemptFacts.attemptId}"`
    );
  }
  if (hypothesis.proposedErrorCategory === null) {
    throw new HypothesisError(
      "no_error_category",
      "Cannot build a RepairPlan: the confirmed hypothesis has no proposed error category to target"
    );
  }
  if (hypothesis.respondedAt === null) {
    // Structurally unreachable given confirmationStatus === "confirmed" always sets respondedAt,
    // but checked explicitly rather than asserted with `!`, consistent with this codebase's fail-closed style.
    throw new HypothesisError("not_confirmed", "Confirmed hypothesis is missing a confirmation timestamp");
  }

  const context = buildRepairContext(output);
  const prerequisites = options.graph ? getPrerequisites(options.graph, output.questionFacts.conceptName) : [];

  return {
    targetConceptName: context.targetConceptName,
    targetPatternFamilyName: context.targetPatternFamilyName,
    targetTaxonomyCellId: context.targetTaxonomyCellId,
    targetErrorCategory: hypothesis.proposedErrorCategory,
    targetErrorTaxonomyCode: output.candidateErrorEvidence?.proposedErrorTaxonomyCode ?? null,
    recommendedTrainingMode: context.recommendedTrainingMode,
    priority: context.priority,
    rationale: [...context.supportingEvidence, `Student confirmed this hypothesis at ${hypothesis.respondedAt}.`],
    prerequisites,
    confirmationSource: { attemptId: hypothesis.attemptId, hypothesisConfirmedAt: hypothesis.respondedAt }
  };
}
