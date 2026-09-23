import type { TrainingRequirement } from "@ipmat/training-systems";

/**
 * Provider-specific extension of the shared `TrainingRequirement`
 * (docs/DECISIONS.md D-053 item 3). `targetErrorTaxonomyCode` is the
 * PRIMARY identity of what Trap Lab trains — recurrence is evaluated at
 * the error-taxonomy-code level, across ALL concepts, never partitioned
 * by concept (docs/DECISIONS.md D-056). `targetConceptName` is optional
 * CONTEXTUAL scope only, never part of the identity of the recurring
 * pattern: V1's `evaluate()` never populates it (a code recurring across
 * two different concepts is still one recurring code), but `select()`
 * honors it as a selection-time filter if a future caller supplies one.
 */
export interface TrapLabRequirement extends TrainingRequirement {
  targetErrorTaxonomyCode: string;
  targetConceptName?: string;
}

/**
 * The core derived signal this provider introduces: CANDIDATE-LEVEL
 * "trap-associated failure recurrence" evidence for ONE error-taxonomy
 * code, aggregated across a student's entire supplied attempt history.
 *
 * What this observes: repeated incorrect attempts on questions whose
 * authors designated this SAME trap-taxonomy code as the question's
 * intended trap.
 *
 * What this does NOT observe, and never claims: the student's private
 * reasoning process, a confirmed error, or a diagnosed misconception.
 * `errorTaxonomyCode` identifies the QUESTION-DESIGNED trap being
 * trained, not a claim about what actually happened in the student's
 * mind — the same candidate-vs-confirmed boundary `@ipmat/autopsy`'s
 * `CandidateErrorEvidence` already establishes (it has no `confirmed`
 * field either), generalized here to a historical count instead of one
 * attempt. This reflects repeated failure on trap-tagged questions, not
 * a confirmed diagnosis of the student's reasoning.
 *
 * `distinctFailingQuestionIds`/`distinctConceptNames`/
 * `distinctPatternTaxonomyCellIds`/`distinctPatternFamilyNames` are all
 * SET-DERIVED (deduplicated) — a single question retried five times
 * contributes at most one distinct failing question id. Only
 * `distinctFailingQuestionIds` gates applicability (docs/DECISIONS.md
 * D-056); the concept/cell/family fields are diagnostic-only, describing
 * the SPREAD of the recurrence, never independently required.
 * `resistanceQuestionIds`/`hintAssistedResistanceQuestionIds` are
 * diagnostic-only counts of CORRECT attempts against the same code — they
 * never subtract from, cancel, or otherwise change the recurrence
 * decision (cumulative, no decay — docs/DECISIONS.md D-056).
 */
export interface TrapAssociatedFailureRecurrence {
  errorTaxonomyCode: string;
  distinctFailingQuestionIds: string[];
  distinctConceptNames: string[];
  distinctPatternTaxonomyCellIds: string[];
  distinctPatternFamilyNames: string[];
  /** Distinct questionIds where a CORRECT, hint-free attempt was made against this same trap code — may indicate developing resistance; never "trap mastered." */
  resistanceQuestionIds: string[];
  /** Distinct questionIds where a CORRECT, hint-ASSISTED attempt was made against this same trap code — tracked separately from hint-free resistance, never blended into it. */
  hintAssistedResistanceQuestionIds: string[];
  /** Plain-language notes: taxonomy-enrichment status (label/category resolved, or `taxonomy_enrichment_missing:<code>`) and the resistance disclosure. Never claims confirmation. */
  diagnosticNotes: string[];
}
