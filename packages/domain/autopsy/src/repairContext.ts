import type { AutopsyOutput, RecommendedTrainingMode, RepairContext, RepairPriority } from "./types.js";

/**
 * A simple, deterministic v1 heuristic (Phase 5A §11) — NOT a selection
 * or generation of actual follow-up questions (`followUpQuestionIds`
 * deliberately does not exist on `RepairContext`; that remains later
 * work). This identifies a TARGET and a coarse priority/mode from
 * evidence that already exists in an `AutopsyOutput` — it invents nothing
 * new, and reuses `candidateErrorEvidence`/`historicalSignals` directly
 * rather than re-deriving equivalent facts.
 */
export function buildRepairContext(output: AutopsyOutput): RepairContext {
  const { historicalSignals, candidateErrorEvidence, hintSolutionEvidence } = output;

  const recommendedTrainingMode: RecommendedTrainingMode = historicalSignals?.repeatedPressureDifficulty
    ? "timed_pressure_drill"
    : historicalSignals?.repeatedNoveltyDifficulty
      ? "novelty_exposure"
      : hintSolutionEvidence.hintUsed || historicalSignals?.repeatedHintUse
        ? "guided_hint_first"
        : "standard_practice";

  const hasRepeatedFailure = Boolean(
    historicalSignals?.repeatedConceptFailure || historicalSignals?.repeatedTaxonomyCellFailure || historicalSignals?.repeatedPatternFamilyFailure
  );
  const priority: RepairPriority = hasRepeatedFailure ? "high" : candidateErrorEvidence ? "medium" : "low";

  const supportingEvidence: string[] = [];
  if (candidateErrorEvidence) supportingEvidence.push(...candidateErrorEvidence.supportingEvidence);
  if (historicalSignals?.repeatedConceptFailure) {
    supportingEvidence.push(`Concept failed ${historicalSignals.repeatedConceptFailure.count} times across the supplied attempt history.`);
  }
  if (historicalSignals?.repeatedTaxonomyCellFailure) {
    supportingEvidence.push(`Same taxonomy cell failed ${historicalSignals.repeatedTaxonomyCellFailure.count} times.`);
  }
  if (historicalSignals?.repeatedPatternFamilyFailure) {
    supportingEvidence.push(`Same pattern family failed ${historicalSignals.repeatedPatternFamilyFailure.count} times.`);
  }

  return {
    targetConceptName: output.questionFacts.conceptName,
    targetPatternFamilyName: output.questionFacts.patternFamilyName,
    targetTaxonomyCellId: output.questionFacts.patternTaxonomyCellId,
    candidateErrorCategory: candidateErrorEvidence?.proposedErrorCategory ?? null,
    candidateErrorTaxonomyCode: candidateErrorEvidence?.proposedErrorTaxonomyCode ?? null,
    recommendedTrainingMode,
    supportingEvidence,
    priority
  };
}
