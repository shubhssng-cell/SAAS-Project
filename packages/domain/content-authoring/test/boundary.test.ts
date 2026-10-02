import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
const read = (f: string): string => readFileSync(join(SRC, f), "utf-8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("content-authoring boundaries (D-084)", () => {
  it("imports only the existing domain vocabulary: no Prisma, db, AI provider/vendor, mastery, attempt, web", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/concept-graph", "@ipmat/exam-pack", "@ipmat/examiner-intelligence", "@ipmat/examiner-lens", "@ipmat/question-engine", "@ipmat/validation", "node:crypto"]);
  });

  it("never calls a model and names no vendor: an AI proposal is INPUT, so the provider layer stays replaceable", () => {
    const all = files.map((f) => strip(read(f)).toLowerCase()).join("\n");
    for (const forbidden of ["anthropic", "openai", "claude", "gemini", "generatestructured", "aiprovider", "fetch("]) expect(all, forbidden).not.toContain(forbidden);
  });

  it("introduces no new difficulty score, vocabulary or prediction field", () => {
    const all = files.map((f) => strip(read(f))).join("\n");
    for (const forbidden of ["difficultyScore", "overallDifficulty", "compositeScore", "predict", "likelihood", "willAppear", "importanceScore"]) expect(all, forbidden).not.toContain(forbidden);
  });

  it("holds no student state (mastery, confidence, attempts)", () => {
    const all = files.map((f) => strip(read(f)).toLowerCase()).join("\n");
    for (const forbidden of ["mastery", "confidence", "attemptid", "studentid"]) expect(all, forbidden).not.toContain(forbidden);
  });

  it("reads no clock: time is supplied by the caller", () => {
    const all = files.map((f) => strip(read(f))).join("\n");
    expect(all).not.toMatch(/Date\.now\(|new Date\(\)/);
  });

  it("reuses the existing DNA and lifecycle vocabulary rather than defining parallel ones", () => {
    const types = strip(read("types.ts"));
    expect(types).toMatch(/Omit<QuestionDnaData,/);
    expect(types).toMatch(/validationState: ValidationState/);
    expect(strip(read("lifecycle.ts"))).toContain("decidePublication");
  });
});
