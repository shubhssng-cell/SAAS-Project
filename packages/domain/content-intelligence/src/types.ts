import type { RelationType } from "@ipmat/concept-graph";
import type { ProvenanceSourceType } from "@ipmat/question-engine";

/**
 * Content Intelligence (docs/DECISIONS.md D-085): turning AUTHORIZED source
 * material into structured, traceable exam intelligence.
 *
 * THE RULES THIS PACKAGE EXISTS TO ENFORCE
 *  - free-to-access is not free-to-copy: an unauthorized source cannot be
 *    registered, so it can never enter the pipeline or be persisted.
 *  - STRUCTURED INTELLIGENCE IS AUTHORITATIVE; embeddings are retrieval aids.
 *  - Everything extracted is a CANDIDATE until a named reviewer accepts it, and
 *    even an accepted candidate never edits the canonical Concept Universe or
 *    publishes a question - promotion is a separate, deliberate act.
 *  - Every claim carries evidence: a chunk, a verbatim quote, and a location.
 *  - No vendor, no model: providers are interfaces and their output is a
 *    candidate.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Same vocabulary as the historical-record layer (Prompt 2). A fixture can never be mistaken for a real source. */
export type SourceDataOrigin = "real_source" | "fixture";

export interface SourceInput {
  examCode: string;
  /** Stable, human-chosen key, unique per exam. Re-registering the same key returns the same source. */
  sourceKey: string;
  title: string;
  sourceType: ProvenanceSourceType;
  sourceRef: string | null;
  licenseRef: string | null;
  attributedTo: string | null;
  /** The owner / rights holder. Required unless the source is original or public domain. */
  authority: string | null;
  dataOrigin: SourceDataOrigin;
  fixtureLabel: string | null;
}

export interface SourceRecord extends SourceInput {
  /** Deterministic: derived from (examCode, sourceKey), so re-registration is idempotent. */
  id: string;
}

export type SourceFormat = "plain_text" | "markdown";

/**
 * The ingestion lifecycle of ONE version of a source (docs/DECISIONS.md D-085):
 *   registered -> accepted -> extracted -> normalized -> chunked -> enriched -> reviewed -> available
 * `failed` is a state a version can be in, remembering the stage that failed;
 * a retry resumes from that stage. A version is immutable once created: a
 * changed source is a NEW version and never overwrites earlier validated
 * intelligence.
 */
export const INGESTION_STATES = ["registered", "accepted", "extracted", "normalized", "chunked", "enriched", "reviewed", "available", "failed"] as const;
export type IngestionState = (typeof INGESTION_STATES)[number];
/** The stages that do work, in order (a version in `failed` remembers one of these). */
export const PIPELINE_STAGES = ["accepted", "extracted", "normalized", "chunked", "enriched"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface IngestionFailure {
  stage: PipelineStage;
  /** Stable, machine-readable. */
  code: string;
  /** Never contains source content. */
  message: string;
}

export interface SourceVersionRecord {
  id: string;
  sourceId: string;
  /** 1, 2, 3... per source, in order of first ingestion. */
  version: number;
  /** sha256 of the exact content as supplied. */
  contentHash: string;
  format: SourceFormat;
  byteLength: number;
  state: IngestionState;
  failure: IngestionFailure | null;
  /** How many times a pipeline run has been attempted on this version. */
  attempts: number;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export type BlockKind = "heading" | "paragraph" | "table" | "question";

/** Where something sits in the NORMALIZED text of one source version. Always present; never silently dropped. */
export interface SourceLocation {
  /** Inclusive 1-based line numbers. */
  lineStart: number;
  lineEnd: number;
  /** Half-open character offsets into the normalized text. */
  charStart: number;
  charEnd: number;
  /** Page, only where the format has pages (the supported formats do not). */
  page: number | null;
  /** The headings enclosing this location, outermost first. */
  headingPath: string[];
}

export interface ExtractedBlock {
  kind: BlockKind;
  text: string;
  location: SourceLocation;
  /** Heading level (1-6) for headings; null otherwise. */
  level: number | null;
  /** For `table` blocks: the parsed cells (header row first). */
  rows: string[][] | null;
  /** For `question` blocks: the detected structure. NOT validated - a candidate only. */
  question: DetectedQuestion | null;
}

export interface DetectedQuestion {
  label: string;
  stem: string;
  options: string[];
  /** An answer the SOURCE states, if any. A claim of the source, never verified here. */
  answerClaim: string | null;
}

export interface ExtractedDocument {
  normalizedText: string;
  normalizedTextHash: string;
  blocks: ExtractedBlock[];
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export type ChunkValidationState = "unreviewed" | "accepted" | "rejected";

export interface Chunk {
  /** Deterministic: sha256 of (source version, chunker config, ordinal, text hash). The same input always yields the same ids. */
  id: string;
  sourceVersionId: string;
  ordinal: number;
  text: string;
  textHash: string;
  location: SourceLocation;
  blockKinds: BlockKind[];
  /** A chunk existing says nothing about whether it is semantically correct or reviewed. */
  validationState: ChunkValidationState;
}

export interface ChunkerConfig {
  maxChars: number;
  /** Bumped when the chunking algorithm changes, so ids change with it. */
  algorithmVersion: number;
}

// ---------------------------------------------------------------------------
// Candidates and evidence
// ---------------------------------------------------------------------------

export type CandidateState = "candidate" | "accepted" | "rejected";
export type ProposerKind = "deterministic" | "ai_assisted" | "human";

export interface Proposer {
  kind: ProposerKind;
  /** Identifier of the proposing component (never a credential). Internal. */
  proposedBy: string;
}

/**
 * The traceable basis of a claim: a chunk, the exact quote, and where it is.
 * `quote` MUST be a verbatim substring of the chunk text at that span; a
 * provider cannot invent evidence (checked on every candidate).
 */
export interface Evidence {
  chunkId: string;
  quote: string;
  charStart: number;
  charEnd: number;
}

export interface CandidateReview {
  reviewedBy: string;
  /** ISO-8601, supplied by the caller. */
  reviewedAt: string;
}

interface CandidateBase {
  id: string;
  examCode: string;
  sourceVersionId: string;
  proposer: Proposer;
  evidence: Evidence[];
  state: CandidateState;
  review: CandidateReview | null;
}

/**
 * "This passage refers to concept X". Accepting it validates a MENTION LINK
 * (chunk -> concept); it never adds or edits a concept in the Concept Universe.
 * A proposal for a concept that is not in the pack has `conceptKey: null`: it
 * can be left as a candidate or rejected, never accepted (canonical concept
 * protection).
 */
export interface ConceptMentionCandidate extends CandidateBase {
  kind: "concept_mention";
  proposedName: string;
  /** The Exam Pack concept key it resolves to by normalized-name match, or null. */
  conceptKey: string | null;
}

/** Only the eight established relation types; anything else is rejected at creation. */
export interface RelationshipCandidate extends CandidateBase {
  kind: "relationship";
  fromConceptKey: string;
  toConceptKey: string;
  relationType: RelationType;
  rationale: string;
}

export interface QuestionCandidate extends CandidateBase {
  kind: "question";
  detected: DetectedQuestion;
  /** Pack concept keys the question appears to concern. Candidates only. */
  conceptKeys: string[];
}

export type Candidate = ConceptMentionCandidate | RelationshipCandidate | QuestionCandidate;
export type CandidateKind = Candidate["kind"];

export type ContentIssueCode =
  | "invalid_source"
  | "unauthorized_source"
  | "unsupported_format"
  | "empty_document"
  | "invalid_extraction"
  | "content_hash_mismatch"
  | "invalid_candidate"
  | "provider_error"
  | "unverifiable_evidence"
  | "unknown_concept"
  | "unknown_relation_type"
  | "canonical_concept_protected"
  | "invalid_transition"
  | "exam_mismatch";

export class ContentIntelligenceError extends Error {
  constructor(readonly code: ContentIssueCode, message: string, readonly details: Array<{ code: string; field: string; message: string }> = []) {
    super(message);
    this.name = "ContentIntelligenceError";
  }
}
