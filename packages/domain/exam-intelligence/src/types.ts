import type { ExamPack } from "@ipmat/exam-pack";
import type { HistoricalQuestionRecord } from "@ipmat/examiner-intelligence";
import type { QuestionInstanceDna } from "@ipmat/content-authoring";
import type { ProvenanceSourceType, QuestionPatternFamilyData, ValidationState } from "@ipmat/question-engine";

/**
 * Exam Intelligence (docs/DECISIONS.md D-086): the integration layer over the
 * Phase 6 foundations. It is NOT one "AI brain" and NOT a score: it is a set of
 * structured, auditable, deterministic services that answer questions about the
 * EXAM SPACE, and it keeps five things apart and never merges them:
 *
 *   1. EXAM MODEL          what the exam contains            (Exam Pack, pattern families)
 *   2. CONTENT MODEL       what questions/content exist      (question views with DNA + lifecycle)
 *   3. HISTORICAL EVIDENCE what was observed in legitimate history (historical records)
 *   4. STUDENT EVIDENCE    what a student did                (NOT read here - only aggregated,
 *                                                             non-identifying outcome measurements)
 *   5. INTELLIGENCE/SELECTION what should happen given 1+2+3+4 - owned by the training providers
 *
 * This package never reads a student, infers mastery, confidence or any mental
 * state, and never predicts a future paper: historical occurrence is reported
 * as historical occurrence only.
 */

/** A published/unpublished question as the exam-intelligence layer sees it: DNA + lifecycle + provenance KIND. No content, no answer, no reviewer data. */
export interface ContentQuestionView {
  id: string;
  dna: QuestionInstanceDna;
  validationState: ValidationState;
  /** The provenance KIND (never the reference or license). Null when unknown. */
  sourceType: ProvenanceSourceType | null;
  /** Content fingerprint, for duplicate detection. Null means duplicates cannot be checked for this question. */
  fingerprint: string | null;
  /** Synthetic test content. Excluded from coverage unless explicitly included. */
  isFixture: boolean;
}

/**
 * Everything the layer needs about ONE exam at ONE pack version, assembled by a
 * source (database or in-memory). Scoped by identity: a snapshot never contains
 * another exam's data on purpose, and every function re-checks.
 */
export interface ExamIntelligenceSnapshot {
  examCode: string;
  /** The pack's version identity. Intelligence is always "for this exam at this structure version". */
  examVersion: string;
  pack: ExamPack;
  patternFamilies: readonly QuestionPatternFamilyData[];
  /** `ErrorTaxonomy.code` values (the shared trap vocabulary). */
  errorTaxonomyCodes: readonly string[];
  questions: readonly ContentQuestionView[];
  historicalRecords: readonly HistoricalQuestionRecord[];
}

/**
 * The tiers of CONTENT availability. They nest strictly: published is a subset
 * of validated, which is a subset of available.
 *  - available: counted (right exam, valid metadata, not a duplicate/fixture/rejected), in ANY state
 *  - validated: ai_validated | human_reviewed | published
 *  - published: published (what a student can be trained on)
 */
export type ContentBasis = "available" | "validated" | "published";
export const CONTENT_BASES: readonly ContentBasis[] = ["available", "validated", "published"];

/** What a coverage number rests on. Content and historical evidence are NEVER mixed. */
export type CoverageBasis = "available_content" | "validated_content" | "published_content" | "historical_observed";

export const VALIDATED_STATES: readonly ValidationState[] = ["ai_validated", "human_reviewed", "published"];

/** The calibration status of an annotation. Nothing is `calibrated` unless an explicit, sufficient calibration record exists. */
export type CalibrationStatus = "provisional" | "observed" | "calibrated";

export class ExamIntelligenceError extends Error {
  constructor(readonly code: "exam_mismatch" | "invalid_constraint" | "unknown_concept" | "insufficient_data", message: string) {
    super(message);
    this.name = "ExamIntelligenceError";
  }
}
