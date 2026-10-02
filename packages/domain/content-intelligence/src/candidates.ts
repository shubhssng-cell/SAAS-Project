import { createHash } from "node:crypto";
import { normalizeConceptNameKey, type RelationType } from "@ipmat/concept-graph";
import { validateExamPack, type ExamPack, type ExamPackValidationResult, type PackRelation } from "@ipmat/exam-pack";
import {
  ContentIntelligenceError,
  type Candidate,
  type CandidateReview,
  type Chunk,
  type ConceptMentionCandidate,
  type DetectedQuestion,
  type Evidence,
  type Proposer,
  type QuestionCandidate,
  type RelationshipCandidate
} from "./types.js";

/**
 * Candidates and evidence (docs/DECISIONS.md D-085). A candidate is a
 * PROPOSAL: it can be accepted or rejected by a named reviewer, and even an
 * accepted candidate never edits the canonical Concept Universe or publishes
 * a question. What the pipeline never does is as important as what it does:
 *  - a provider cannot invent evidence: every quote must be a verbatim
 *    substring of a real chunk at the stated span;
 *  - relationship candidates may only use the EIGHT established relation types;
 *  - a concept that is not in the Exam Pack can never be "accepted" (it would
 *    be a new canonical concept, which is a separate, deliberate act).
 */

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
const norm = normalizeConceptNameKey;

export const ESTABLISHED_RELATION_TYPES: readonly RelationType[] = ["prerequisite", "foundational", "directly_related", "commonly_combined", "application", "dependent", "advanced_extension", "related_but_distinct"];

export interface CandidateContext {
  pack: ExamPack;
  /** The chunks of the source version the candidate is about. */
  chunks: readonly Chunk[];
}

const candidateId = (parts: string[]): string => `cnd_${sha(parts.join("|")).slice(0, 32)}`;

/** The evidence is real: the chunk exists in THIS version, the span is in range, and the quote is exactly what the chunk says there. */
export function verifyEvidence(evidence: readonly Evidence[], ctx: CandidateContext, sourceVersionId: string): void {
  if (evidence.length === 0) throw new ContentIntelligenceError("unverifiable_evidence", "a candidate needs at least one piece of evidence");
  for (const e of evidence) {
    const chunk = ctx.chunks.find((c) => c.id === e.chunkId);
    if (!chunk || chunk.sourceVersionId !== sourceVersionId) throw new ContentIntelligenceError("unverifiable_evidence", `evidence references a chunk that is not part of this source version`);
    if (!Number.isInteger(e.charStart) || !Number.isInteger(e.charEnd) || e.charStart < 0 || e.charEnd <= e.charStart || e.charEnd > chunk.text.length) throw new ContentIntelligenceError("unverifiable_evidence", "evidence span is outside its chunk");
    if (blank(e.quote) || chunk.text.slice(e.charStart, e.charEnd) !== e.quote) throw new ContentIntelligenceError("unverifiable_evidence", "the evidence quote is not a verbatim substring of the chunk at the stated span");
  }
}

function checkProposer(p: Proposer): void {
  if (!p || !["deterministic", "ai_assisted", "human"].includes(p.kind) || blank(p.proposedBy)) throw new ContentIntelligenceError("invalid_candidate", "a candidate must identify its proposer");
}

const conceptByName = (pack: ExamPack, name: string) => pack.concepts.find((c) => norm(c.name) === norm(name)) ?? null;

export function createConceptMention(input: { examCode: string; sourceVersionId: string; proposedName: string; evidence: Evidence[]; proposer: Proposer }, ctx: CandidateContext): ConceptMentionCandidate {
  if (input.examCode !== ctx.pack.examCode) throw new ContentIntelligenceError("exam_mismatch", `candidate is for "${input.examCode}" but the pack is "${ctx.pack.examCode}"`);
  checkProposer(input.proposer);
  if (blank(input.proposedName)) throw new ContentIntelligenceError("invalid_candidate", "a concept mention needs a proposed concept name");
  verifyEvidence(input.evidence, ctx, input.sourceVersionId);
  const concept = conceptByName(ctx.pack, input.proposedName);
  const first = input.evidence[0]!;
  return {
    kind: "concept_mention",
    id: candidateId(["concept_mention", input.sourceVersionId, first.chunkId, concept?.key ?? `~${norm(input.proposedName)}`, String(first.charStart)]),
    examCode: input.examCode,
    sourceVersionId: input.sourceVersionId,
    proposedName: input.proposedName,
    conceptKey: concept?.key ?? null,
    proposer: input.proposer,
    evidence: input.evidence,
    state: "candidate",
    review: null
  };
}

export function createRelationship(
  input: { examCode: string; sourceVersionId: string; fromConceptKey: string; toConceptKey: string; relationType: string; rationale: string; evidence: Evidence[]; proposer: Proposer },
  ctx: CandidateContext
): RelationshipCandidate {
  if (input.examCode !== ctx.pack.examCode) throw new ContentIntelligenceError("exam_mismatch", `candidate is for "${input.examCode}" but the pack is "${ctx.pack.examCode}"`);
  checkProposer(input.proposer);
  if (!ESTABLISHED_RELATION_TYPES.includes(input.relationType as RelationType)) {
    throw new ContentIntelligenceError("unknown_relation_type", `"${input.relationType}" is not one of the eight established relation types; new relation types are never invented from extracted text`);
  }
  for (const key of [input.fromConceptKey, input.toConceptKey]) {
    if (!ctx.pack.concepts.some((c) => c.key === key)) throw new ContentIntelligenceError("unknown_concept", `"${key}" is not a concept of ${ctx.pack.examCode}`);
  }
  if (input.fromConceptKey === input.toConceptKey) throw new ContentIntelligenceError("invalid_candidate", "a concept cannot be related to itself");
  if (blank(input.rationale)) throw new ContentIntelligenceError("invalid_candidate", "a relationship candidate needs a rationale, never a bare label");
  verifyEvidence(input.evidence, ctx, input.sourceVersionId);
  const first = input.evidence[0]!;
  return {
    kind: "relationship",
    id: candidateId(["relationship", input.sourceVersionId, input.fromConceptKey, input.toConceptKey, input.relationType, first.chunkId, String(first.charStart)]),
    examCode: input.examCode,
    sourceVersionId: input.sourceVersionId,
    fromConceptKey: input.fromConceptKey,
    toConceptKey: input.toConceptKey,
    relationType: input.relationType as RelationType,
    rationale: input.rationale,
    proposer: input.proposer,
    evidence: input.evidence,
    state: "candidate",
    review: null
  };
}

export function createQuestionCandidate(
  input: { examCode: string; sourceVersionId: string; detected: DetectedQuestion; chunkId: string; conceptKeys: string[]; proposer: Proposer },
  ctx: CandidateContext
): QuestionCandidate {
  if (input.examCode !== ctx.pack.examCode) throw new ContentIntelligenceError("exam_mismatch", `candidate is for "${input.examCode}" but the pack is "${ctx.pack.examCode}"`);
  checkProposer(input.proposer);
  const chunk = ctx.chunks.find((c) => c.id === input.chunkId);
  if (!chunk) throw new ContentIntelligenceError("unverifiable_evidence", "the question's chunk is not part of this source version");
  if (blank(input.detected.stem) || input.detected.options.length < 2) throw new ContentIntelligenceError("invalid_candidate", "a question candidate needs a stem and at least two options");
  for (const key of input.conceptKeys) if (!ctx.pack.concepts.some((c) => c.key === key)) throw new ContentIntelligenceError("unknown_concept", `"${key}" is not a concept of ${ctx.pack.examCode}`);
  const evidence: Evidence[] = [{ chunkId: chunk.id, quote: chunk.text, charStart: 0, charEnd: chunk.text.length }];
  verifyEvidence(evidence, ctx, input.sourceVersionId);
  return {
    kind: "question",
    id: candidateId(["question", input.sourceVersionId, chunk.id, input.detected.label]),
    examCode: input.examCode,
    sourceVersionId: input.sourceVersionId,
    detected: input.detected,
    conceptKeys: [...input.conceptKeys],
    proposer: input.proposer,
    evidence,
    state: "candidate",
    review: null
  };
}

/** The only thing that can accept or reject: a named reviewer. Decisions are final (no resurrecting a rejected candidate). */
function decide(candidate: Candidate, state: "accepted" | "rejected", review: CandidateReview): Candidate {
  if (candidate.state !== "candidate") throw new ContentIntelligenceError("invalid_transition", `a ${candidate.state} candidate cannot be ${state}`);
  if (blank(review?.reviewedBy) || typeof review.reviewedAt !== "string" || Number.isNaN(Date.parse(review.reviewedAt))) throw new ContentIntelligenceError("invalid_transition", "a decision needs a named reviewer and an ISO date");
  return { ...candidate, state, review: { ...review } };
}

export function acceptCandidate(candidate: Candidate, review: CandidateReview): Candidate {
  if (candidate.kind === "concept_mention" && candidate.conceptKey === null) {
    throw new ContentIntelligenceError("canonical_concept_protected", `"${candidate.proposedName}" is not a concept in the Exam Pack; accepting it would create a canonical concept, which is a separate, deliberate act (it can only be left as a candidate or rejected)`);
  }
  return decide(candidate, "accepted", review);
}

export function rejectCandidate(candidate: Candidate, review: CandidateReview): Candidate {
  return decide(candidate, "rejected", review);
}

/**
 * Turns an ACCEPTED relationship candidate into a PROPOSAL for the Exam Pack -
 * never an edit. Provenance records exactly what it is: reviewed, with the
 * source chunk as its reference; an AI-proposed relation stays `inferred` and
 * `ai_suggested`; certainty is `probable`, never `confirmed` from a candidate.
 * Returns the proposal and what `validateExamPack` says about the pack WITH it
 * (so a cycle or duplicate is caught before anything is promoted). The
 * pipeline never applies it.
 */
export function proposeRelationPromotion(candidate: RelationshipCandidate, pack: ExamPack): { relation: PackRelation; validation: ExamPackValidationResult } {
  if (candidate.state !== "accepted" || !candidate.review) throw new ContentIntelligenceError("invalid_transition", "only an accepted relationship candidate can be proposed for promotion");
  const human = candidate.proposer.kind === "human";
  const relation: PackRelation = {
    from: candidate.fromConceptKey,
    to: candidate.toConceptKey,
    type: candidate.relationType,
    rationale: candidate.rationale,
    sharedKnowledge: candidate.evidence[0]!.quote,
    usefulForQuestionGeneration: false,
    requirementLevel: "contextual",
    certainty: "probable",
    source: human ? "human" : "ai_suggested",
    provenance: {
      kind: human ? "authored" : "inferred",
      sourceRef: `source-version:${candidate.sourceVersionId}#${candidate.evidence[0]!.chunkId}`,
      licenseRef: null,
      reviewState: "reviewed",
      reviewedBy: candidate.review.reviewedBy,
      note: `promotion proposal from candidate ${candidate.id}`
    }
  };
  return { relation, validation: validateExamPack({ ...pack, relations: [...pack.relations, relation] }) };
}

// ---------------------------------------------------------------------------
// Deterministic concept matching (preferred over a model wherever it suffices)
// ---------------------------------------------------------------------------

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds Exam Pack concept NAMES in a chunk, case-insensitively and on whole
 * words only. Exact name match: "Percentage" is not "Percentages" (D-030); no
 * stemming, no fuzzy matching. One proposal per concept per chunk, evidenced by
 * its first occurrence, in a stable order.
 */
export function matchConceptNames(chunk: Chunk, pack: ExamPack): Array<{ name: string; evidence: Evidence }> {
  const found: Array<{ name: string; evidence: Evidence; key: string }> = [];
  for (const concept of pack.concepts) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(concept.name)}(?![\\p{L}\\p{N}])`, "iu");
    const m = re.exec(chunk.text);
    if (m) found.push({ name: concept.name, key: concept.key, evidence: { chunkId: chunk.id, quote: m[0], charStart: m.index, charEnd: m.index + m[0].length } });
  }
  return found.sort((a, b) => a.evidence.charStart - b.evidence.charStart || (a.key < b.key ? -1 : 1)).map(({ name, evidence }) => ({ name, evidence }));
}
