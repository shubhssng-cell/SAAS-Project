import { describe, expect, it } from "vitest";
import { buildKnowledgeGraph, StaticExtractionProvider, validateGraph } from "../src/index.js";
import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { fixtureSource, makeEnv, REVIEW, rng } from "./fixtures.js";

/** Seeded-PRNG pipeline properties (no new dependency). The seed is in the test name. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const PIECES = [
  "# Heading",
  "## Percentages",
  "Percentages are parts per hundred. Ratio and Averages relate to them.",
  "Number Systems underlies Ratio.",
  "A plain paragraph with no concepts at all.",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "1. Stem about Percentages?\nA) one\nB) two\nAnswer: B",
  "Algebra and Probability appear here as well."
];
const doc = (seed: number): string => {
  const r = rng(seed);
  return Array.from({ length: 3 + Math.floor(r() * 10) }, () => PIECES[Math.floor(r() * PIECES.length)]).join("\n\n") + "\n";
};

async function run(seed: number, providers?: ConstructorParameters<typeof StaticExtractionProvider>[1]) {
  const env = makeEnv(providers ? { conceptProviders: [new StaticExtractionProvider("static", providers), ...[]] } : {});
  await env.pipeline.registerSource(fixtureSource());
  const content = doc(seed);
  const result = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content });
  return { env, content, result };
}

describe("property: ingestion over generated documents", () => {
  it.each(SEEDS)("seed %i: ingest succeeds, is idempotent, and a rerun creates exactly the same chunks and candidates", async (seed) => {
    const { env, content, result } = await run(seed);
    expect(result.failure).toBeNull();
    expect(result.version.state).toBe("enriched");
    const chunks = await env.repo.listChunks(result.version.id);
    const candidates = await env.repo.listCandidates(result.version.id);
    // a forced full re-run (as after a crash) converges on identical rows
    await env.repo.updateVersionState(result.version.id, { state: "registered", failure: null });
    const again = await env.pipeline.run(result.version.id, content);
    expect(again.failure).toBeNull();
    expect(await env.repo.listChunks(result.version.id)).toEqual(chunks);
    expect(await env.repo.listCandidates(result.version.id)).toEqual(candidates);
    expect((await env.repo.listVersions(result.version.id.length ? (await env.repo.findVersion(result.version.id))!.sourceId : "")).length).toBe(1);
  });

  it.each(SEEDS)("seed %i: every candidate's evidence is a verbatim quote from a real chunk of its version; none is ever auto-accepted", async (seed) => {
    const { env, result } = await run(seed);
    const chunks = new Map((await env.repo.listChunks(result.version.id)).map((c) => [c.id, c]));
    for (const c of await env.repo.listCandidates(result.version.id)) {
      expect(c.state).toBe("candidate");
      expect(c.review).toBeNull();
      expect(c.sourceVersionId).toBe(result.version.id);
      for (const e of c.evidence) expect(chunks.get(e.chunkId)!.text.slice(e.charStart, e.charEnd)).toBe(e.quote);
    }
  });

  it.each(SEEDS)("seed %i: hostile provider output is contained - invented quotes, unknown concepts and unestablished relations never become candidates", async (seed) => {
    const { env, result } = await run(seed, {
      concepts: () => [{ name: "Percentages", quote: "THIS TEXT IS NOT IN ANY CHUNK" }, { name: "Percentages", quote: "" }],
      relationships: () => [{ fromConceptName: "Ratio", toConceptName: "Percentages", relationType: "example-of", rationale: "r", quote: "Percentages" }]
    });
    const kinds = (await env.repo.listCandidates(result.version.id)).map((c) => c.kind);
    expect(kinds.every((k) => k === "question")).toBe(true); // only the deterministic boundary detector contributed
    expect(result.proposalProblems.some((p) => p.startsWith("unverifiable_evidence"))).toBe(true);
  });

  it.each(SEEDS)("seed %i: the knowledge graph over reviewed intelligence is always valid, and decided candidates survive a re-ingest of changed content", async (seed) => {
    const { env, result } = await run(seed);
    for (const c of await env.repo.listCandidates(result.version.id)) if (c.kind === "concept_mention" && c.conceptKey) await env.pipeline.reviewCandidate(c.id, "accept", REVIEW);
    const accepted = (await env.repo.listCandidates(result.version.id)).filter((c) => c.state === "accepted").map((c) => c.id).sort();
    await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content: doc(seed) + "\nExtra Ratio line.\n" });
    expect((await env.repo.listCandidates(result.version.id)).filter((c) => c.state === "accepted").map((c) => c.id).sort()).toEqual(accepted);
    const exam = await env.repo.loadExam("IPMAT_INDORE");
    const graph = buildKnowledgeGraph({ pack: ipmatIndoreExamPack, patternFamilies: [], questions: [], ...exam }, { includeFixtures: true, includeCandidates: true });
    expect(validateGraph(graph)).toEqual([]);
  });
});
