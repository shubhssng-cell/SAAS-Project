import { describe, expect, it } from "vitest";
import {
  ContentAccessDeniedError,
  EvidenceRetriever,
  HashingEmbeddingProvider,
  LexicalRetrievalIndex,
  VectorRetrievalIndex,
  type ContentPrincipal,
  type EmbeddingProvider,
  type RetrievalDocument,
  type RetrievalIndex
} from "../src/index.js";
import { FIXTURE_NOTES, fixtureSource, makeEnv } from "./fixtures.js";

const admin: ContentPrincipal = { role: "content_admin", examCodes: ["IPMAT_INDORE"] };
const doc = (chunkId: string, text: string, over: Partial<RetrievalDocument> = {}): RetrievalDocument => ({ chunkId, examCode: "IPMAT_INDORE", sourceVersionId: "v", dataOrigin: "real_source", chunkState: "unreviewed", text, ...over });
const q = (text: string, over: Record<string, unknown> = {}) => ({ examCode: "IPMAT_INDORE", text, limit: 5, ...over });

const implementations: Array<[string, () => RetrievalIndex]> = [
  ["lexical", () => new LexicalRetrievalIndex()],
  ["vector (hashing stand-in)", () => new VectorRetrievalIndex(new HashingEmbeddingProvider(64))]
];

describe.each(implementations)("RetrievalIndex contract: %s", (_name, make) => {
  const corpus = [
    doc("a", "percentages are parts per hundred and ratio comparisons"),
    doc("b", "weighted averages combine unequal groups"),
    doc("c", "probability of independent events multiplies"),
    doc("d", "ratio and proportion of quantities")
  ];
  const build = async () => {
    const index = make();
    await index.upsert(corpus);
    return index;
  };

  it("ranks the relevant chunk first and is deterministic (score desc, id asc)", async () => {
    const index = await build();
    const a = await index.search(q("parts per hundred percentages"));
    expect(a[0]!.chunkId).toBe("a");
    expect(await index.search(q("parts per hundred percentages"))).toEqual(a);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.score).toBeGreaterThanOrEqual(a[i]!.score);
  });
  it("returns only ids and scores - never text", async () => {
    const hits = await (await build()).search(q("ratio"));
    for (const h of hits) expect(Object.keys(h).sort()).toEqual(["chunkId", "matchedBy", "score"]);
  });
  it("respects the limit", async () => {
    const index = await build();
    expect((await index.search(q("ratio", { limit: 1 }))).length).toBeLessThanOrEqual(1);
    expect(await index.search(q("ratio", { limit: 0 }))).toEqual([]);
  });
  it("never searches across exams: another exam's chunks are not even candidates", async () => {
    const index = make();
    await index.upsert([doc("ipmat-1", "percentages ratio"), doc("other-1", "percentages ratio", { examCode: "OTHER_EXAM" })]);
    expect((await index.search(q("percentages ratio"))).map((h) => h.chunkId)).toEqual(["ipmat-1"]);
    expect((await index.search({ ...q("percentages ratio"), examCode: "OTHER_EXAM" })).map((h) => h.chunkId)).toEqual(["other-1"]);
    expect(await index.search({ ...q("percentages ratio"), examCode: "NO_EXAM" })).toEqual([]);
  });
  it("excludes fixtures unless asked, and rejected chunks always", async () => {
    const index = make();
    await index.upsert([doc("real", "ratio words"), doc("fix", "ratio words", { dataOrigin: "fixture" }), doc("rej", "ratio words", { chunkState: "rejected" })]);
    expect((await index.search(q("ratio words"))).map((h) => h.chunkId)).toEqual(["real"]);
    expect((await index.search(q("ratio words", { includeFixtures: true }))).map((h) => h.chunkId).sort()).toEqual(["fix", "real"]);
  });
  it("upsert replaces and remove deletes", async () => {
    const index = make();
    await index.upsert([doc("x", "alpha beta")]);
    await index.upsert([doc("x", "gamma delta")]);
    expect(await index.search(q("alpha"))).toEqual([]);
    expect((await index.search(q("gamma")))[0]!.chunkId).toBe("x");
    await index.remove(["x"]);
    expect(await index.search(q("gamma"))).toEqual([]);
  });
});

describe("lexical specifics", () => {
  it("returns nothing for a query that shares no term with any chunk", async () => {
    const index = new LexicalRetrievalIndex();
    await index.upsert([doc("a", "percentages are parts per hundred")]);
    expect(await index.search(q("zzzz qqqq"))).toEqual([]);
  });
});

describe("embeddings are retrieval aids behind an abstraction", () => {
  it("the vector index depends only on the EmbeddingProvider interface: any provider plugs in", async () => {
    const calls: string[][] = [];
    const custom: EmbeddingProvider = { name: "custom-test-provider", dimensions: 3, embed: async (texts) => { calls.push([...texts]); return texts.map((t) => (t.includes("alpha") ? [1, 0, 0] : [0, 1, 0])); } };
    const index = new VectorRetrievalIndex(custom);
    await index.upsert([doc("a", "alpha thing"), doc("b", "beta thing")]);
    expect((await index.search(q("alpha"))).map((h) => h.chunkId)).toEqual(["a"]);
    expect(index.name).toContain("custom-test-provider");
    expect(calls.length).toBeGreaterThan(0);
  });
  it("an invalid vector from a provider is refused, never stored", async () => {
    const bad: EmbeddingProvider = { name: "bad", dimensions: 3, embed: async (t) => t.map(() => [Number.NaN, 0, 0]) };
    await expect(new VectorRetrievalIndex(bad).upsert([doc("a", "x")])).rejects.toMatchObject({ code: "invalid_candidate" });
    const wrongSize: EmbeddingProvider = { name: "wrong", dimensions: 3, embed: async (t) => t.map(() => [1, 0]) };
    await expect(new VectorRetrievalIndex(wrongSize).upsert([doc("a", "x")])).rejects.toBeDefined();
  });
  it("the stand-in embedder is deterministic, normalized, and labelled as NOT semantic", async () => {
    const e = new HashingEmbeddingProvider(32);
    const [v1, v2] = await e.embed(["same words", "same words"]);
    expect(v1).toEqual(v2);
    expect(Math.hypot(...v1!)).toBeCloseTo(1, 6);
    expect(e.name).toMatch(/not a semantic model/);
  });
  it("a vector index never stores or returns text", async () => {
    const index = new VectorRetrievalIndex(new HashingEmbeddingProvider(16));
    await index.upsert([doc("a", "SECRET-SOURCE-TEXT here")]);
    expect(JSON.stringify([...(index as unknown as { rows: Map<string, unknown> }).rows.values()])).not.toContain("SECRET-SOURCE-TEXT");
    expect(JSON.stringify(await index.search(q("SECRET-SOURCE-TEXT")))).not.toContain("SECRET-SOURCE-TEXT");
  });
});

describe("EvidenceRetriever: structured data is authoritative, authorization is checked on every read", () => {
  async function build(index: RetrievalIndex = new LexicalRetrievalIndex()) {
    const env = makeEnv();
    await env.pipeline.registerSource(fixtureSource());
    const ing = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "markdown", content: FIXTURE_NOTES });
    const retriever = new EvidenceRetriever(env.repo, index);
    await retriever.indexExam("IPMAT_INDORE");
    return { env, ing, retriever, index };
  }

  it("content staff retrieve source evidence with text, location and source traceability", async () => {
    const { retriever } = await build();
    const results = await retriever.retrieve(admin, q("parts per hundred percentage", { includeFixtures: true }));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ matchedBy: "lexical", source: { sourceKey: "fixture-notes", version: 1 } });
    expect(results[0]!.text).toContain("parts per hundred");
    expect(results[0]!.location.lineStart).toBeGreaterThan(0);
  });
  it.each(["student", "anonymous"] as const)("a %s principal is DENIED: embeddings and search do not bypass authorization", async (role) => {
    const { retriever } = await build();
    await expect(retriever.retrieve({ role, examCodes: ["IPMAT_INDORE"] }, q("percentages", { includeFixtures: true }))).rejects.toBeInstanceOf(ContentAccessDeniedError);
  });
  it("staff for another exam are denied for this one", async () => {
    const { retriever } = await build();
    await expect(retriever.retrieve({ role: "content_admin", examCodes: ["OTHER_EXAM"] }, q("percentages", { includeFixtures: true }))).rejects.toBeInstanceOf(ContentAccessDeniedError);
  });
  it("fixtures are excluded by default even from authorized staff", async () => {
    const { retriever } = await build();
    expect(await retriever.retrieve(admin, q("percentages"))).toEqual([]);
  });
  it("a stale or hostile index cannot widen access: hits are re-resolved through the exam-scoped structured data", async () => {
    const poisoned: RetrievalIndex = { name: "poisoned", upsert: async () => {}, remove: async () => {}, search: async () => [{ chunkId: "chk_from_another_exam", score: 9, matchedBy: "vector" }, { chunkId: "chk_deleted", score: 8, matchedBy: "vector" }] };
    const { retriever } = await build(poisoned);
    expect(await retriever.retrieve(admin, q("anything", { includeFixtures: true }))).toEqual([]);
  });
  it("a chunk rejected after indexing disappears from results (structured validation wins over the index)", async () => {
    const { retriever, env, ing } = await build();
    const chunks = await env.repo.listChunks(ing.version.id);
    const target = chunks.find((c) => c.text.includes("parts per hundred"))!;
    expect((await retriever.retrieve(admin, q("parts per hundred", { includeFixtures: true }))).map((r) => r.chunkId)).toContain(target.id);
    await env.repo.setChunkValidation(target.id, "rejected");
    expect((await retriever.retrieve(admin, q("parts per hundred", { includeFixtures: true }))).map((r) => r.chunkId)).not.toContain(target.id);
  });
  it("works identically over the vector implementation (the abstraction holds)", async () => {
    const { retriever } = await build(new VectorRetrievalIndex(new HashingEmbeddingProvider(64)));
    const results = await retriever.retrieve(admin, q("parts per hundred percentage", { includeFixtures: true }));
    expect(results[0]).toMatchObject({ matchedBy: "vector" });
    expect(results[0]!.text).toContain("hundred");
  });
  it("indexing is idempotent", async () => {
    const { retriever } = await build();
    const a = await retriever.retrieve(admin, q("percentage", { includeFixtures: true }));
    await retriever.indexExam("IPMAT_INDORE");
    await retriever.indexExam("IPMAT_INDORE");
    expect(await retriever.retrieve(admin, q("percentage", { includeFixtures: true }))).toEqual(a);
  });
});
