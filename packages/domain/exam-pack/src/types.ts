import type {
  Certainty,
  ConceptStatus,
  RelationSource,
  RelationType,
  RequirementLevel
} from "@ipmat/concept-graph";

/**
 * Exam Pack — a structured, machine-readable representation of ONE exam's
 * KNOWLEDGE SPACE (docs/DECISIONS.md D-082). Exam-agnostic: nothing in this
 * file (or any generic module of this package) names a specific exam; a
 * concrete exam is DATA built in `src/packs/`.
 *
 * A pack describes what the exam covers. It says NOTHING about any student:
 * a concept being in a pack never implies it is known, mastered or even
 * seen. No student-state, mastery or confidence field exists here, ever.
 */

/**
 * Where an artifact came from.
 * - canonical: the exam body's own published structure. Requires a source and a review.
 * - authored:  written by a person on this project (the default for hand-curated data).
 * - imported:  brought in from an external source; requires a license reference
 *              (free-to-access is NOT free-to-copy — CLAUDE.md content-rights rule).
 * - inferred:  proposed by a model or heuristic; never authoritative on its own.
 */
export type PackProvenanceKind = "canonical" | "authored" | "imported" | "inferred";

/** `reviewed` means a named person checked it; absence of a review is `unvalidated`, never implied. */
export type PackReviewState = "unvalidated" | "reviewed";

export interface PackProvenance {
  kind: PackProvenanceKind;
  /** Where this came from — mandatory, so every artifact is traceable. */
  sourceRef: string;
  /** Required for `imported`. */
  licenseRef: string | null;
  reviewState: PackReviewState;
  /** Required when `reviewState` is `reviewed`. */
  reviewedBy: string | null;
  /** Free-text caveat for maintainers; never student-visible. */
  note: string | null;
}

export interface PackSection {
  /** Stable, pack-unique key (see `isValidPackKey`). */
  key: string;
  name: string;
  /** Deterministic ordering among sections; unique and positive. */
  order: number;
  provenance: PackProvenance;
}

/**
 * One node of the syllabus hierarchy below a section. `parentKey: null`
 * means a top-level node of its section (what the persisted schema calls a
 * chapter). Deeper nesting is representable here; the persisted schema
 * currently only stores the top level (D-082 limitation).
 */
export interface SyllabusNode {
  key: string;
  sectionKey: string;
  parentKey: string | null;
  name: string;
  /** Unique among siblings (same section and parent). */
  order: number;
  provenance: PackProvenance;
}

export type ConceptImportanceLevel = "core" | "supporting" | "peripheral";

export interface PackConcept {
  key: string;
  /** Unique within the pack after `normalizeConceptNameKey()` (D-030). */
  name: string;
  /** The syllabus node this concept is located under. */
  syllabusNodeKey: string;
  description: string;
  status: ConceptStatus;
  /** Skills exercised by the concept. Empty when unknown — never guessed. */
  skills: string[];
  /** Names of question pattern families; owned by the question engine, referenced here only. */
  patternFamilyRefs: string[];
  /** Present only where justified; a rationale is mandatory. */
  importance: { level: ConceptImportanceLevel; rationale: string } | null;
  provenance: PackProvenance;
}

/** A typed relationship; the eight types and their metadata are `@ipmat/concept-graph`'s (D-013). */
export interface PackRelation {
  from: string;
  to: string;
  type: RelationType;
  rationale: string;
  sharedKnowledge: string;
  usefulForQuestionGeneration: boolean;
  requirementLevel: RequirementLevel;
  certainty: Certainty;
  source: RelationSource;
  provenance: PackProvenance;
}

/** Exam-specific vocabulary. Empty when no authoritative source is available. */
export interface PackTerm {
  term: string;
  definition: string;
  conceptKey: string | null;
  provenance: PackProvenance;
}

export interface ExamPack {
  examCode: string;
  /** Identity of THIS configuration of the exam's structure (not a student-visible value). */
  packVersion: string;
  name: string;
  provenance: PackProvenance;
  sections: PackSection[];
  syllabus: SyllabusNode[];
  concepts: PackConcept[];
  relations: PackRelation[];
  terminology: PackTerm[];
}

/**
 * Prefix marking a relation endpoint that names a concept OUTSIDE this
 * pack (e.g. a persisted edge pointing into another exam). It can never
 * resolve inside the pack, so validation reports it as a cross-exam relation.
 */
export const EXTERNAL_REFERENCE_PREFIX = "external:";

export type ExamPackIssueCode =
  | "invalid_exam_code"
  | "invalid_pack_identity"
  | "invalid_key"
  | "duplicate_key"
  | "duplicate_name"
  | "invalid_order"
  | "duplicate_order"
  | "unknown_section"
  | "unknown_syllabus_node"
  | "invalid_hierarchy"
  | "syllabus_cycle"
  | "duplicate_concept"
  | "unknown_concept"
  | "cross_exam_relation"
  | "self_relation"
  | "duplicate_relation"
  | "duplicate_symmetric_relation"
  | "malformed_relation"
  | "forbidden_cycle"
  | "malformed_concept"
  | "malformed_term"
  | "invalid_provenance"
  | "provenance_source_mismatch"
  | "unreviewed_inference_promoted"
  | "duplicate_exam_code"
  | "isolated_concept";

export interface ExamPackIssue {
  code: ExamPackIssueCode;
  severity: "error" | "warning";
  /** Human-readable pointer to the offending artifact. */
  subject: string;
  message: string;
}

export interface ExamPackValidationResult {
  /** True iff there are no `error` issues (warnings never block). */
  valid: boolean;
  issues: ExamPackIssue[];
}
