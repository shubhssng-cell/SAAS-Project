import type { MasteryEvidenceView } from "@ipmat/mastery";
import type { TrainingSystemContext, TrainingSystemDiagnostics, TrainingSystemOutcome } from "@ipmat/training-systems";

/**
 * Revision Intelligence (Phase 7 Unit 2, docs/DECISIONS.md D-088).
 *
 * EVIDENCE -> REVISION SIGNALS -> the EXISTING training providers' own decisions -> a traced recommendation.
 * It is NOT a mastery verdict, score, ranking, prediction or psychological inference. There is deliberately no
 * priority among revision needs: none is specified anywhere in the repository (the adaptive priority order of D-062
 * covers the adaptive chain and explicitly excludes Revision), so none is invented here.
 */

/** The only dimensions a signal can speak about. */
export const REVISION_SIGNAL_DIMENSIONS = ["concept", "question", "pattern_family", "novelty_level", "testing_mode", "error_code"] as const;
export type RevisionSignalDimension = (typeof REVISION_SIGNAL_DIMENSIONS)[number];

/**
 * Closed set of signal kinds. Each is defined by exact, threshold-free facts, or reuses an existing provider's own,
 * already-documented rule. NOT included (undefined in the repository): revision backlog, "weakness", over-concentration
 * shares, novel-question "weakness", anything that needs a verdict or a new threshold.
 */
export const REVISION_SIGNAL_KINDS = [
  "dormant_concept",
  "recurring_trap_failure",
  "attempts_exceed_distinct_questions",
  "pattern_family_without_graded_evidence",
  "novelty_level_without_graded_evidence",
  "testing_mode_without_graded_evidence"
] as const;
export type RevisionSignalKind = (typeof REVISION_SIGNAL_KINDS)[number];

export type SignalFact = string | number | boolean | null | readonly string[];

export interface RevisionSignal {
  /** Deterministic: `${kind}|${conceptName ?? "*"}|${subject ?? "*"}`. */
  id: string;
  kind: RevisionSignalKind;
  dimension: RevisionSignalDimension;
  /** `null` only for a signal that is not concept-scoped by its own definition (trap recurrence aggregates across concepts, D-078). */
  conceptName: string | null;
  /** The pattern family / novelty level / testing mode / error code / etc. the signal is about; `null` for a concept-wide signal. */
  subject: string | null;
  /** The fixed, human-readable definition of this kind - the same text every time. */
  definition: string;
  /** The exact observed numbers/identifiers the signal was derived from. */
  facts: Readonly<Record<string, SignalFact>>;
  /** Audit: the attempts the facts were derived from, chronological. */
  contributingAttemptIds: readonly string[];
  explanation: string;
}

/** The existing training systems this layer consults, in ALPHABETICAL order (presentation only - not a priority). */
export const REVISION_INTELLIGENCE_SYSTEM_IDS = ["calculation-gym", "novelty-training", "pressure-training", "revision", "speed-lab", "trap-lab"] as const;
export type RevisionIntelligenceSystemId = (typeof REVISION_INTELLIGENCE_SYSTEM_IDS)[number];

/**
 * Plain labels for the exposure each EXISTING system provides. They add no training semantics: each is just the name of
 * what that one provider already does.
 */
export const REVISION_EXPOSURE_TYPES: Readonly<Record<RevisionIntelligenceSystemId, string>> = {
  "calculation-gym": "calculation_practice",
  "novelty-training": "novelty_exposure",
  "pressure-training": "timed_run_practice",
  revision: "concept_re_exposure",
  "speed-lab": "pace_practice",
  "trap-lab": "trap_recurrence_practice"
};

/** One provider run supplied by the caller: the provider's RAW outcome, or `null` when the system has no provider. */
export interface ProviderRun {
  systemId: string;
  outcome: TrainingSystemOutcome | null;
}

export type ProviderOutcomeStatus = "selected" | "no_eligible_question" | "not_applicable" | "error" | "not_built" | "not_run";

/** Every consulted system's outcome, kept whether or not it produced a recommendation. */
export interface ProviderOutcomeRecord {
  systemId: RevisionIntelligenceSystemId;
  status: ProviderOutcomeStatus;
  /** The provider's own reason code (not-applicable) or error code; `null` otherwise. */
  reason: string | null;
  /** The provider's own explanation, verbatim. */
  explanation: string | null;
  diagnostics: TrainingSystemDiagnostics | null;
}

export interface SelectedQuestionTrace {
  questionId: string;
  conceptName: string;
  patternFamilyName: string;
  noveltyLevel: string;
  testingModes: readonly string[];
  /** Always "published": a non-published selection is refused (fail closed). */
  validationState: "published";
}

export interface RevisionRecommendation {
  systemId: RevisionIntelligenceSystemId;
  /** Label of the exposure the existing provider supplies (no new semantics). */
  exposureType: string;
  /** The provider that produced the final candidate - always `systemId`; no other layer picks or re-ranks a question. */
  producedBy: RevisionIntelligenceSystemId;
  targetConceptName: string | null;
  targetErrorTaxonomyCode: string | null;
  targetNoveltyLevel: string | null;
  /** WHY this exposure: the provider's own explanation, verbatim. */
  providerExplanation: string;
  /** Signals this layer links to the provider's target by deterministic rule; may be empty (the provider's own evidence is then not enumerated here). */
  supportingSignalIds: readonly string[];
  /** Which evidence dimensions the recommendation rests on. */
  evidenceDimensions: readonly RevisionSignalDimension[];
  /** Union of the linked signals' attempts; empty when the provider's evidence is provider-owned and not enumerated. */
  contributingAttemptIds: readonly string[];
  contributingAttemptsNote: string | null;
  question: SelectedQuestionTrace;
}

export const REVISION_CONFLICT_KINDS = ["competing_revision_types", "recurring_trap_with_correct_attempts"] as const;
export type RevisionConflictKind = (typeof REVISION_CONFLICT_KINDS)[number];

/** A conflict is PRESERVED, never resolved: no precedence rule between revision types exists. */
export interface RevisionConflict {
  kind: RevisionConflictKind;
  /** Systems, signals or concepts involved, so the conflict is traceable. */
  involves: readonly string[];
  facts: Readonly<Record<string, SignalFact>>;
  resolution: "unresolved_product_decision";
  explanation: string;
}

export interface UnservedSignal {
  signalId: string;
  /** Existing system that could in principle serve this kind of signal, or `null` when none exists. */
  possibleSystemId: RevisionIntelligenceSystemId | null;
  reason: string;
}

export interface RevisionIntelligence {
  /** Always this marker: evidence-based, no mastery verdict. */
  status: "evidence_based_no_verdict";
  studentId: string;
  examCode: string;
  /** The caller-supplied evaluation time, or `null` when none/invalid was supplied (dormancy then yields no signals). */
  evaluatedAt: string | null;
  /** Always "undefined": no priority among revision needs exists in the repository. Recommendations are listed alphabetically by system id, which carries NO meaning. */
  priority: { defined: false; note: string };
  signals: RevisionSignal[];
  providerOutcomes: ProviderOutcomeRecord[];
  recommendations: RevisionRecommendation[];
  unservedSignals: UnservedSignal[];
  conflicts: RevisionConflict[];
  /** Systems that were applicable but had no eligible published question (a content gap, distinct from not applicable). */
  noEligibleCandidate: RevisionIntelligenceSystemId[];
}

export interface RevisionIntelligenceInput {
  studentId: string;
  examCode: string;
  /** The Unit 1 evidence view for this student and exam - consumed as-is, never modified. */
  evidence: MasteryEvidenceView;
  /** The same context the existing providers consume (attempt records, published candidate pool, `now`). */
  context: TrainingSystemContext;
  /** The raw outcomes of the existing providers for that context, supplied by the caller. */
  runs: readonly ProviderRun[];
}

export class RevisionIntelligenceError extends Error {
  readonly code: "scope_mismatch" | "provider_selected_ineligible_question" | "unknown_system";
  constructor(code: RevisionIntelligenceError["code"], message: string) {
    super(message);
    this.name = "RevisionIntelligenceError";
    this.code = code;
  }
}
