import type { ConceptRelationEdge } from "@ipmat/concept-graph";

/**
 * The 10 legitimate ways a concept can be tested (docs/QUESTION_ENGINE.md
 * §2). This is a controlled vocabulary, not free text — every pattern
 * family and every question's testing mode(s) must be drawn from this set.
 */
export type TestingMode =
  | "direct"
  | "reverse"
  | "transformed"
  | "combined"
  | "contextualized"
  | "represented_differently"
  | "constrained"
  | "time_pressured"
  | "multi_step"
  | "novel_representation";

export const ALL_TESTING_MODES: readonly TestingMode[] = [
  "direct",
  "reverse",
  "transformed",
  "combined",
  "contextualized",
  "represented_differently",
  "constrained",
  "time_pressured",
  "multi_step",
  "novel_representation"
];

/**
 * The 5 broad "what can go wrong" categories (docs/QUESTION_ENGINE.md §2).
 * This is the SAME vocabulary ErrorTaxonomy entries are categorized under
 * (see @ipmat/db's seed-data/errorTaxonomy.ts) — Examiner Lens and Question
 * Autopsy deliberately share one error vocabulary rather than each
 * inventing their own (docs/DECISIONS.md D-013).
 */
export type ErrorCategory =
  | "misconception"
  | "trap"
  | "calculation_mistake"
  | "interpretation_mistake"
  | "method_selection_mistake";

export const ALL_ERROR_CATEGORIES: readonly ErrorCategory[] = [
  "misconception",
  "trap",
  "calculation_mistake",
  "interpretation_mistake",
  "method_selection_mistake"
];

export interface WhatIsTested {
  concept: string;
  subconcept: string;
  skill: string;
  /** Which concept-graph prerequisite this question actually exercises, if any. */
  prerequisite: string | null;
}

export interface ErrorMode {
  category: ErrorCategory;
  /** ErrorTaxonomy.code — a plain string reference, not a DB foreign key
   *  (this package must stay framework/Prisma-agnostic); @ipmat/db enforces
   *  the real FK. */
  errorTaxonomyCode: string;
  description: string;
}

/**
 * Difficulty is a set of independent dimensions, not one "hard" label
 * (docs/QUESTION_ENGINE.md §2). Each dimension is 0-1: how much of that
 * factor this question demands relative to a baseline standard-tier
 * question for the same concept.
 */
export interface DifficultyDimensions {
  conceptualLoad: number;
  computationalLoad: number;
  trapDensity: number;
  representationNovelty: number;
  timePressure: number;
  multiStepDepth: number;
}

/** A combination candidate the Lens surfaced FROM the concept graph — never hand-duplicated. */
export interface CombinationCandidate {
  concept: string;
  relation: ConceptRelationEdge;
}

/**
 * Plain data mirror of the `ExaminerLensAnalysis` row (see docs/DATABASE.md
 * and docs/QUESTION_ENGINE.md §2). `combinations` is populated by
 * deriveCombinations() from the concept graph, never authored by hand,
 * so it can never drift from the graph it's supposed to reflect.
 */
export interface ExaminerLensAnalysisData {
  concept: string;
  version: number;
  whatIsTested: WhatIsTested;
  testingModes: TestingMode[];
  combinations: CombinationCandidate[];
  errorModes: ErrorMode[];
  difficultyDimensions: DifficultyDimensions;
  status: "draft" | "reviewed" | "published";
}
