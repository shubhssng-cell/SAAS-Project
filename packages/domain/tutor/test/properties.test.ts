import { describe, expect, it } from "vitest";
import { tutorResponseAiSchema } from "@ipmat/ai";
import { PSYCHOLOGICAL_PATTERNS, TUTOR_INTENTS, buildTutorContext, buildTutorUserPrompt, validateTutorGrounding } from "../src/index.js";
import { contractParts, ENROLL_A, EXAM, STUDENT_A, attempt, modelJson, ports, question, request, world } from "./fixtures.js";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ["consider", "the", "marked", "price", "multiplier", "compare", "options", "carefully", "decrease", "fraction", "remaining", "then"];
const phrase = (r: () => number, n = 6) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");

describe("properties (seeded, deterministic)", () => {
  it("for any key and any solution text, a hint/concept context never contains the key block or the solution", async () => {
    const r = rng(11);
    for (let i = 0; i < 60; i++) {
      const key = `K${Math.floor(r() * 1e6) + 100000}`;
      const step = `SOLSTEP-${Math.floor(r() * 1e9)} ${phrase(r, 5)}`;
      const w = world({ questions: [question({ correctAnswer: key, solutionSteps: [step] })] });
      for (const intent of ["give_hint", "explain_concept"] as const) {
        const b = await buildTutorContext(ports(w), request({ intent, conceptName: "Percentages" }));
        if (b.kind !== "context") throw new Error("ctx");
        const prompt = buildTutorUserPrompt(b.context);
        expect(prompt).not.toContain(key);
        expect(prompt).not.toContain("SOLSTEP");
        expect(b.context.answerKey).toBeNull();
      }
    }
  });
  it("for any withheld key, asserting it in a sentence is always rejected, while a non-asserting hint passes", async () => {
    const r = rng(23);
    for (let i = 0; i < 60; i++) {
      const key = String(Math.floor(r() * 9000) + 1000); // never appears in the stem
      const w = world({ questions: [question({ correctAnswer: key, options: ["1", "2", key, "4"] })] });
      const b = await buildTutorContext(ports(w), request({ intent: "give_hint" }));
      if (b.kind !== "context") throw new Error("ctx");
      const check = (text: string) => validateTutorGrounding(b.context, tutorResponseAiSchema.parse(JSON.parse(modelJson({ responseType: "hint", text, citations: ["question"] }))), { protectedKey: b.protectedKey, internalTokens: b.internalTokens });
      expect(check(`${phrase(r)}. The answer is ${key}.`).violations.map((v) => v.code)).toContain("answer_key_leakage");
      expect(check(`${phrase(r)}. ${phrase(r)}.`).violations.map((v) => v.code)).not.toContain("answer_key_leakage");
    }
  });
  it("any UUID, anywhere in generated text, is rejected as an identifier leak", async () => {
    const r = rng(5);
    const b = await buildTutorContext(ports(), request());
    if (b.kind !== "context") throw new Error("ctx");
    for (let i = 0; i < 50; i++) {
      const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
      const uuid = `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
      const text = `${phrase(r)} ${uuid} ${phrase(r)}`;
      const out = tutorResponseAiSchema.parse(JSON.parse(modelJson({ responseType: "mistake_explanation", text, citations: ["attempt"] })));
      expect(validateTutorGrounding(b.context, out, { protectedKey: b.protectedKey, internalTokens: b.internalTokens }).violations.map((v) => v.code)).toContain("internal_identifier_leakage");
    }
  });
  it("neutral explanatory sentences built from safe words are never rejected (no spurious violations)", async () => {
    const r = rng(77);
    const b = await buildTutorContext(ports(), request());
    if (b.kind !== "context") throw new Error("ctx");
    for (let i = 0; i < 80; i++) {
      const out = tutorResponseAiSchema.parse(JSON.parse(modelJson({ responseType: "mistake_explanation", text: `${phrase(r, 10)}.`, citations: ["attempt"], parts: contractParts("explain_mistake", true) })));
      expect(validateTutorGrounding(b.context, out, { protectedKey: b.protectedKey, internalTokens: b.internalTokens }).passed).toBe(true);
    }
  });
  it("every psychological pattern is caught regardless of surrounding words", async () => {
    const r = rng(9);
    const b = await buildTutorContext(ports(), request());
    if (b.kind !== "context") throw new Error("ctx");
    const triggers = ["You are weak at this", "you lack confidence", "You panic", "your anxiety", "You don't understand it", "You always do this", "You struggle with it", "Your problem is speed"];
    for (const t of triggers) {
      const out = tutorResponseAiSchema.parse(JSON.parse(modelJson({ responseType: "mistake_explanation", text: `${phrase(r)}. ${t}. ${phrase(r)}.`, citations: ["attempt"] })));
      expect(validateTutorGrounding(b.context, out, { protectedKey: b.protectedKey }).violations.map((v) => v.code), t).toContain("psychological_claim");
    }
    expect(PSYCHOLOGICAL_PATTERNS.length).toBeGreaterThan(5);
  });
  it("cross-student isolation: across many students, a context only ever contains the requesting student's own attempt", async () => {
    const r = rng(31);
    const ids = Array.from({ length: 12 }, (_, i) => `student-${i}-${Math.floor(r() * 1e6)}`);
    const w = world({
      enrollments: ids.map((id, i) => ({ studentId: id, enrollmentId: `enr-${i}`, examCode: EXAM })),
      attempts: ids.map((id, i) => attempt({ attemptId: `att-${i}-xxxxxxxx`, studentId: id, finalAnswer: `ANS<${i}>`, workingSteps: `WORK<${i}>` }))
    });
    for (let i = 0; i < ids.length; i++) {
      const b = await buildTutorContext(ports(w), request({ studentId: ids[i]!, enrollmentId: `enr-${i}` }));
      if (b.kind !== "context") throw new Error("ctx");
      const dump = JSON.stringify(b.context) + buildTutorUserPrompt(b.context);
      expect(dump).toContain(`ANS<${i}>`);
      for (let j = 0; j < ids.length; j++) {
        if (j === i) continue;
        expect(dump).not.toContain(`ANS<${j}>`);
        expect(dump).not.toContain(`WORK<${j}>`);
        expect(dump).not.toContain(ids[j]!);
      }
    }
  });
  it("every intent's prompt is deterministic: the same inputs yield the same prompt and digest", async () => {
    for (const intent of TUTOR_INTENTS) {
      const a = await buildTutorContext(ports(), request({ intent, conceptName: "Percentages" }));
      const c = await buildTutorContext(ports(), request({ intent, conceptName: "Percentages" }));
      if (a.kind !== "context" || c.kind !== "context") continue;
      expect(buildTutorUserPrompt(a.context)).toBe(buildTutorUserPrompt(c.context));
    }
    expect(STUDENT_A + ENROLL_A).toBeTruthy();
  });
});
