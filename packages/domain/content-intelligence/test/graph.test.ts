import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraph,
  EDGE_KINDS,
  EDGE_RULES,
  evidenceForConcept,
  neighbors,
  nodeId,
  patternsForConcept,
  questionsForPattern,
  sourcesForConcept,
  StaticExtractionProvider,
  validateGraph,
  whyRelated,
  type GraphInput,
  type KnowledgeGraph
} from "../src/index.js";
import { FIXTURE_NOTES, fixtureSource, makeEnv, otherExamPack, REVIEW } from "./fixtures.js";

const q = (id: string, examCode = "IPMAT_INDORE", conceptName = "Percentages", patternFamilyName = "Reverse Percentage") => ({ id, dna: { examCode, conceptName, patternFamilyName } });

async function loaded(opts: { relation?: boolean } = {}) {
  const relationProvider = new StaticExtractionProvider("rel-provider@1", {
    relationships: (chunk) => (chunk.text.includes("Understanding Ratio") ? [{ fromConceptName: "Number Systems", toConceptName: "Ratio", relationType: "foundational", rationale: "The note says Number Systems underlies both.", quote: "Number Systems underlies both" }] : [])
  });
  const env = makeEnv({ relationshipProviders: opts.relation === false ? [] : [relationProvider] });
  await env.pipeline.registerSource(fixtureSource());
  const ing = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content: FIXTURE_NOTES });
  const exam = await env.repo.loadExam("IPMAT_INDORE");
  const input = (): GraphInput => ({ pack: ipmatIndoreExamPack, patternFamilies: percentagesPatternFamilies, questions: [q("q1"), q("q2"), q("qx", "OTHER_EXAM")], ...exam });
  return { env, ing, exam, input };
}

describe("graph structure and identity", () => {
  it("builds typed nodes with stable, exam-scoped ids", async () => {
    const { input } = await loaded();
    const g = buildKnowledgeGraph(input(), { includeFixtures: true });
    expect(g.nodes.find((n) => n.id === "exam:IPMAT_INDORE:IPMAT_INDORE")).toMatchObject({ kind: "exam", label: "IPMAT Indore" });
    expect(g.nodes.some((n) => n.id === nodeId("concept", "IPMAT_INDORE", "percentages"))).toBe(true);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
    for (const n of g.nodes) expect(n.examCode).toBe("IPMAT_INDORE");
  });
  it("connects Exam -> Section -> Chapter -> Concept -> Pattern -> Question and Source -> Version -> Chunk, each with its own edge kind", async () => {
    const { input } = await loaded();
    const g = buildKnowledgeGraph(input(), { includeFixtures: true });
    const kinds = new Set(g.edges.map((e) => e.kind));
    for (const k of ["has_section", "has_chapter", "located_in", "concept_relation", "has_pattern", "instance_of", "about", "version_of", "derived_from"] as const) expect(kinds.has(k), k).toBe(true);
    expect(neighbors(g, nodeId("concept", "IPMAT_INDORE", "percentages"), ["located_in"])[0]!.other).toBe(nodeId("chapter", "IPMAT_INDORE", "quant/percentages"));
    expect(patternsForConcept(g, "percentages")).toEqual(["Percentage Point vs Percentage Change", "Percentage Share in Data Interpretation", "Reverse Percentage", "Successive Percentage Change"]);
    expect(questionsForPattern(g, "percentages/reverse-percentage")).toEqual(["q1", "q2"]);
  });
  it("there is no generic related-to edge: every edge kind is one of a fixed set, and concept relations carry one of the eight types", async () => {
    const { input } = await loaded();
    const g = buildKnowledgeGraph(input(), { includeFixtures: true });
    expect([...EDGE_KINDS].sort()).toEqual(Object.keys(EDGE_RULES).sort());
    for (const e of g.edges) {
      expect(EDGE_KINDS).toContain(e.kind);
      if (e.kind === "concept_relation") expect(["prerequisite", "foundational", "directly_related", "commonly_combined", "application", "dependent", "advanced_extension", "related_but_distinct"]).toContain(e.relationType);
      else expect(e.relationType).toBeNull();
    }
    expect(JSON.stringify(g)).not.toMatch(/relatedTo|related_to|"related"/);
  });
  it("preserves direction: Ratio -prerequisite-> Percentages exists, the reverse prerequisite does not", async () => {
    const { input } = await loaded();
    const g = buildKnowledgeGraph(input());
    const rel = g.edges.filter((e) => e.kind === "concept_relation" && e.relationType === "prerequisite");
    expect(rel.some((e) => e.from === nodeId("concept", "IPMAT_INDORE", "ratio") && e.to === nodeId("concept", "IPMAT_INDORE", "percentages"))).toBe(true);
    expect(rel.some((e) => e.from === nodeId("concept", "IPMAT_INDORE", "percentages") && e.to === nodeId("concept", "IPMAT_INDORE", "ratio"))).toBe(false);
  });
  it("is deterministic and a valid graph", async () => {
    const { input } = await loaded();
    expect(buildKnowledgeGraph(input(), { includeFixtures: true })).toEqual(buildKnowledgeGraph(input(), { includeFixtures: true }));
    expect(validateGraph(buildKnowledgeGraph(input(), { includeFixtures: true, includeCandidates: true }))).toEqual([]);
  });
});

describe("source evidence and the question 'why?'", () => {
  it("an UNREVIEWED extracted relation is absent by default (candidates are not authoritative) and present, labelled, only on request", async () => {
    const { input, env, ing } = await loaded();
    const candidate = (await env.repo.listCandidates(ing.version.id)).find((c) => c.kind === "relationship")!;
    expect(candidate.state).toBe("candidate");
    const key = (e: KnowledgeGraph) => whyRelated(e, "number-systems", "ratio");
    expect(key(buildKnowledgeGraph(input(), { includeFixtures: true }))).toEqual([]);
    const withCandidates = key(buildKnowledgeGraph(input(), { includeFixtures: true, includeCandidates: true }));
    expect(withCandidates).toHaveLength(1);
    expect(withCandidates[0]).toMatchObject({ from: "number-systems", to: "ratio", relationType: "foundational", basis: "candidate", provenance: { reviewState: "unvalidated" } });
  });
  it("an ACCEPTED relation is included with its evidence: source, version, location, verbatim quote and reviewer", async () => {
    const { input, env, ing } = await loaded();
    const candidate = (await env.repo.listCandidates(ing.version.id)).find((c) => c.kind === "relationship")!;
    await env.pipeline.reviewCandidate(candidate.id, "accept", REVIEW);
    const g = buildKnowledgeGraph({ ...input(), ...(await env.repo.loadExam("IPMAT_INDORE")) }, { includeFixtures: true });
    const [why] = whyRelated(g, "number-systems", "ratio");
    expect(why).toMatchObject({ relationType: "foundational", basis: "accepted_candidate", provenance: { kind: "ai_assisted", reviewState: "reviewed", reviewedBy: "fixture-reviewer" } });
    expect(why!.evidence[0]).toMatchObject({ quote: "Number Systems underlies both", sourceKey: "fixture-notes", sourceVersion: 1 });
    expect(why!.evidence[0]!.location.lineStart).toBeGreaterThan(0);
    expect(why!.evidence[0]!.location.headingPath).toContain("Percentages");
  });
  it("a REJECTED candidate never appears, even when candidates are requested", async () => {
    const { input, env, ing } = await loaded();
    const candidate = (await env.repo.listCandidates(ing.version.id)).find((c) => c.kind === "relationship")!;
    await env.pipeline.reviewCandidate(candidate.id, "reject", REVIEW);
    const g = buildKnowledgeGraph({ ...input(), ...(await env.repo.loadExam("IPMAT_INDORE")) }, { includeFixtures: true, includeCandidates: true });
    expect(whyRelated(g, "number-systems", "ratio")).toEqual([]);
  });
  it("a canonical relation is explained by the pack's own provenance, never 'the AI said so'", async () => {
    const { input } = await loaded();
    const [why] = whyRelated(buildKnowledgeGraph(input()), "ratio", "percentages").filter((w) => w.relationType === "prerequisite");
    expect(why).toMatchObject({ basis: "canonical", provenance: { kind: "authored", reviewState: "unvalidated" }, evidence: [] });
    expect(why!.provenance!.sourceRef).toMatch(/percentages\.ts/);
  });
  it("a concept that exists in both directions under different types explains both", async () => {
    const { input } = await loaded();
    const types = whyRelated(buildKnowledgeGraph(input()), "percentages", "ratio").map((w) => w.relationType).sort();
    expect(types).toEqual(["dependent", "prerequisite"]);
  });
  it("accepted concept mentions give evidence-for-concept and sources-for-concept, with versions", async () => {
    const { input, env, ing } = await loaded();
    for (const c of await env.repo.listCandidates(ing.version.id)) if (c.kind === "concept_mention" && c.conceptKey === "percentages") await env.pipeline.reviewCandidate(c.id, "accept", REVIEW);
    const g = buildKnowledgeGraph({ ...input(), ...(await env.repo.loadExam("IPMAT_INDORE")) }, { includeFixtures: true });
    expect(evidenceForConcept(g, "percentages").length).toBeGreaterThan(0);
    expect(sourcesForConcept(g, "percentages")).toEqual([{ sourceKey: "fixture-notes", sourceVersion: 1 }]);
    expect(evidenceForConcept(g, "ratio")).toEqual([]); // not accepted -> not intelligence
  });
  it("a new source version does not overwrite validated evidence from the old one; both are kept and distinguishable", async () => {
    const { input, env, ing } = await loaded({ relation: false });
    for (const c of await env.repo.listCandidates(ing.version.id)) if (c.kind === "concept_mention" && c.conceptKey === "percentages") await env.pipeline.reviewCandidate(c.id, "accept", REVIEW);
    const v2 = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content: FIXTURE_NOTES + "\nMore on Percentages.\n" });
    for (const c of await env.repo.listCandidates(v2.version.id)) if (c.kind === "concept_mention" && c.conceptKey === "percentages") await env.pipeline.reviewCandidate(c.id, "accept", REVIEW);
    const g = buildKnowledgeGraph({ ...input(), ...(await env.repo.loadExam("IPMAT_INDORE")) }, { includeFixtures: true });
    expect(sourcesForConcept(g, "percentages")).toEqual([{ sourceKey: "fixture-notes", sourceVersion: 1 }, { sourceKey: "fixture-notes", sourceVersion: 2 }]);
  });
  it("a proposal for a concept outside the pack is never a graph edge", async () => {
    const env = makeEnv({ conceptProviders: [new StaticExtractionProvider("p", { concepts: (c) => (c.text.includes("parts per hundred") ? [{ name: "Imaginary Concept", quote: "parts per hundred" }] : []) })] });
    await env.pipeline.registerSource(fixtureSource());
    const ing = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content: FIXTURE_NOTES });
    const exam = await env.repo.loadExam("IPMAT_INDORE");
    const g = buildKnowledgeGraph({ pack: ipmatIndoreExamPack, patternFamilies: [], questions: [], ...exam }, { includeFixtures: true, includeCandidates: true });
    expect(g.nodes.some((n) => /imaginary/i.test(n.label))).toBe(false);
    expect((await env.repo.listCandidates(ing.version.id)).some((c) => c.kind === "concept_mention" && c.conceptKey === null)).toBe(true);
  });
});

describe("source visibility defaults and cross-exam isolation", () => {
  it("fixture sources are excluded unless asked for", async () => {
    const { input } = await loaded();
    expect(buildKnowledgeGraph(input()).nodes.filter((n) => n.kind === "source")).toEqual([]);
    expect(buildKnowledgeGraph(input(), { includeFixtures: true }).nodes.filter((n) => n.kind === "source")).toHaveLength(1);
  });
  it("another exam's questions never become nodes of this exam's graph", async () => {
    const { input } = await loaded();
    const g = buildKnowledgeGraph(input(), { includeFixtures: true });
    expect(g.nodes.some((n) => n.key === "qx")).toBe(false);
    const other = buildKnowledgeGraph({ ...input(), pack: otherExamPack(), patternFamilies: [], questions: [q("qx", "OTHER_EXAM"), q("q1")] }, { includeFixtures: true });
    expect(other.examCode).toBe("OTHER_EXAM");
    expect(other.nodes.filter((n) => n.kind === "question").map((n) => n.key)).toEqual(["qx"]);
    expect(other.nodes.filter((n) => n.kind === "source")).toEqual([]); // IPMAT's sources are not OTHER_EXAM's
  });
  it("candidates of another exam are ignored", async () => {
    const { input, exam } = await loaded();
    const g = buildKnowledgeGraph({ ...input(), pack: otherExamPack(), patternFamilies: [], questions: [], candidates: exam.candidates }, { includeFixtures: true, includeCandidates: true });
    expect(g.edges.some((e) => e.kind === "mentions")).toBe(false);
  });
});

describe("validateGraph catches malformed graphs", () => {
  const base = async () => buildKnowledgeGraph((await loaded()).input(), { includeFixtures: true });
  const issues = async (f: (g: KnowledgeGraph) => void) => {
    const g = structuredClone(await base());
    f(g);
    return validateGraph(g).map((i) => i.code);
  };
  it("dangling endpoints, duplicates, cross-exam nodes and wrong endpoint kinds", async () => {
    expect(await issues((g) => { g.edges[0]!.to = "concept:IPMAT_INDORE:ghost"; })).toContain("dangling_edge");
    expect(await issues((g) => { g.edges.push({ ...g.edges[0]! }); })).toContain("duplicate_edge");
    expect(await issues((g) => { g.nodes.push({ ...g.nodes[0]! }); })).toContain("duplicate_node");
    expect(await issues((g) => { g.nodes[0]!.examCode = "OTHER_EXAM"; })).toContain("cross_exam_edge");
    expect(await issues((g) => { const e = g.edges.find((x) => x.kind === "located_in")!; e.kind = "has_pattern"; })).toContain("invalid_edge_endpoints");
  });
  it("relation types: a concept relation needs one of the eight; others must have none", async () => {
    expect(await issues((g) => { g.edges.find((e) => e.kind === "concept_relation")!.relationType = "related_to" as never; })).toContain("invalid_relation_type");
    expect(await issues((g) => { g.edges.find((e) => e.kind === "located_in")!.relationType = "prerequisite"; })).toContain("invalid_relation_type");
  });
  it("an extracted edge without evidence is invalid; a structural edge cannot carry extracted evidence", async () => {
    expect(await issues((g) => { const e = g.edges.find((x) => x.kind === "concept_relation")!; e.basis = "accepted_candidate"; e.evidence = []; })).toContain("missing_evidence");
    expect(await issues((g) => { const e = g.edges.find((x) => x.kind === "located_in")!; e.evidence = [{ chunkId: "c", quote: "q", charStart: 0, charEnd: 1, sourceKey: "s", sourceTitle: "t", sourceVersion: 1, location: { lineStart: 1, lineEnd: 1, charStart: 0, charEnd: 1, page: null, headingPath: [] } }]; })).toContain("unexpected_evidence");
  });
});
