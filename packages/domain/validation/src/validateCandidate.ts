import type { ConceptGraph } from "@ipmat/concept-graph";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";
import { mergeResults, type ValidationResult } from "./types.js";
import {
  validateBlueprintCompliance,
  validateNoAnswerLeakageInStem,
  validateNoCompletenessClaims,
  validateProvenancePresent,
  validateSingleCorrectAnswer,
  validateSyllabusCompatibility,
  type BlueprintExpectation
} from "./qualityValidators.js";

/**
 * The deterministic half of quality validation (docs/QUESTION_ENGINE.md
 * §5b) — everything here is a pure, structural check with no AI call and
 * no network access. The other half (arithmetic re-derivation, judge
 * ambiguity/contradiction detection, duplicate risk) needs external
 * inputs (existing question bodies, a live/fixture AI call) and is run
 * separately by the caller; see verifyComputation, compareReverification,
 * checkDuplicateRisk, interpretJudgeVerdict.
 */
export function validateCandidateStructurally(
  candidate: QuestionCandidateAiOutput,
  graph: ConceptGraph,
  blueprint: BlueprintExpectation,
  provenanceSourceType: string | null
): ValidationResult {
  return mergeResults(
    validateBlueprintCompliance(candidate, blueprint),
    validateSyllabusCompatibility(candidate, graph),
    validateSingleCorrectAnswer(candidate),
    validateNoAnswerLeakageInStem(candidate),
    validateNoCompletenessClaims(candidate),
    validateProvenancePresent(provenanceSourceType)
  );
}
