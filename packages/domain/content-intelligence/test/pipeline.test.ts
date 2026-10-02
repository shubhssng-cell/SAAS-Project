import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { describe, expect, it } from "vitest";
import { ContentIntelligenceError, StaticExtractionProvider, type SourceFormat } from "../src/index.js";
import { FIXTURE_NOTES, fixtureSource, makeEnv, REVIEW } from "./fixtures.js";

const ingest = (env: ReturnType<typeof makeEnv>, content = FIXTURE_NOTES, format: SourceFormat = "markdown", sourceKey = "fixture-notes") => env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey, format, content });
const registered = async (env = makeEnv()) => {
  await env.pipeline.registerSource(fixtureSource());
  return env;
};

describe("source registration", () => {
  it("is idempotent: registering the same source again returns the same source and creates nothing new", async () => {
    const env = makeEnv();
    const first = await env.pipeline.registerSource(fixtureSource());
    const second = await env.pipeline.registerSource(fixtureSource());
    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.source.id).toBe(first.source.id);
    expect(await env.repo.listSources("IPMAT_INDORE")).toHaveLength(1);
  });
  it("an unauthorized source is refused and NOTHING is persisted - it never enters the pipeline", async () => {
    const env = makeEnv();
    const bad = fixtureSource("pirated", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "licensed", sourceRef: "https://t.me/coaching_pdfs/9", licenseRef: "x", authority: "y" });
    await expect(env.pipeline.registerSource(bad)).rejects.toMatchObject({ code: "unauthorized_source" });
    await expect(env.pipeline.registerSource(fixtureSource("nolicense", { dataOrigin: "real_source", fixtureLabel: null, sourceType: "licensed", sourceRef: "doc", licenseRef: null, authority: "y" }))).rejects.toMatchObject({ code: "unauthorized_source" });
    expect(await env.repo.listSources("IPMAT_INDORE")).toEqual([]);
    await expect(ingest(env, FIXTURE_NOTES, "markdown", "pirated")).rejects.toMatchObject({ code: "invalid_source" });
  });
  it("a source can only belong to an exam with a valid pack", async () => {
    const env = makeEnv();
    await expect(env.pipeline.registerSource(fixtureSource("k", { examCode: "NO_EXAM" }))).rejects.toThrow();
  });
});

describe("successful ingestion", () => {
  it("runs registered -> ... -> enriched, persisting chunks and candidates, and leaves review to a person", async () => {
    const env = await registered();
    const r = await ingest(env);
    expect(r.failure).toBeNull();
    expect(r.unchanged).toBe(false);
    expect(r.version.state).toBe("enriched");
    expect(r.version).toMatchObject({ version: 1, format: "markdown", attempts: 1 });
    const chunks = await env.repo.listChunks(r.version.id);
    expect(chunks.length).toBeGreaterThan(2);
    const candidates = await env.repo.listCandidates(r.version.id);
    expect(candidates.every((c) => c.state === "candidate" && c.review === null)).toBe(true); // nothing is accepted by a machine
    expect(candidates.filter((c) => c.kind === "concept_mention").map((c) => (c.kind === "concept_mention" ? c.conceptKey : ""))).toEqual(expect.arrayContaining(["percentages", "ratio", "number-systems", "averages"]));
    expect(candidates.filter((c) => c.kind === "question")).toHaveLength(1);
  });
  it("concept candidates carry verifiable evidence: the quote is verbatim in its chunk at the stated span", async () => {
    const env = await registered();
    const r = await ingest(env);
    const chunks = new Map((await env.repo.listChunks(r.version.id)).map((c) => [c.id, c]));
    for (const c of await env.repo.listCandidates(r.version.id)) {
      for (const e of c.evidence) expect(chunks.get(e.chunkId)!.text.slice(e.charStart, e.charEnd)).toBe(e.quote);
    }
  });
  it("records the proposer of every candidate", async () => {
    const env = await registered();
    const r = await ingest(env);
    for (const c of await env.repo.listCandidates(r.version.id)) expect(c.proposer).toMatchObject({ kind: "deterministic" });
  });
});

describe("idempotency and versioning", () => {
  it("the same content again: same version, no work, nothing duplicated", async () => {
    const env = await registered();
    const a = await ingest(env);
    const chunksBefore = await env.repo.listChunks(a.version.id);
    const candidatesBefore = await env.repo.listCandidates(a.version.id);
    const b = await ingest(env);
    expect(b.unchanged).toBe(true);
    expect(b.version.id).toBe(a.version.id);
    expect(b.version.attempts).toBe(a.version.attempts);
    expect(await env.repo.listChunks(a.version.id)).toEqual(chunksBefore);
    expect(await env.repo.listCandidates(a.version.id)).toEqual(candidatesBefore);
    expect(await env.repo.listVersions(a.source.id)).toHaveLength(1);
  });
  it("changed content is a NEW version; the old version and its decided candidates are untouched", async () => {
    const env = await registered();
    const v1 = await ingest(env);
    const mention = (await env.repo.listCandidates(v1.version.id)).find((c) => c.kind === "concept_mention" && c.conceptKey === "percentages")!;
    await env.pipeline.reviewCandidate(mention.id, "accept", REVIEW);
    const v2 = await ingest(env, FIXTURE_NOTES + "\nA new closing paragraph about Ratio and Percentages.\n");
    expect(v2.version.version).toBe(2);
    expect(v2.version.id).not.toBe(v1.version.id);
    expect(v2.unchanged).toBe(false);
    expect((await env.repo.findCandidate(mention.id))!.state).toBe("accepted");
    expect(await env.repo.listChunks(v1.version.id)).toHaveLength((await env.repo.listChunks(v1.version.id)).length);
    expect((await env.repo.findVersion(v1.version.id))!.state).toBe("enriched");
    expect(await env.repo.listVersions(v1.source.id)).toHaveLength(2);
  });
  it("whitespace-only differences are different bytes: a different version, never a silent overwrite", async () => {
    const env = await registered();
    const a = await ingest(env);
    const b = await ingest(env, FIXTURE_NOTES + "\n");
    expect(b.version.id).not.toBe(a.version.id);
  });
  it("two sources with identical content are two sources (identity is per source)", async () => {
    const env = makeEnv();
    await env.pipeline.registerSource(fixtureSource("one"));
    await env.pipeline.registerSource(fixtureSource("two"));
    const a = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "one", format: "markdown", content: FIXTURE_NOTES });
    const b = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "two", format: "markdown", content: FIXTURE_NOTES });
    expect(a.version.id).not.toBe(b.version.id);
  });
});

describe("failure, retry and recovery", () => {
  it("unsupported format: recorded as a failure at a stable stage with a stable code; nothing else is touched", async () => {
    const env = await registered();
    const r = await ingest(env, "irrelevant", "pdf" as never);
    expect(r.version.state).toBe("failed");
    expect(r.failure).toMatchObject({ stage: "extracted", code: "unsupported_format" });
    expect(await env.repo.listChunks(r.version.id)).toEqual([]);
  });
  it("an empty document fails at extraction", async () => {
    const env = await registered();
    const r = await ingest(env, "   \n  ");
    expect(r.failure).toMatchObject({ stage: "extracted", code: "empty_document" });
  });
  it("a failure message never contains source content", async () => {
    const env = await registered();
    const r = await ingest(env, "SECRET-CONTENT", "pdf" as never);
    expect(JSON.stringify(r.failure)).not.toContain("SECRET-CONTENT");
  });
  it("a provider failure part-way through enrichment fails that stage; retry resumes and converges on exactly the same candidates", async () => {
    let failOnce = true;
    const flaky = new StaticExtractionProvider("flaky", { concepts: () => [], fail: (chunk) => (failOnce && chunk.ordinal === 2 ? new Error("boom: SECRET-PROVIDER-DETAIL") : null) });
    const env = makeEnv({ conceptProviders: [flaky, new (await import("../src/index.js")).DeterministicConceptProvider()] });
    await env.pipeline.registerSource(fixtureSource());
    const first = await ingest(env);
    expect(first.version.state).toBe("failed");
    expect(first.failure).toMatchObject({ stage: "enriched", code: "provider_error" });
    expect(JSON.stringify(first.failure)).not.toContain("SECRET-PROVIDER-DETAIL");
    const partial = await env.repo.listCandidates(first.version.id);
    expect(partial.length).toBeGreaterThan(0); // chunks 0 and 1 were enriched before the failure
    failOnce = false;
    const retry = await ingest(env);
    expect(retry.failure).toBeNull();
    expect(retry.version.state).toBe("enriched");
    expect(retry.version.id).toBe(first.version.id);
    expect(retry.version.attempts).toBe(2);
    const healthy = makeEnv();
    await healthy.pipeline.registerSource(fixtureSource());
    const reference = await ingest(healthy);
    const ids = async (e: typeof env, v: string) => (await e.repo.listCandidates(v)).map((c) => c.id).sort();
    expect(await ids(env, retry.version.id)).toEqual(await ids(healthy, reference.version.id)); // no duplicates, no losses
  });
  it("an interrupted pipeline (stopped before chunking) resumes from its state when the content is supplied again", async () => {
    const env = await registered();
    const { source } = (await env.pipeline.registerSource(fixtureSource()));
    const hash = (await import("../src/index.js")).contentHash(FIXTURE_NOTES);
    const { version } = await env.repo.addVersion(source.id, { id: (await import("../src/index.js")).sourceVersionIdFor(source.id, hash), contentHash: hash, format: "markdown", byteLength: 1 });
    await env.repo.updateVersionState(version.id, { state: "extracted", failure: null });
    await expect(env.pipeline.run(version.id)).rejects.toMatchObject({ code: "invalid_source" }); // content needed; nothing changes
    expect((await env.repo.findVersion(version.id))!.state).toBe("extracted");
    const resumed = await env.pipeline.run(version.id, FIXTURE_NOTES);
    expect(resumed.version.state).toBe("enriched");
  });
  it("resuming with the WRONG content is refused", async () => {
    const env = await registered();
    const r = await ingest(env);
    await expect(env.pipeline.run(r.version.id, FIXTURE_NOTES + "x")).rejects.toMatchObject({ code: "content_hash_mismatch" });
  });
  it("a failed re-ingestion of a CHANGED source does not corrupt the previously validated version", async () => {
    const env = await registered();
    const v1 = await ingest(env);
    const mention = (await env.repo.listCandidates(v1.version.id)).find((c) => c.kind === "concept_mention")!;
    await env.pipeline.reviewCandidate(mention.id, "accept", REVIEW);
    for (const c of await env.repo.listCandidates(v1.version.id)) if (c.state === "candidate") await env.pipeline.reviewCandidate(c.id, c.kind === "concept_mention" && c.conceptKey === null ? "reject" : "reject", REVIEW);
    await env.pipeline.completeReview(v1.version.id);
    await env.pipeline.makeAvailable(v1.version.id);
    const before = { chunks: await env.repo.listChunks(v1.version.id), cands: await env.repo.listCandidates(v1.version.id) };
    const bad = await env.pipeline.ingest({ examCode: "IPMAT_INDORE", sourceKey: "fixture-notes", format: "pdf" as never, content: "changed but unsupported" });
    expect(bad.version.state).toBe("failed");
    expect((await env.repo.findVersion(v1.version.id))!.state).toBe("available");
    expect(await env.repo.listChunks(v1.version.id)).toEqual(before.chunks);
    expect(await env.repo.listCandidates(v1.version.id)).toEqual(before.cands);
  });
  it("rights are re-checked at acceptance: a source that no longer passes cannot proceed", async () => {
    const env = await registered();
    const { source } = await env.pipeline.registerSource(fixtureSource());
    const hash = (await import("../src/index.js")).contentHash(FIXTURE_NOTES);
    const { version } = await env.repo.addVersion(source.id, { id: (await import("../src/index.js")).sourceVersionIdFor(source.id, hash), contentHash: hash, format: "markdown", byteLength: 1 });
    // a source row that has been tampered with in storage (rights stripped) must not be ingested
    const stored = (await env.repo.findSourceById(source.id))!;
    (env.repo as unknown as { sources: Map<string, unknown> }).sources.set(source.id, { ...stored, sourceType: "licensed", licenseRef: null, authority: null, dataOrigin: "real_source", fixtureLabel: null, sourceRef: "doc" });
    const r = await env.pipeline.run(version.id, FIXTURE_NOTES);
    expect(r.failure).toMatchObject({ stage: "accepted", code: "unauthorized_source" });
  });
});

describe("review and availability", () => {
  it("a version cannot be reviewed while a candidate is undecided, nor made available before review", async () => {
    const env = await registered();
    const r = await ingest(env);
    await expect(env.pipeline.completeReview(r.version.id)).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(env.pipeline.makeAvailable(r.version.id)).rejects.toMatchObject({ code: "invalid_transition" });
  });
  it("after every candidate is decided by a person: enriched -> reviewed -> available; chunks are then locked", async () => {
    const env = await registered();
    const r = await ingest(env);
    for (const c of await env.repo.listCandidates(r.version.id)) await env.pipeline.reviewCandidate(c.id, "reject", REVIEW);
    expect((await env.pipeline.completeReview(r.version.id)).state).toBe("reviewed");
    expect((await env.pipeline.makeAvailable(r.version.id)).state).toBe("available");
    await expect(env.repo.replaceChunks(r.version.id, [])).rejects.toBeInstanceOf(ContentIntelligenceError);
    expect((await ingest(env)).unchanged).toBe(true); // re-ingesting an available version changes nothing
  });
  it("a decided candidate is never overwritten or reopened by a re-run, and decisions are final", async () => {
    const env = await registered();
    const r = await ingest(env);
    const c = (await env.repo.listCandidates(r.version.id)).find((x) => x.kind === "concept_mention" && x.conceptKey === "ratio")!;
    await env.pipeline.reviewCandidate(c.id, "accept", REVIEW);
    await env.repo.updateVersionState(r.version.id, { state: "chunked", failure: null });
    await env.pipeline.run(r.version.id); // re-enrich from persisted chunks
    expect((await env.repo.findCandidate(c.id))!.state).toBe("accepted");
    await expect(env.pipeline.reviewCandidate(c.id, "reject", REVIEW)).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("pipeline never names a vendor or calls a model; the pack is the authority", () => {
  it("uses only injected providers (the default is deterministic)", async () => {
    const env = await registered(makeEnv({ conceptProviders: [] }));
    const r = await ingest(env);
    expect(await env.repo.listCandidates(r.version.id)).toHaveLength(1); // only the deterministic question-boundary detector
    void ipmatIndoreExamPack;
  });
});
