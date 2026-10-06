import type { AiResultMetadata } from "@ipmat/ai";
import type { GateReport, QuestionInstanceDna } from "@ipmat/content-authoring";
import type { ExamRelevance, NoveltyLevel, QuestionBlueprint, QuestionLifecycleStatus } from "@ipmat/question-engine";

/**
 * AI question generation (Phase 8 Unit 3, docs/DECISIONS.md D-094).
 *
 *   specification -> constrained generation (existing Phase 3 pipeline)
 *     -> deterministic compliance -> authoring DRAFT (existing lifecycle)
 *     -> existing 11 gates -> human review -> existing publication gate
 *
 * Generation produces CANDIDATES only. Nothing in this package can publish.
 */

/**
 * What to generate. It REUSES the existing `QuestionBlueprint` (exam, section,
 * chapter, concept, pattern family, skill, combination concepts, difficulty tier
 * and dimensions, expected time, transformation, trap, testing modes, answer
 * format) and adds only the two Question-DNA fields a blueprint does not carry:
 * novelty level and exam relevance (an EDITORIAL label). No new taxonomy.
 *
 * `provenanceSourceType` is `"original"` only: generation here uses no external
 * source text, so it is "original" content produced from a structured
 * specification. Source-backed generation is not supported (D-094).
 */
export interface GenerationSpec {
  /** Deterministic: a hash of the canonical form of everything below. Recomputed and checked on validation. */
  specId: string;
  blueprint: QuestionBlueprint;
  noveltyLevel: NoveltyLevel;
  examRelevance: ExamRelevance;
  provenanceSourceType: "original";
}

export interface SpecIssue {
  code: string;
  field: string;
  message: string;
}

export type GenerationOutcomeKind =
  /** The spec failed validation; NO model call was made. */
  | "spec_invalid"
  /** No candidate was produced (provider failure, timeout, malformed output, unpriced model). Nothing stored. */
  | "generation_failed"
  /** An identical question already exists in this exam. Nothing stored; the existing id is returned. */
  | "exact_duplicate"
  /** A candidate was produced but a blocking check (structure, recomputation, independent re-derivation, judge, spec compliance) failed. Stored as a REJECTED row. */
  | "rejected_by_checks"
  /** The candidate could not be filed under an existing taxonomy cell (authoring never creates one). Nothing stored. */
  | "not_storable"
  /** Stored as a DRAFT; an authoring gate FAILED, so it stays a draft (a human may edit it). */
  | "draft_failed_gates"
  /** Stored as `ai_validated`: no gate failed. Gates needing a human may still be open. NOT published. */
  | "ai_validated_awaiting_review"
  /** The batch's running estimated budget was exhausted before this spec ran. */
  | "skipped_budget"
  /** An identical spec appeared earlier in the same batch. */
  | "duplicate_spec_in_batch";

export interface Reason {
  code: string;
  field: string;
  message: string;
}

export interface TraceCall {
  task: string;
  promptVersion: string;
  success: boolean;
  attempts: number;
  latencyMs: number;
  tokenUsage: AiResultMetadata["tokenUsage"];
  estimatedCostUsd: number | null;
}

/** The DNA the spec asked for, the DNA the model CLAIMED, and the DNA actually RECORDED, kept apart. */
export interface DnaSummary {
  examCode: string;
  sectionName: string;
  chapterName: string;
  conceptName: string;
  patternFamilyName: string;
  skill: string;
  combinationConcepts: string[];
  difficultyTier: string;
  difficultyDimensions: Record<string, number>;
  noveltyLevel: string;
  examRelevance: string;
  expectedTimeSeconds: number;
  testingModes: string[];
  trapErrorTaxonomyCode: string | null;
}

/**
 * The audit trail of ONE generation. INTERNAL (it names the generation record,
 * validation outcomes and gate reasons). It deliberately holds NO prompt, NO
 * model response text, NO model reasoning and NO provider credential: only the
 * metadata `@ipmat/ai` already defines (provider, model, prompt version, usage,
 * cost) and the deterministic outcomes of each check.
 */
export interface GenerationTrace {
  traceId: string;
  specId: string;
  at: string;
  outcome: GenerationOutcomeKind;
  requestedDna: DnaSummary;
  /** What the model said its question was (informational only - never recorded). Null when no candidate was produced. */
  modelClaimedDna: Partial<DnaSummary> | null;
  /** Read back from the authoring repository after storage. Null when nothing was stored. */
  recordedDna: DnaSummary | null;
  /** Fields where recorded differs from requested (always empty by construction; asserted rather than assumed). */
  dnaDifferences: string[];
  difficultyCalibration: "provisional";
  provider: { name: string; model: string } | null;
  calls: TraceCall[];
  estimatedCostUsd: number;
  pipelineStatus: QuestionLifecycleStatus | null;
  pipelineChecks: Record<string, { valid: boolean; codes: string[] }> | null;
  compliance: { valid: boolean; codes: string[] } | null;
  identity: { exactDuplicateOf: string | null; nearDuplicateFlagged: boolean };
  provenance: { origin: "ai_generated"; sourceType: "original"; sourceRef: string | null } | null;
  questionId: string | null;
  validationState: string | null;
  gates: GateReport | null;
  reviewRequired: boolean;
  reviewReasons: string[];
  publishable: boolean;
  whyNotPublishable: string[];
  reasons: Reason[];
}

export interface GenerationOutcome {
  kind: GenerationOutcomeKind;
  specId: string;
  /** The stored candidate's id (draft / ai_validated / rejected), else null. */
  questionId: string | null;
  /** For `exact_duplicate`: the question that already has this identity. */
  existingQuestionId: string | null;
  reasons: Reason[];
  trace: GenerationTrace;
  /** False if the trace sink failed; the trace is still returned here. */
  traceRecorded: boolean;
}

export interface BatchOutcome {
  /** One entry per input spec, in deterministic order (by specId, then input order). Nothing is dropped. */
  outcomes: GenerationOutcome[];
  estimatedCostUsd: number;
}

export type AuthoredDna = QuestionInstanceDna;
