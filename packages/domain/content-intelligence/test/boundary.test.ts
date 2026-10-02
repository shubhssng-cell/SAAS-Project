import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const read = (f: string): string => readFileSync(join(SRC, f), "utf-8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = files.map((f) => strip(read(f))).join("\n");

describe("content-intelligence boundaries (D-085)", () => {
  it("imports only the existing domain vocabulary + node:crypto: no Prisma, db, AI SDK/provider, mastery, attempt, web, or network client", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/concept-graph", "@ipmat/content-authoring", "@ipmat/exam-pack", "@ipmat/question-engine", "node:crypto"]);
  });
  it("names no vendor and makes no network call: providers are interfaces", () => {
    const lower = code.toLowerCase();
    for (const forbidden of ["anthropic", "openai", "gemini", "claude", "cohere", "pinecone", "weaviate", "pgvector", "chroma", "fetch(", "http://", "https://"]) expect(lower, forbidden).not.toContain(forbidden);
  });
  it("can never publish: no code path produces the published state, and the pipeline imports no publication function", () => {
    expect(code).not.toMatch(/["']published["']/);
    expect(code).not.toMatch(/publishQuestion|decidePublication/);
  });
  it("introduces no new relation type and no related-to field", () => {
    expect(code).not.toMatch(/relatedTo|related_to|"related"/);
    expect(read("candidates.ts")).toContain('"prerequisite", "foundational", "directly_related", "commonly_combined", "application", "dependent", "advanced_extension", "related_but_distinct"');
  });
  it("reads no clock: time is supplied by the caller", () => {
    expect(code).not.toMatch(/Date\.now\(|new Date\(\)/);
  });
  it("holds no student state and no prediction vocabulary", () => {
    const lower = code.toLowerCase();
    for (const forbidden of ["mastery", "confidence", "studentid", "attemptid", "predict", "likelihood"]) expect(lower, forbidden).not.toContain(forbidden);
  });
  it("retrieval is the ONLY module that resolves a hit to text, and it checks the principal first", () => {
    const retrieval = strip(read("retrieval.ts"));
    expect(retrieval.indexOf("READERS.includes(principal.role)")).toBeLessThan(retrieval.indexOf("this.index.search"));
    expect(retrieval).toContain("ContentAccessDeniedError");
  });
});
