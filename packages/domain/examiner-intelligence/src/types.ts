import type { ExamRelevance, ProvenanceSourceType, QuestionDnaData } from "@ipmat/question-engine";

/**
 * Historical Examiner Intelligence (docs/DECISIONS.md D-083).
 *
 * THE CRITICAL PRINCIPLE: HISTORICAL EVIDENCE IS OBSERVED TESTING EVIDENCE,
 * NOT A PREDICTION OF FUTURE EXAM CONTENT. Nothing in this package scores,
 * ranks, forecasts or estimates the likelihood of anything appearing in a
 * future paper, and no type here has a field that could carry such a claim.
 *
 * Four things are kept apart and never merged into one object or score:
 *   exam knowledge space   = `@ipmat/exam-pack`
 *   observed testing space = a `HistoricalQuestionRecord` (this package)
 *   question representation= Question DNA (`HistoricalDnaClassification`)
 *   student evidence       = attempts/training (not referenced here at all)
 *
 * A historical record is a CLASSIFICATION RECORD about a question that
 * appeared in an exam. It deliberately has NO question text, options,
 * answer key or solution: persisting a copyrighted paper's content is not
 * authorized, and "free to access" is not "free to copy". It carries only a
 * locator (where to find the item in its source) and structured metadata.
 */

/**
 * The structural Question DNA of a historical question: EXACTLY the
 * existing `QuestionDnaData` vocabulary, minus the three fields that mean
 * something else here — `provenanceSourceType` and `validationState` are a
 * practice question's publication lifecycle (a historical record has its own
 * `source` and `annotationState`), and `examRelevance` is an editorial label
 * that is carried separately, with its basis, as `editorialRelevance`.
 * Nothing new is invented: pattern FAMILY (structure) is named, never
 * described here; the record itself is the question INSTANCE.
 */
export type HistoricalDnaClassification = Omit<QuestionDnaData, "provenanceSourceType" | "validationState" | "examRelevance">;

/** Is this a real item from an authorized historical source, or a labelled test fixture? Never ambiguous. */
export type HistoricalDataOrigin = "real_source" | "fixture";

/**
 * raw_imported         — the item is recorded with its source; NO classification exists yet.
 * candidate_annotation — a classification has been PROPOSED (by a person or a model); not authoritative.
 * reviewed_validated   — a named reviewer has confirmed the classification.
 * A model's proposal can never be `reviewed_validated` without a review record.
 */
export type HistoricalAnnotationState = "raw_imported" | "candidate_annotation" | "reviewed_validated";

export type AnnotationAuthorship = "human" | "ai_assisted";

export interface HistoricalSource {
  /** Same vocabulary as `Provenance.sourceType`. `original` is not a historical source (see validate). */
  sourceType: ProvenanceSourceType;
  sourceRef: string;
  /** Rights basis for holding the record; required unless the source is public domain. */
  licenseRef: string | null;
  attributedTo: string | null;
}

/** Where the item sits in its source. Pure metadata; never question content. */
export interface HistoricalExamLocator {
  /** Exam configuration/version label, only where legitimately known. */
  examVersion: string | null;
  year: number | null;
  session: string | null;
  /** e.g. "Q23" — a pointer into the source, not content. */
  questionLabel: string | null;
}

export interface AnnotationReview {
  reviewedBy: string;
  /** ISO-8601. */
  reviewedAt: string;
}

/**
 * An EDITORIAL annotation (a person's judgment of how typical the pattern is
 * of the exam). It is explicitly NOT historical evidence and NOT a
 * prediction; historical evidence is derived by counting reviewed records
 * (`summarizeObservedTesting`), never stored on a record.
 */
export interface EditorialRelevance {
  label: ExamRelevance;
  rationale: string;
  annotatedBy: string;
}

export interface HistoricalQuestionRecord {
  id: string;
  /** Every record belongs to exactly one exam; queries never cross it. */
  examCode: string;
  locator: HistoricalExamLocator;
  source: HistoricalSource;
  dataOrigin: HistoricalDataOrigin;
  /** Required for (and only for) fixtures: states what the fixture is and that it is not real evidence. */
  fixtureLabel: string | null;
  annotationState: HistoricalAnnotationState;
  /** null while `raw_imported`. */
  classification: HistoricalDnaClassification | null;
  /** null while `raw_imported`. */
  authorship: AnnotationAuthorship | null;
  /** Identifier of the proposing system, required for `ai_assisted` authorship. Internal; never student-visible. */
  proposedBy: string | null;
  /** Required for, and only for, `reviewed_validated`. */
  review: AnnotationReview | null;
  editorialRelevance: EditorialRelevance | null;
}

export type HistoricalIssueCode =
  | "exam_mismatch"
  | "invalid_record"
  | "invalid_locator"
  | "invalid_source"
  | "invalid_origin"
  | "invalid_state"
  | "invalid_review"
  | "invalid_editorial_relevance"
  | "unknown_section"
  | "unknown_chapter"
  | "unknown_concept"
  | "concept_not_in_chapter"
  | "unknown_pattern_family"
  | "unknown_trap"
  | "invalid_difficulty"
  | "invalid_expected_time"
  | "invalid_testing_modes"
  | "invalid_novelty"
  | "contradictory_metadata"
  | "duplicate_entries"
  | "missing_metadata";

export interface HistoricalIssue {
  code: HistoricalIssueCode;
  field: string;
  message: string;
}

export interface HistoricalValidationResult {
  valid: boolean;
  issues: HistoricalIssue[];
}
