/**
 * Structured "concept depth" content (docs/QUESTION_ENGINE.md §1a) — kept
 * as typed substructures rather than one text blob, so specific parts
 * (e.g. just the shortcuts, or just the common traps) can be queried and
 * rendered independently.
 */

export interface Formula {
  label: string;
  expression: string;
  whenToUse: string;
}

export interface Method {
  name: string;
  steps: string[];
  bestFor: string;
}

export interface Shortcut {
  name: string;
  description: string;
  validWhen: string;
}

export interface Misconception {
  description: string;
  /** ErrorTaxonomy.code this misconception corresponds to, when one exists —
   *  a plain string reference (not a DB foreign key) since this is a
   *  framework-agnostic domain package; see @ipmat/db for the enforced FK. */
  errorTaxonomyCode: string | null;
}

export interface TrapExample {
  description: string;
  errorTaxonomyCode: string | null;
}

export interface ApplicationArea {
  name: string;
  description: string;
}

/** Shared across the domain layer (question-engine, examiner-lens) so difficulty tiers are one vocabulary, not several. */
export type DifficultyTier = "standard" | "advanced" | "hard" | "extreme" | "novel";

export interface DifficultyProgressionStep {
  tier: DifficultyTier;
  description: string;
}

export interface ConceptDepthData {
  conceptName: string;
  definition: string;
  intuition: string;
  formulas: Formula[];
  methods: Method[];
  alternativeMethods: Method[];
  shortcuts: Shortcut[];
  commonMisconceptions: Misconception[];
  commonTraps: TrapExample[];
  applicationAreas: ApplicationArea[];
  difficultyProgression: DifficultyProgressionStep[];
}
