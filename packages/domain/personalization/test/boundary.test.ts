import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(root, "src", f), "utf-8")] as const);
const importsOf = (code: string) => [...code.matchAll(/(?:from\s+|require\()["']([^"']+)["']/g)].map((m) => m[1]!);
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("@ipmat/personalization boundary", () => {
  it("imports only what it composes: the tutor's contracts and the two result types it passes through", () => {
    const allowed = /^(\.\/|@ipmat\/(tutor|adaptive-curriculum|revision-intelligence)$)/;
    for (const [file, code] of src) for (const spec of importsOf(code)) expect(allowed.test(spec), `${file} imports "${spec}"`).toBe(true);
  });
  it("has no second model provider, no engine, no evidence reader, no simulation access, no persistence, no network", () => {
    for (const [file, code] of src) {
      const text = strip(code);
      for (const bad of [/@ipmat\/ai\b/, /@ipmat\/(mastery|attempt|autopsy|exam-simulation|training-orchestration|adaptive-selection|db)\b/, /prisma|\.sql|CREATE TABLE|localStorage|writeFile/i, /\bfetch\s*\(/, /process\.env/, /anthropic|openai|gemini/i]) expect(bad.test(text), `${file} matches ${bad}`).toBe(false);
    }
  });
  it("reads no attempt, mastery or evidence field: personalization is driven only by explicit preferences", () => {
    for (const [file, code] of src) expect(/attemptRecords|masteryByConcept|finalAnswer|isCorrect|timeTaken|hintsUsed|MasteryEvidenceView|computeMasteryState/.test(strip(code)), file).toBe(false);
  });
  it("no source file defines a selection, ranking, scoring or sorting step of its own", () => {
    for (const [file, code] of src) expect(/\.sort\(|\.reduce\(|Math\.(max|min|random)|priorityScore|rankOf|scoreOf/.test(strip(code)), file).toBe(false);
  });
  it("tests never reach a live model", () => {
    for (const f of readdirSync(join(root, "test")).filter((x) => x.endsWith(".ts"))) {
      for (const spec of importsOf(readFileSync(join(root, "test", f), "utf-8"))) expect(/anthropic-ai|openai|googleapis|AnthropicProvider/.test(spec), `${f}: ${spec}`).toBe(false);
    }
  });
});
