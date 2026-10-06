import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tutorResponseAiSchema } from "@ipmat/ai";
import { TUTOR_INTENTS, TUTOR_INTENT_POLICIES, UNRESOLVED_TUTOR_POLICIES } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (dir: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(join(root, dir, f), "utf-8")] as const);
const src = read("src");
const importsOf = (code: string) => [...code.matchAll(/(?:from\s+|require\()["']([^"']+)["']/g)].map((m) => m[1]!);

describe("@ipmat/tutor dependency boundary", () => {
  it("imports only the allowed packages: no vendor SDK, no Prisma/db, no web framework, no other domain system", () => {
    const allowed = /^(\.\/|node:crypto$|@ipmat\/ai$|@ipmat\/concept-graph$|@ipmat\/content-intelligence$)/;
    for (const [file, code] of src) for (const spec of importsOf(code)) expect(allowed.test(spec), `${file} imports "${spec}"`).toBe(true);
  });
  it("makes no network call, reads no environment, and holds no secret", () => {
    for (const [file, code] of src) {
      for (const bad of [/\bfetch\s*\(/, /node:https?/, /node:net/, /XMLHttpRequest/, /process\.env/, /sk-ant-/, /api[_-]?key\s*[:=]/i]) expect(bad.test(code), `${file} matches ${bad}`).toBe(false);
    }
  });
  it("no source file names a vendor", () => {
    for (const [file, code] of src) expect(/anthropic|openai|gemini|google/i.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), file).toBe(false);
  });
  it("the tutor has no persistence: no prisma, no migration, no table, no store", () => {
    for (const [file, code] of src) expect(/prisma|\.sql|CREATE TABLE|localStorage|writeFile/i.test(code), file).toBe(false);
  });
  it("tests never reach a live model: no test file imports a provider SDK", () => {
    for (const [file, code] of read("test")) for (const spec of importsOf(code)) expect(/anthropic-ai|openai|googleapis|AnthropicProvider/.test(spec), `${file}: ${spec}`).toBe(false);
  });
});

describe("response contract", () => {
  it("the model schema has no field for reasoning, chain-of-thought, confidence, mastery, readiness or a student diagnosis", () => {
    const keys = Object.keys(tutorResponseAiSchema.shape);
    expect(keys.sort()).toEqual(["citations", "hypotheses", "missingContext", "parts", "questionQuotes", "relationClaims", "responseType", "socraticStep", "text"]);
    for (const k of keys) expect(/reason|thought|think|confidence|mastery|ready|score|diagnos|ability/i.test(k), k).toBe(false);
  });
  it("a model-supplied extra field is stripped, not carried", () => {
    const parsed = tutorResponseAiSchema.parse({ responseType: "hint", text: "x", chainOfThought: "y", confidence: 0.9 });
    expect(Object.keys(parsed)).not.toContain("chainOfThought");
    expect(Object.keys(parsed)).not.toContain("confidence");
  });
});

describe("policy contracts are explicit, conservative and honest about what is undecided", () => {
  it("every intent has a policy, and a hint can never obtain the key", () => {
    for (const i of TUTOR_INTENTS) expect(TUTOR_INTENT_POLICIES[i].intent).toBe(i);
    expect(TUTOR_INTENT_POLICIES.give_hint.answerKey).toBe("never");
    expect(TUTOR_INTENT_POLICIES.explain_concept.answerKey).toBe("never");
  });
  it("no intent may carry revision/curriculum/simulation/autopsy evidence in Unit 1 (no spec says which may)", () => {
    for (const i of TUTOR_INTENTS) expect(TUTOR_INTENT_POLICIES[i].allowedEvidenceKinds).toEqual([]);
  });
  it("only the guided question and the mistake explanation may carry hypotheses", () => {
    expect(TUTOR_INTENTS.filter((i) => TUTOR_INTENT_POLICIES[i].allowHypotheses)).toEqual(["guide_with_question", "explain_mistake"]);
  });
  it("the undecided tutor policies are enumerated, not silently decided", () => {
    expect(UNRESOLVED_TUTOR_POLICIES.length).toBeGreaterThanOrEqual(8);
    expect(UNRESOLVED_TUTOR_POLICIES.join("\n")).toMatch(/hint levels/);
    expect(UNRESOLVED_TUTOR_POLICIES.join("\n")).toMatch(/conversation memory/);
  });
});
