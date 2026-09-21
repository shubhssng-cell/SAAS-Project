import { getCombinationCandidates, type ConceptGraph } from "@ipmat/concept-graph";
import type {
  PatternFamilyCoverage,
  PatternTaxonomyCellData,
  QuestionPatternFamilyData,
  QuestionRefForCoverage,
  QuestionUniverseSnapshot
} from "./types.js";

/**
 * A family starts "mapped" the moment it's documented (this is the "27" in
 * a future "18/27 mapped pattern families mastered" — see docs/MASTER_
 * PLAN.md Phase 2, section 6) and climbs the ladder only as real,
 * validated, published content backs it. Never stored — always recomputed
 * from the actual taxonomy cells and questions, so it can't drift out of
 * sync with reality (same discipline as MasteryState).
 */
export function computePatternFamilyReadiness(
  familyName: string,
  cells: PatternTaxonomyCellData[],
  questions: QuestionRefForCoverage[]
): PatternFamilyCoverage {
  const familyCells = cells.filter((cell) => cell.patternFamilyName === familyName);
  const familyQuestions = questions.filter((question) => question.patternFamilyName === familyName);
  const validated = familyQuestions.filter((question) =>
    ["ai_validated", "human_reviewed", "published"].includes(question.validationState)
  );
  const published = familyQuestions.filter((question) => question.validationState === "published");

  let stage: PatternFamilyCoverage["stage"] = "mapped";
  if (published.length > 0) stage = "practice_ready";
  else if (validated.length > 0) stage = "validated";
  else if (familyQuestions.length > 0) stage = "has_questions";

  return {
    patternFamilyName: familyName,
    stage,
    cellCount: familyCells.length,
    questionCount: familyQuestions.length,
    validatedQuestionCount: validated.length,
    publishedQuestionCount: published.length
  };
}

/**
 * The meaningful training space around a concept — built from what's
 * actually mapped/covered, never a claim of literal completeness (see
 * docs/QUESTION_ENGINE.md §3 and the type-level guarantee on
 * QuestionUniverseSnapshot itself: there is no field that COULD express
 * "complete").
 */
export function buildQuestionUniverseSnapshot(
  conceptName: string,
  graph: ConceptGraph,
  families: QuestionPatternFamilyData[],
  cells: PatternTaxonomyCellData[],
  questions: QuestionRefForCoverage[]
): QuestionUniverseSnapshot {
  const conceptFamilies = families.filter((family) => family.conceptName === conceptName);
  const combinationCandidates = getCombinationCandidates(graph, conceptName);
  const relatedConcepts = Array.from(
    new Set(combinationCandidates.map((edge) => (edge.from === conceptName ? edge.to : edge.from)))
  );

  const combinationPatterns = conceptFamilies.map((family) => ({
    patternFamilyName: family.name,
    combinesWith: family.potentialCombinationConcepts
  }));
  const transformationsInUse = Array.from(new Set(conceptFamilies.flatMap((f) => f.potentialTestingModes)));
  const trapsInUse = Array.from(new Set(conceptFamilies.flatMap((f) => f.potentialTrapErrorTaxonomyCodes)));
  const difficultyBandsMapped = Array.from(new Set(conceptFamilies.map((f) => f.expectedDifficultyTier)));

  const patternFamilyCoverage = conceptFamilies.map((family) =>
    computePatternFamilyReadiness(family.name, cells, questions)
  );

  return {
    conceptName,
    corePatternFamilies: conceptFamilies.map((family) => family.name),
    relatedConcepts,
    combinationPatterns,
    transformationsInUse,
    trapsInUse,
    difficultyBandsMapped,
    patternFamilyCoverage,
    summary: {
      mappedFamilyCount: patternFamilyCoverage.length,
      withQuestionsCount: patternFamilyCoverage.filter((c) => c.stage !== "mapped").length,
      validatedCount: patternFamilyCoverage.filter((c) => c.stage === "validated" || c.stage === "practice_ready")
        .length,
      practiceReadyCount: patternFamilyCoverage.filter((c) => c.stage === "practice_ready").length
    }
  };
}
