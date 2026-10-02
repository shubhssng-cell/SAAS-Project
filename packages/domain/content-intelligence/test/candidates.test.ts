import { ipmatIndoreExamPack, validateExamPack } from "@ipmat/exam-pack";
import { describe, expect, it } from "vitest";
import {
  acceptCandidate,
  chunkDocument,
  createConceptMention,
  createQuestionCandidate,
  createRelationship,
  ESTABLISHED_RELATION_TYPES,
  extractDocument,
  matchConceptNames,
  proposeRelationPromotion,
  rejectCandidate,
  verifyEvidence,
  type Chunk,
  type ContentIntelligenceError,
  type Evidence
} from "../src/index.js";
import { FIXTURE_NOTES, REVIEW } from "./fixtures.js";

const VERSION = "ver_cand";
const chunks: Chunk[] = chunkDocument(extractDocument("markdown", FIXTURE_NOTES), VERSION);
const ctx = { pack: ipmatIndoreExamPack, chunks };
const chunk = chunks.find((c) => c.text.includes("parts per hundred"))!;
const evidenceFor = (quote: string, c: Chunk = chunk): Evidence => ({ chunkId: c.id, quote, charStart: c.text.indexOf(quote), charEnd: c.text.indexOf(quote) + quote.length });
const proposer = { kind: "ai_assisted" as const, proposedBy: "test-provider@1" };
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as ContentIntelligenceError).code;
  }
};

describe("evidence is verified, never trusted", () => {
  it("accepts a verbatim quote at its real span", () => expect(codeOf(() => verifyEvidence([evidenceFor("parts per hundred")], ctx, VERSION))).toBe("ok"));
  it("rejects a quote that is not in the chunk, a wrong span, an out-of-range span and a blank quote", () => {
    expect(codeOf(() => verifyEvidence([{ ...evidenceFor("parts per hundred"), quote: "invented words" }], ctx, VERSION))).toBe("unverifiable_evidence");
    expect(codeOf(() => verifyEvidence([{ ...evidenceFor("parts per hundred"), charStart: 0, charEnd: 5 }], ctx, VERSION))).toBe("unverifiable_evidence");
    expect(codeOf(() => verifyEvidence([{ ...evidenceFor("parts per hundred"), charEnd: 99999 }], ctx, VERSION))).toBe("unverifiable_evidence");
    expect(codeOf(() => verifyEvidence([{ chunkId: chunk.id, quote: " ", charStart: 0, charEnd: 1 }], ctx, VERSION))).toBe("unverifiable_evidence");
  });
  it("rejects a chunk from another version, an unknown chunk and no evidence at all", () => {
    expect(codeOf(() => verifyEvidence([evidenceFor("parts per hundred")], ctx, "ver_other"))).toBe("unverifiable_evidence");
    expect(codeOf(() => verifyEvidence([{ chunkId: "chk_nope", quote: "x", charStart: 0, charEnd: 1 }], ctx, VERSION))).toBe("unverifiable_evidence");
    expect(codeOf(() => verifyEvidence([], ctx, VERSION))).toBe("unverifiable_evidence");
  });
});

describe("concept mention candidates", () => {
  const mk = (name: string, quote = "Percentages") => createConceptMention({ examCode: "IPMAT_INDORE", sourceVersionId: VERSION, proposedName: name, evidence: [evidenceFor(quote)], proposer }, ctx);

  it("resolves a proposed name to a pack concept by NORMALIZED exact name only, and starts as a candidate", () => {
    const c = mk(" PERCENTAGES ");
    expect(c).toMatchObject({ kind: "concept_mention", conceptKey: "percentages", state: "candidate", review: null });
    expect(c.id).toMatch(/^cnd_/);
  });
  it("never fuzzy-matches: 'Percentage' is not 'Percentages' (D-030)", () => {
    expect(mk("Percentage").conceptKey).toBeNull();
  });
  it("is deterministic: the same proposal has the same id", () => {
    expect(mk("Percentages").id).toBe(mk("Percentages").id);
  });
  it("is protected from becoming canonical: a concept that is not in the pack can never be accepted", () => {
    const unknown = mk("Quantum Chromodynamics");
    expect(unknown.conceptKey).toBeNull();
    expect(codeOf(() => acceptCandidate(unknown, REVIEW))).toBe("canonical_concept_protected");
    expect(rejectCandidate(unknown, REVIEW).state).toBe("rejected"); // it may only be left or rejected
  });
  it("accepting a mention validates the LINK only: the pack is not modified", () => {
    const before = JSON.stringify(ipmatIndoreExamPack);
    const accepted = acceptCandidate(mk("Percentages"), REVIEW);
    expect(accepted).toMatchObject({ state: "accepted", review: REVIEW });
    expect(JSON.stringify(ipmatIndoreExamPack)).toBe(before);
  });
  it("requires a proposer, a name, a matching exam and evidence", () => {
    expect(codeOf(() => createConceptMention({ examCode: "OTHER", sourceVersionId: VERSION, proposedName: "Percentages", evidence: [evidenceFor("Percentages")], proposer }, ctx))).toBe("exam_mismatch");
    expect(codeOf(() => createConceptMention({ examCode: "IPMAT_INDORE", sourceVersionId: VERSION, proposedName: "Percentages", evidence: [evidenceFor("Percentages")], proposer: { kind: "ai_assisted", proposedBy: " " } }, ctx))).toBe("invalid_candidate");
    expect(codeOf(() => createConceptMention({ examCode: "IPMAT_INDORE", sourceVersionId: VERSION, proposedName: " ", evidence: [evidenceFor("Percentages")], proposer }, ctx))).toBe("invalid_candidate");
    expect(codeOf(() => createConceptMention({ examCode: "IPMAT_INDORE", sourceVersionId: VERSION, proposedName: "Percentages", evidence: [], proposer }, ctx))).toBe("unverifiable_evidence");
  });
});

describe("relationship candidates", () => {
  const mk = (over: Record<string, unknown> = {}) =>
    createRelationship({ examCode: "IPMAT_INDORE", sourceVersionId: VERSION, fromConceptKey: "ratio", toConceptKey: "percentages", relationType: "prerequisite", rationale: "The note says Ratio is required before Percentages.", evidence: [evidenceFor("Understanding Ratio is required before Percentages make sense")], proposer, ...over } as never, ctx);

  it("a candidate relationship with evidence is NOT an authoritative relation", () => {
    const r = mk();
    expect(r).toMatchObject({ kind: "relationship", state: "candidate", relationType: "prerequisite" });
    expect(ipmatIndoreExamPack.relations.some((x) => x.rationale === r.rationale)).toBe(false);
  });
  it.each(ESTABLISHED_RELATION_TYPES)("accepts the established type %s", (relationType) => {
    expect(codeOf(() => mk({ relationType }))).toBe("ok");
  });
  it.each(["example-of", "tested-by", "appears-in", "related-to", "relatedTo", "depends-on", "prerequisite-of", "unlocks", ""])("rejects the unestablished label %j - new types are never invented from extracted text", (relationType) => {
    expect(codeOf(() => mk({ relationType }))).toBe("unknown_relation_type");
  });
  it("rejects unknown concepts, self-relations, a missing rationale and unverifiable evidence", () => {
    expect(codeOf(() => mk({ fromConceptKey: "ghost" }))).toBe("unknown_concept");
    expect(codeOf(() => mk({ toConceptKey: "external:OTHER:x" }))).toBe("unknown_concept");
    expect(codeOf(() => mk({ fromConceptKey: "ratio", toConceptKey: "ratio" }))).toBe("invalid_candidate");
    expect(codeOf(() => mk({ rationale: " " }))).toBe("invalid_candidate");
    expect(codeOf(() => mk({ evidence: [{ ...evidenceFor("Understanding Ratio"), quote: "made up" }] }))).toBe("unverifiable_evidence");
  });
  it("preserves direction: ratio -> percentages and percentages -> ratio are different candidates", () => {
    expect(mk().id).not.toBe(mk({ fromConceptKey: "percentages", toConceptKey: "ratio" }).id);
  });
  it("review is final and needs a named reviewer with an ISO date", () => {
    const accepted = acceptCandidate(mk(), REVIEW);
    expect(codeOf(() => rejectCandidate(accepted, REVIEW))).toBe("invalid_transition");
    expect(codeOf(() => acceptCandidate(mk(), { reviewedBy: " ", reviewedAt: REVIEW.reviewedAt }))).toBe("invalid_transition");
    expect(codeOf(() => acceptCandidate(mk(), { reviewedBy: "x", reviewedAt: "yesterday" }))).toBe("invalid_transition");
  });
  it("only an ACCEPTED relationship can be proposed for promotion, and the proposal is checked against the pack (never applied)", () => {
    expect(codeOf(() => proposeRelationPromotion(mk(), ipmatIndoreExamPack))).toBe("invalid_transition");
    const accepted = acceptCandidate(mk({ fromConceptKey: "algebra", toConceptKey: "ratio", relationType: "application" }), REVIEW) as ReturnType<typeof mk>;
    const { relation, validation } = proposeRelationPromotion(accepted, ipmatIndoreExamPack);
    expect(relation).toMatchObject({ from: "algebra", to: "ratio", type: "application", source: "ai_suggested", certainty: "probable" });
    expect(relation.provenance).toMatchObject({ kind: "inferred", reviewState: "reviewed", reviewedBy: "fixture-reviewer" });
    expect(relation.provenance.sourceRef).toContain(accepted.evidence[0]!.chunkId);
    expect(validation.valid).toBe(true);
    expect(ipmatIndoreExamPack.relations).not.toContainEqual(relation); // the pack was NOT modified
  });
  it("a promotion that would break the pack (a prerequisite cycle) is caught before anything is promoted", () => {
    const cyc = acceptCandidate(mk({ fromConceptKey: "percentages", toConceptKey: "ratio", relationType: "prerequisite" }), REVIEW) as ReturnType<typeof mk>;
    const { validation } = proposeRelationPromotion(cyc, ipmatIndoreExamPack);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((i) => i.code)).toContain("forbidden_cycle");
    expect(validateExamPack(ipmatIndoreExamPack).valid).toBe(true);
  });
  it("a human-proposed relation is recorded as authored; a model's stays inferred", () => {
    const human = acceptCandidate(mk({ fromConceptKey: "algebra", toConceptKey: "ratio", relationType: "application", proposer: { kind: "human", proposedBy: "editor" } }), REVIEW) as ReturnType<typeof mk>;
    expect(proposeRelationPromotion(human, ipmatIndoreExamPack).relation).toMatchObject({ source: "human", provenance: { kind: "authored" } });
  });
});

describe("question candidates", () => {
  const qChunk = chunks.find((c) => c.blockKinds.includes("question"))!;
  const detected = extractDocument("plain_text", qChunk.text).blocks[0]!.question!;
  const mk = (over: Record<string, unknown> = {}) => createQuestionCandidate({ examCode: "IPMAT_INDORE", sourceVersionId: VERSION, detected, chunkId: qChunk.id, conceptKeys: ["percentages"], proposer: { kind: "deterministic", proposedBy: "boundary@1" }, ...over } as never, ctx);
  it("is a candidate with the whole chunk as verifiable evidence and its source location", () => {
    const q = mk();
    expect(q).toMatchObject({ kind: "question", state: "candidate" });
    expect(q.evidence[0]!.quote).toBe(qChunk.text);
  });
  it("rejects unknown concepts, a malformed question and a chunk of another version", () => {
    expect(codeOf(() => mk({ conceptKeys: ["ghost"] }))).toBe("unknown_concept");
    expect(codeOf(() => mk({ detected: { ...detected, options: ["only one"] } }))).toBe("invalid_candidate");
    expect(codeOf(() => mk({ chunkId: "chk_nope" }))).toBe("unverifiable_evidence");
  });
});

describe("deterministic concept matching", () => {
  const find = (text: string) => matchConceptNames({ ...chunk, text, id: "chk_x" }, ipmatIndoreExamPack);
  it("finds exact concept names on whole words, case-insensitively, with verbatim evidence", () => {
    const hits = find("About percentages and RATIO, plus Number   Systems.");
    expect(hits.map((h) => h.name)).toEqual(["Percentages", "Ratio"]); // 'Number   Systems' (extra spaces) is not the name
    expect(hits[0]!.evidence.quote).toBe("percentages");
  });
  it("never matches inside a longer word or a different form", () => {
    expect(find("Percentage and ratios and preratio").map((h) => h.name)).toEqual([]);
  });
  it("one proposal per concept per chunk, in text order", () => {
    expect(find("Ratio then Percentages then Ratio again").map((h) => h.name)).toEqual(["Ratio", "Percentages"]);
  });
});
