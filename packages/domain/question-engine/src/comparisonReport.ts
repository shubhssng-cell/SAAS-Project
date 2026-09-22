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
    supportedByGraph: string[];
    unsupportedByGraph: string[];
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
  const supportedByGraph = aiSuggestedConcepts.filter((concept) => allRelatedConcepts.has(concept));
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
      supportedByGraph,
      unsupportedByGraph,
      missedByAi
    },
    completenessClaims: { found: completenessClaims, hasUnsupportedClaim: completenessClaims.length > 0 }
  };
}
