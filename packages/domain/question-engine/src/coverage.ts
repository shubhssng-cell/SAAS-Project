import { getCombinationCandidates, type ConceptGraph } from "@ipmat/concept-graph";
import type {
  PatternFamilyCoverage,
  PatternTaxonomyCellData,
  QuestionPatternFamilyData,
  QuestionRefForCellCoverage,
  QuestionRefForCoverage,
  QuestionUniverseSnapshot,
  TaxonomyCellCoverage
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

function sameConceptSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((item) => setB.has(item));
}

function cellMatches(cell: PatternTaxonomyCellData, ref: QuestionRefForCellCoverage): boolean {
  return (
    cell.patternFamilyName === ref.patternFamilyName &&
    cell.testingMode === ref.testingMode &&
    cell.trapErrorTaxonomyCode === ref.trapErrorTaxonomyCode &&
    cell.difficultyTier === ref.difficultyTier &&
    sameConceptSet(cell.combination, ref.combination)
  );
}

/**
 * The per-cell counterpart to `computePatternFamilyReadiness()` (Phase
 * 3.5) — narrows "does this pattern family have questions" down to "does
 * this ONE taxonomy cell." Matches a question to a cell by the SAME
 * natural key the real schema's unique constraint uses
 * (`[conceptId, patternFamilyId, testingMode, trapErrorTaxonomyId,
 * difficultyTier]`) rather than an opaque id, since `PatternTaxonomyCellData`
 * fixtures (like real `Question` rows before this phase) never needed one.
 * Never stored — recomputed fresh from whatever `questions` the caller
 * currently has, the same "derived, never input" discipline as every
 * other coverage function in this file.
 */
export function computeTaxonomyCellCoverage(
  cells: PatternTaxonomyCellData[],
  questions: QuestionRefForCellCoverage[]
): TaxonomyCellCoverage[] {
  return cells.map((cell) => {
    const matches = questions.filter((question) => cellMatches(cell, question));
    const published = matches.filter((question) => question.validationState === "published");

    let status: TaxonomyCellCoverage["status"] = "uncovered";
    if (published.length > 0) status = "covered";
    else if (matches.length > 0) status = "underrepresented";

    return {
      patternFamilyName: cell.patternFamilyName,
      conceptName: cell.conceptName,
      combination: cell.combination,
      testingMode: cell.testingMode,
      trapErrorTaxonomyCode: cell.trapErrorTaxonomyCode,
      difficultyTier: cell.difficultyTier,
      existingQuestionCount: matches.length,
      publishedQuestionCount: published.length,
      status
    };
  });
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
