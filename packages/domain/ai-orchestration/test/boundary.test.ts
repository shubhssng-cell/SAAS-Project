import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (dir: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(root, dir, f), "utf-8")] as const);
const src = read("src");
const importsOf = (code: string) => [...code.matchAll(/(?:from\s+|require\()["']([^"']+)["']/g)].map((m) => m[1]!);
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("@ipmat/ai-orchestration boundary: a router over existing capabilities, not an agent", () => {
  it("imports only the three packages it composes (and node:crypto): no model SDK, no @ipmat/ai, no database, no training-recommendation, no engine", () => {
    const allowed = /^(\.\/|node:crypto$|@ipmat\/(tutor|personalization|question-generation)$)/;
    for (const [file, code] of src) for (const spec of importsOf(code)) expect(allowed.test(spec), `${file} imports "${spec}"`).toBe(true);
  });
  it("the orchestrator itself calls no model, names no vendor, reads no environment, holds no key and makes no network call", () => {
    for (const [file, code] of src) {
      const text = strip(code);
      for (const bad of [/generateStructured|AiProvider|\.complete\s*\(/, /anthropic|openai|gemini|google/i, /process\.env/, /\bfetch\s*\(/, /node:https?|node:net/, /sk-[A-Za-z]/, /api[_-]?key\s*[:=]/i]) expect(bad.test(text), `${file} matches ${bad}`).toBe(false);
    }
  });
  it("there is no agent loop, recursion, dynamic code or tool selection: no while/for(;;), no self-invocation, no eval/Function/dynamic import", () => {
    for (const [file, code] of src) {
      const text = strip(code);
      expect(/\bwhile\s*\(|for\s*\(\s*;|do\s*\{/.test(text), `${file}: loop`).toBe(false);
      expect(/\beval\s*\(|new\s+Function\s*\(|import\s*\(|require\s*\(/.test(text), `${file}: dynamic code`).toBe(false);
      expect(/await\s+run\s*\(|this\.run\s*\(|\brun\(request\b/.test(text.replace(/async function run\(request[^)]*\)/, "")), `${file}: self-invocation`).toBe(false);
    }
  });
  it("no source reads model text to choose a capability, and no source holds memory, persistence or a publish call", () => {
    for (const [file, code] of src) {
      const text = strip(code);
      expect(/localStorage|prisma|\.sql|CREATE TABLE|writeFile|new Map<string, unknown\[\]>|conversation|memory/i.test(text.replace(/hidden|no memory/gi, "")), `${file}: persistence/memory`).toBe(false);
      expect(/\.publish\s*\(|publishQuestion|decidePublication|validationState\s*[:=]\s*["']published/.test(text), `${file}: publication`).toBe(false);
      expect(/\.(output|response|text)\b[^;]*\bcapability\b/.test(text), `${file}: capability chosen from output`).toBe(false);
    }
  });
  it("capability selection reads only the fixed route table and the workflow definition", () => {
    const orch = strip(readFileSync(join(root, "src", "orchestrator.ts"), "utf-8"));
    expect(orch).toMatch(/byTask\.get\(task\)/);
    expect(/deps\.handlers\[(?!step\.capability|capability|fb\.capability)/.test(orch)).toBe(false);
  });
  it("the public view is field-by-field: it never spreads a result or an output", () => {
    const view = strip(readFileSync(join(root, "src", "view.ts"), "utf-8"));
    expect(/\.\.\.\s*(result|output|step)\b/.test(view)).toBe(false);
  });
  it("tests never reach a live model", () => {
    for (const [file, code] of read("test")) for (const spec of importsOf(code)) expect(/anthropic-ai|openai|googleapis|AnthropicProvider/.test(spec), `${file}: ${spec}`).toBe(false);
  });
});
