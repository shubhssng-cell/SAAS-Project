import type { DifficultyTier } from "@ipmat/concept-graph";
import type { DifficultyDimensions, TestingMode } from "@ipmat/examiner-lens";

export type { DifficultyTier, DifficultyDimensions, TestingMode };

export type PatternFamilyStatus = "draft" | "reviewed" | "published";
export type ValidationState = "draft" | "ai_validated" | "human_reviewed" | "published" | "rejected";
export type NoveltyLevel = "standard" | "novel_representation" | "novel_combination" | "novel_context";
export type ExamRelevance = "core" | "peripheral" | "stretch";
export type ProvenanceSourceType =
  | "original"
  | "licensed"
  | "public_domain"
  | "open_license"
  | "official"
  | "user_authorized";

/**
 * A pattern describes the STRUCTURE of a question, not a numerical
 * instance (docs/QUESTION_ENGINE.md §3) — "potential" fields describe the
 * space this family can legitimately draw from; a concrete
 * PatternTaxonomyCellData picks one specific point in that space.
 */
export interface QuestionPatternFamilyData {
  name: string;
  conceptName: string;
  skill: string;
  description: string;
  expectedDifficultyTier: DifficultyTier;
  potentialCombinationConcepts: string[];
  /** ErrorTaxonomy.code references — plain strings, not enforced FKs (see @ipmat/db for the real FK). */
  potentialTrapErrorTaxonomyCodes: string[];
  potentialTestingModes: TestingMode[];
  status: PatternFamilyStatus;
}

/** One specific, concrete slice of a pattern family's space — the unit coverage is tracked against. */
export interface PatternTaxonomyCellData {
  patternFamilyName: string;
  conceptName: string;
  combination: string[];
  testingMode: TestingMode | null;
  trapErrorTaxonomyCode: string | null;
  difficultyTier: DifficultyTier;
  targetTimeSeconds: number;
  coverageStatus: "uncovered" | "in_generation" | "covered";
}

/**
 * Finalized Question DNA (docs/QUESTION_ENGINE.md §4, docs/DATABASE.md
 * §Question). Fields that will be queried frequently are normalized as
 * their own typed properties, not buried inside a single opaque JSON blob.
 */
export interface QuestionDnaData {
  examCode: string;
  sectionName: string;
  chapterName: string;
  conceptName: string;
  subconcepts: string[];
  prerequisites: string[];
  combinesWithConcepts: string[];
  patternFamilyName: string;
  skill: string;
  difficultyTier: DifficultyTier;
  difficultyDimensions: DifficultyDimensions;
  noveltyLevel: NoveltyLevel;
  examRelevance: ExamRelevance;
  expectedTimeSeconds: number;
  testingModes: TestingMode[];
  trapErrorTaxonomyCode: string | null;
  provenanceSourceType: ProvenanceSourceType;
  validationState: ValidationState;
}

/**
 * Where a pattern family sits on the readiness ladder — computed, never
 * stored (same "derived, not input" discipline as MasteryState; see
 * docs/DATABASE.md "Mastery is derived, never input"). Mapped is the
 * starting point every family has as soon as it's documented; the rest
 * require increasingly real content behind it.
 */
export type CoverageStage = "mapped" | "has_questions" | "validated" | "practice_ready";

export interface QuestionRefForCoverage {
  patternFamilyName: string;
  validationState: ValidationState;
}

/**
 * `QuestionRefForCoverage` widened with the remaining fields of a
 * `PatternTaxonomyCellData`'s natural key (Phase 3.5) — a real `Question`
 * row already carries all of these (`combines_with_concept_ids`,
 * `testing_modes`, `trap_error_taxonomy_id`, `difficulty_tier`), so this is
 * a restatement of existing Question DNA fields for cell-level matching,
 * never a parallel identity scheme. `combination` is compared as a SET
 * (order-independent), matching how `validateBlueprintCompliance()`
 * already compares `combinesWithConcepts` against a blueprint.
 */
export interface QuestionRefForCellCoverage extends QuestionRefForCoverage {
  combination: string[];
  testingMode: TestingMode | null;
  trapErrorTaxonomyCode: string | null;
  difficultyTier: DifficultyTier;
}

/**
 * Per-cell coverage is a strictly finer-grained view of the SAME ladder
 * `PatternFamilyCoverage`/`CoverageStage` already established, scoped down
 * from "does this family have questions" to "does this ONE taxonomy cell."
 * `"covered"` requires at least one PUBLISHED question for that exact
 * cell — a cell with only `validated`/`review_required` candidates is
 * `"underrepresented"`, not `"covered"`, so this can never overstate real
 * publication-ready coverage (docs/DECISIONS.md D-007).
 */
export type TaxonomyCellCoverageStatus = "uncovered" | "underrepresented" | "covered";

export interface TaxonomyCellCoverage {
  patternFamilyName: string;
  conceptName: string;
  combination: string[];
  testingMode: TestingMode | null;
  trapErrorTaxonomyCode: string | null;
  difficultyTier: DifficultyTier;
  existingQuestionCount: number;
  publishedQuestionCount: number;
  status: TaxonomyCellCoverageStatus;
}

export interface PatternFamilyCoverage {
  patternFamilyName: string;
  stage: CoverageStage;
  cellCount: number;
  questionCount: number;
  validatedQuestionCount: number;
  publishedQuestionCount: number;
}

/**
 * The meaningful training space around a concept (docs/QUESTION_ENGINE.md
 * §3, §6). Every count here is "known/mapped/covered/uncovered" — this
 * type has no field that could represent a literal completeness claim
 * (docs/DECISIONS.md D-007); see also examiner-lens's validate.ts guard
 * against the same claim appearing in free text.
 */
export interface QuestionUniverseSnapshot {
  conceptName: string;
  corePatternFamilies: string[];
  relatedConcepts: string[];
  combinationPatterns: Array<{ patternFamilyName: string; combinesWith: string[] }>;
  transformationsInUse: TestingMode[];
  trapsInUse: string[];
  difficultyBandsMapped: DifficultyTier[];
  patternFamilyCoverage: PatternFamilyCoverage[];
  summary: {
    mappedFamilyCount: number;
    withQuestionsCount: number;
    validatedCount: number;
    practiceReadyCount: number;
  };
}
