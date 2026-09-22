import type { DifficultyTier, PatternTaxonomyCellData, QuestionPatternFamilyData, TestingMode } from "./types.js";

/**
 * How much trust to put in a set of difficulty dimension values (Phase
 * 3.1 §4). `provisional` means exactly one thing: a formula, not a
 * measurement — see `tierBaselineDimensions()` below. Nothing in this
 * codebase currently produces `expert_reviewed` or `empirically_calibrated`
 * values; those statuses exist so the type is ready for real calibration
 * work later without another schema change, not because that work has
 * happened. Do not treat a `provisional` blueprint's numbers as
 * representative of real IPMAT difficulty (docs/DECISIONS.md D-021).
 */
export type DifficultyCalibrationStatus = "provisional" | "expert_reviewed" | "empirically_calibrated";

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
  /** See DifficultyCalibrationStatus — always "provisional" from buildBlueprintFromCell today. */
  difficultyCalibrationStatus: DifficultyCalibrationStatus;
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
 * §5). The blueprint's difficultyDimensions come from `tierBaselineDimensions()`
 * below, which is an IMPLEMENTATION PLACEHOLDER, not empirical calibration
 * (Phase 3.1 §4) — that's why `difficultyCalibrationStatus` is always
 * "provisional" here. Real calibration needs actual question-attempt data
 * and/or expert review, neither of which exists yet; inventing a more
 * "scientific-looking" formula would not fix that, only hide it, so none
 * was attempted (docs/DECISIONS.md D-021).
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
    difficultyCalibrationStatus: "provisional",
    expectedTimeSeconds: cell.targetTimeSeconds,
    transformationDescription: options.transformationDescription ?? null,
    trapErrorTaxonomyCode: cell.trapErrorTaxonomyCode,
    testingModes: cell.testingMode ? [cell.testingMode] : [],
    answerFormat: options.answerFormat
  };
}

/**
 * PLACEHOLDER FORMULA — not empirically calibrated (Phase 3.1 §4). Scales
 * a hand-picked baseline linearly by tier index. It has never been
 * checked against a real question's measured difficulty, because no such
 * measurement exists yet (that needs real student attempt data, Phase 5+).
 * Every value this function returns is `difficultyCalibrationStatus:
 * "provisional"` on the blueprint it's attached to — do not read these
 * numbers as a claim about real IPMAT difficulty.
 */
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
