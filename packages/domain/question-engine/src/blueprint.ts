import type { DifficultyTier, PatternTaxonomyCellData, QuestionPatternFamilyData, TestingMode } from "./types.js";

/**
 * A blueprint is NOT a question — it is the specification from which a
 * question may be generated (docs/QUESTION_ENGINE.md §5). It is built
 * deterministically from an existing PatternTaxonomyCell + its pattern
 * family; no AI is involved in producing a blueprint, only in filling it.
 *
 * `transformationDescription` is a free-text elaboration of the specific
 * transformation this blueprint calls for (e.g. "hide the original value,
 * express it only via a ratio to a second quantity") — distinct from
 * `testingModes` (the controlled vocabulary category). See docs/DECISIONS.md
 * D-017 for why both exist rather than folding one into the other.
 */
export interface QuestionBlueprint {
  id: string;
  examCode: string;
  sectionName: string;
  chapterName: string;
  conceptName: string;
  patternFamilyName: string;
  targetSkill: string;
  prerequisites: string[];
  combinationConcepts: string[];
  difficultyTier: DifficultyTier;
  difficultyDimensions: {
    conceptualLoad: number;
    computationalLoad: number;
    trapDensity: number;
    representationNovelty: number;
    timePressure: number;
    multiStepDepth: number;
  };
  expectedTimeSeconds: number;
  transformationDescription: string | null;
  trapErrorTaxonomyCode: string | null;
  testingModes: TestingMode[];
  answerFormat: "multiple_choice" | "numeric_entry";
}

export interface BuildBlueprintOptions {
  examCode: string;
  sectionName: string;
  chapterName: string;
  answerFormat: "multiple_choice" | "numeric_entry";
  transformationDescription?: string | null;
  /** A deterministic id salt (e.g. the cell's index) so repeated builds of the same cell get the same blueprint id. */
  idSuffix: string;
}

/**
 * Builds one QuestionBlueprint from one concrete PatternTaxonomyCell —
 * "start with IPMAT Quant -> Percentages -> one taxonomy cell" (Phase 3
 * §5). The blueprint's difficultyDimensions come from the CELL's
 * difficulty tier position, not an arbitrary guess — Phase 2's fixtures
 * don't carry per-cell dimensions yet, so this derives a baseline that
 * scales the family's expected tier; a real per-cell dimension vector is
 * future authoring work, not a structural gap.
 */
export function buildBlueprintFromCell(
  cell: PatternTaxonomyCellData,
  family: QuestionPatternFamilyData,
  options: BuildBlueprintOptions
): QuestionBlueprint {
  return {
    id: `bp-${cell.conceptName.toLowerCase().replace(/\s+/g, "-")}-${family.name.toLowerCase().replace(/\s+/g, "-")}-${options.idSuffix}`,
    examCode: options.examCode,
    sectionName: options.sectionName,
    chapterName: options.chapterName,
    conceptName: cell.conceptName,
    patternFamilyName: family.name,
    targetSkill: family.skill,
    prerequisites: [],
    combinationConcepts: cell.combination,
    difficultyTier: cell.difficultyTier,
    difficultyDimensions: tierBaselineDimensions(cell.difficultyTier),
    expectedTimeSeconds: cell.targetTimeSeconds,
    transformationDescription: options.transformationDescription ?? null,
    trapErrorTaxonomyCode: cell.trapErrorTaxonomyCode,
    testingModes: cell.testingMode ? [cell.testingMode] : [],
    answerFormat: options.answerFormat
  };
}

function tierBaselineDimensions(tier: DifficultyTier) {
  const index = ["standard", "advanced", "hard", "extreme", "novel"].indexOf(tier);
  const scale = (base: number) => Math.min(1, base + index * 0.15);
  return {
    conceptualLoad: scale(0.2),
    computationalLoad: scale(0.2),
    trapDensity: scale(0.15),
    representationNovelty: scale(0.05),
    timePressure: scale(0.1),
    multiStepDepth: scale(0.1)
  };
}
