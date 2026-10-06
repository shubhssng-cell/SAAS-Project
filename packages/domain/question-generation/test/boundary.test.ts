import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (dir: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(root, dir, f), "utf-8")] as const);
const src = read("src");
const importsOf = (code: string) => [...code.matchAll(/(?:from\s+|require\()["']([^"']+)["']/g)].map((m) => m[1]!);
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("@ipmat/question-generation boundary", () => {
  it("imports only the existing domain packages it composes: no vendor SDK, no Prisma/db, no content-intelligence (no source text), no web framework", () => {
    const allowed = /^(\.\/|node:crypto$|@ipmat\/(ai|concept-graph|content-authoring|exam-pack|examiner-intelligence|question-engine|validation)$)/;
    for (const [file, code] of src) for (const spec of importsOf(code)) expect(allowed.test(spec), `${file} imports "${spec}"`).toBe(true);
  });
  it("makes no network call, reads no environment, holds no secret, and names no vendor", () => {
    for (const [file, code] of src) {
      const text = strip(code);
      for (const bad of [/\bfetch\s*\(/, /node:https?/, /node:net/, /process\.env/, /sk-[A-Za-z]/, /api[_-]?key\s*[:=]/i, /anthropic|openai|gemini|google/i]) expect(bad.test(text), `${file} matches ${bad}`).toBe(false);
    }
  });
  it("has no second provider abstraction, duplicate system, publish path or persistence of its own", () => {
    for (const [file, code] of src) {
      const text = strip(code);
      expect(/implements\s+AiProvider|class\s+\w*Provider\b/.test(text), `${file}: second provider abstraction`).toBe(false);
      expect(/levenshtein|jaccard|cosine|embedding|similarity\s*\(/i.test(text), `${file}: second similarity system`).toBe(false);
      expect(/\.publish\s*\(|publishQuestion|decidePublication|validationState\s*[:=]\s*["']published/.test(text), `${file}: publication`).toBe(false);
      expect(/prisma|\.sql|CREATE TABLE|localStorage|writeFile/i.test(text), `${file}: persistence`).toBe(false);
    }
  });
  it("tests never reach a live model", () => {
    for (const [file, code] of read("test")) for (const spec of importsOf(code)) expect(/anthropic-ai|openai|googleapis|AnthropicProvider/.test(spec), `${file}: ${spec}`).toBe(false);
  });
});
