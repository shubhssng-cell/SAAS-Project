import {
  deriveCombinations,
  findCompletenessClaims,
  type ErrorCategory,
  type ExaminerLensAnalysisData,
  type TestingMode
} from "@ipmat/examiner-lens";
import { getAllRelationsFor, type ConceptGraph } from "@ipmat/concept-graph";
import type { ExaminerLensAnalysisAiOutput } from "@ipmat/ai";

/**
 * "Do not assume AI is correct" (docs/MASTER_PLAN.md Phase 3 §9). The
 * human-authored ExaminerLensAnalysis is the evaluation baseline; this
 * report never edits or overwrites it, and never lets the AI's proposed
 * combinations become real ConceptRelation edges automatically — a
 * `supportedByGraph` result only means "this proposal happens to match an
 * edge that already exists," not "the AI's reasoning is now authoritative."
 */
export interface LensComparisonReport {
  concept: string;
  skillFocus: { human: string; ai: string; agree: boolean };
  prerequisite: { human: string | null; ai: string | null; agree: boolean };
  testingModes: {
    human: TestingMode[];
    ai: TestingMode[];
    agreedOn: TestingMode[];
    humanOnly: TestingMode[];
    aiOnly: TestingMode[];
  };
  difficultyDimensions: {
    human: ExaminerLensAnalysisData["difficultyDimensions"];
    ai: ExaminerLensAnalysisAiOutput["difficultyDimensions"];
    deltas: Record<string, number>;
    maxAbsoluteDelta: number;
  };
  errorCategories: {
    human: ErrorCategory[];
    ai: ErrorCategory[];
    agreedOn: ErrorCategory[];
    humanOnly: ErrorCategory[];
    aiOnly: ErrorCategory[];
  };
  combinations: {
    aiSuggested: string[];
    /** AI proposed a concept, and the graph has a `commonly_combined`/`application`/`dependent` edge for it with `usefulForQuestionGeneration: true` — a legitimate combination target. */
    validGenerationCombination: string[];
    /** AI proposed a concept, and a graph edge DOES exist between them — but it's not one of the generation-useful types (e.g. `related_but_distinct`, `prerequisite`, `foundational`, or a combinable-typed edge explicitly marked not useful). The AI found a real relationship but the wrong kind to build a combined question on. */
    relatedButNonCombinable: string[];
    /** AI proposed a concept with NO corresponding edge anywhere in the graph — invented, not just miscategorized. */
    unsupportedByGraph: string[];
    /** A real, generation-useful combination the AI never mentioned at all. */
    missedByAi: string[];
  };
  completenessClaims: { found: string[]; hasUnsupportedClaim: boolean };
}

export function buildLensComparisonReport(
  human: ExaminerLensAnalysisData,
  ai: ExaminerLensAnalysisAiOutput,
  graph: ConceptGraph
): LensComparisonReport {
  const humanModes = new Set(human.testingModes);
  const aiModes = new Set(ai.testingModes);
  const humanCategories = new Set(human.errorModes.map((mode) => mode.category));
  const aiCategories = new Set(ai.errorModes.map((mode) => mode.category));

  const realCombinationConcepts = new Set(
    deriveCombinations(graph, human.concept).map((candidate) => candidate.concept)
  );
  const allRelatedConcepts = new Set(
    getAllRelationsFor(graph, human.concept).map((edge) => (edge.from === human.concept ? edge.to : edge.from))
  );
  const aiSuggestedConcepts = ai.suggestedCombinations.map((s) => s.concept);
  // Phase 3.1 §2 fix: a graph edge existing is NOT the same claim as "this
  // is a valid generation combination" — related_but_distinct exists
  // specifically to say "do not combine these" (docs/QUESTION_ENGINE.md
  // §1). The four categories are mutually exclusive and jointly exhaustive
  // over aiSuggestedConcepts (plus missedByAi, which isn't AI-suggested at all).
  const validGenerationCombination = aiSuggestedConcepts.filter((concept) => realCombinationConcepts.has(concept));
  const relatedButNonCombinable = aiSuggestedConcepts.filter(
    (concept) => allRelatedConcepts.has(concept) && !realCombinationConcepts.has(concept)
  );
  const unsupportedByGraph = aiSuggestedConcepts.filter((concept) => !allRelatedConcepts.has(concept));
  const missedByAi = [...realCombinationConcepts].filter((concept) => !aiSuggestedConcepts.includes(concept));

  const dimensionKeys = Object.keys(human.difficultyDimensions) as Array<keyof typeof human.difficultyDimensions>;
  const deltas: Record<string, number> = {};
  for (const key of dimensionKeys) {
    deltas[key] = Math.abs(human.difficultyDimensions[key] - ai.difficultyDimensions[key]);
  }

  const aiText = [ai.whatIsTested.skill, ...ai.errorModes.map((m) => m.description)].join(" ");
  const completenessClaims = findCompletenessClaims(aiText);

  return {
    concept: human.concept,
    skillFocus: {
      human: human.whatIsTested.skill,
      ai: ai.whatIsTested.skill,
      agree: human.whatIsTested.skill.trim().toLowerCase() === ai.whatIsTested.skill.trim().toLowerCase()
    },
    prerequisite: {
      human: human.whatIsTested.prerequisite,
      ai: ai.whatIsTested.prerequisite,
      agree: human.whatIsTested.prerequisite === ai.whatIsTested.prerequisite
    },
    testingModes: {
      human: [...humanModes],
      ai: [...aiModes],
      agreedOn: [...humanModes].filter((mode) => aiModes.has(mode)),
      humanOnly: [...humanModes].filter((mode) => !aiModes.has(mode)),
      aiOnly: [...aiModes].filter((mode) => !humanModes.has(mode))
    },
    difficultyDimensions: {
      human: human.difficultyDimensions,
      ai: ai.difficultyDimensions,
      deltas,
      maxAbsoluteDelta: Math.max(...Object.values(deltas))
    },
    errorCategories: {
      human: [...humanCategories],
      ai: [...aiCategories],
      agreedOn: [...humanCategories].filter((c) => aiCategories.has(c)),
      humanOnly: [...humanCategories].filter((c) => !aiCategories.has(c)),
      aiOnly: [...aiCategories].filter((c) => !humanCategories.has(c))
    },
    combinations: {
      aiSuggested: aiSuggestedConcepts,
      validGenerationCombination,
      relatedButNonCombinable,
      unsupportedByGraph,
      missedByAi
    },
    completenessClaims: { found: completenessClaims, hasUnsupportedClaim: completenessClaims.length > 0 }
  };
}
