import type { ProvenanceSourceType, QuestionDnaData, ValidationState } from "@ipmat/question-engine";

/**
 * Content authoring (docs/DECISIONS.md D-084). Five things are kept apart and
 * never flattened into one record:
 *
 *   CONCEPT          - a node of the Exam Pack ("Percentages")
 *   PATTERN FAMILY   - a STRUCTURE that can generate many questions ("Successive Percentage Change")
 *   QUESTION DNA     - how ONE question maps into concept / pattern / difficulty / novelty / trap space
 *   QUESTION INSTANCE- one specific problem: its identity, DNA, source, state
 *   QUESTION CONTENT - the wording, options, answer and solution of that instance
 *
 * An `AuthoredQuestion` is an instance: it carries the DNA and the content
 * side by side but as distinct, separately-validated parts. The persisted
 * lifecycle vocabulary is the EXISTING `ValidationState`; nothing new was
 * added to it.
 */

/** The existing Question DNA, minus the two fields an instance carries ONCE, on the instance itself (`source`, `validationState`). */
export type QuestionInstanceDna = Omit<QuestionDnaData, "provenanceSourceType" | "validationState">;

/**
 * Who produced the content. `ai_generated` content is a PROPOSAL: it can never
 * reach `published` without passing every gate, and its answer is never
 * trusted on the model's word (see the `answer` gate). `unknown` is for rows
 * that pre-date origin tracking (e.g. questions imported from the generation
 * pipeline before this field existed): it is NEVER guessed to be human, and the
 * answer gate treats it exactly as cautiously as `ai_generated`. New questions
 * must state their origin.
 */
export type AuthoringOrigin = "human_authored" | "ai_generated" | "unknown";

export type AnswerFormat = "multiple_choice" | "numeric_entry";

export interface QuestionContent {
  body: string;
  answerFormat: AnswerFormat;
  /** Empty for `numeric_entry`. */
  options: string[];
  correctAnswer: string;
  solutionSteps: string[];
  /**
   * A plain arithmetic derivation that `verifyComputation()` can recompute
   * deterministically, or null when the answer cannot be derived that way -
   * in which case a human must verify it (the `answer` gate says so).
   */
  groundTruthDerivation: { computation: string; expectedAnswer: number } | null;
}

/** Rights and origin of the CONTENT. Same vocabulary as `Provenance`. */
export interface QuestionSource {
  sourceType: ProvenanceSourceType;
  sourceRef: string | null;
  licenseRef: string | null;
  attributedTo: string | null;
}

/**
 * Internal review record. Never student-visible. `answerVerifiedByReviewer`
 * is the reviewer's explicit statement that THEY checked the answer (the only
 * way a non-derivable answer passes); `reviewedAsDistinct` is the reviewer's
 * explicit statement that a flagged near-duplicate is genuinely different
 * (near-duplicates are never merged automatically).
 */
export interface QuestionReview {
  reviewedBy: string;
  /** ISO-8601, supplied by the caller (this package never reads a clock). */
  reviewedAt: string;
  notes: string | null;
  answerVerifiedByReviewer: boolean;
  reviewedAsDistinct: boolean;
}

export interface AuthoredQuestion {
  /** Stable identity, assigned once and never changed by editing, validation, review or publication. */
  id: string;
  dna: QuestionInstanceDna;
  content: QuestionContent;
  source: QuestionSource;
  origin: AuthoringOrigin;
  /** The existing persisted lifecycle: draft | ai_validated | human_reviewed | published | rejected. */
  validationState: ValidationState;
  review: QuestionReview | null;
  /** Result of an independent second derivation (never the generator's own), required before an AI answer can pass. */
  independentReverification: { derivedAnswer: string } | null;
}

// ----------------------------------------------------------------------------
// Gates
// ----------------------------------------------------------------------------

export const GATE_NAMES = [
  "structure",
  "metadata",
  "dna",
  "concept",
  "pattern",
  "difficulty_novelty",
  "expected_time",
  "answer",
  "identity",
  "provenance",
  "review"
] as const;
export type GateName = (typeof GATE_NAMES)[number];

/**
 * - passed:         the gate established what it claims to establish
 * - failed:         a definite problem; the question cannot proceed
 * - requires_human: the gate CANNOT be settled by machine (explicit, never silently skipped)
 * - not_applicable: the gate does not apply to this question
 */
export type GateStatus = "passed" | "failed" | "requires_human" | "not_applicable";

export interface GateReason {
  /** Stable, machine-readable. */
  code: string;
  field: string;
  message: string;
}

export interface GateResult {
  gate: GateName;
  status: GateStatus;
  reasons: GateReason[];
}

/**
 * The full verdict for one question. NOT one boolean: every gate is reported,
 * and what each gate establishes is deliberately narrow - schema-valid is not
 * exam-valid, and neither is pedagogically good. `publishable` means "no
 * known gate blocks publication", never "this is a good question".
 */
export interface GateReport {
  questionId: string;
  gates: GateResult[];
  failed: GateName[];
  requiresHuman: GateName[];
  /** True iff every gate is passed/not_applicable AND the lifecycle would allow publication right now. */
  publishable: boolean;
}

/** Existing questions of the SAME exam, for the identity gate. */
export interface IdentityRef {
  id: string;
  fingerprint: string;
  body: string;
  validationState: ValidationState;
}

export interface GateContext {
  /** The pack of the question's OWN exam. */
  pack: import("@ipmat/exam-pack").ExamPack;
  patternFamilies: readonly import("@ipmat/question-engine").QuestionPatternFamilyData[];
  errorTaxonomyCodes: readonly string[];
  /** Other questions of the same exam (the question itself, if present, is ignored by id). */
  existing: readonly IdentityRef[];
}
