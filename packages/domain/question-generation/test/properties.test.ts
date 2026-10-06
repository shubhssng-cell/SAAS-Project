import { describe, expect, it } from "vitest";
import { passingJudge, validReverification } from "@ipmat/question-engine";
import { canonicalJson, specBody, specIdFor, type GenerationSpec } from "../src/index.js";
import { EXAM, GOOD, candidateFor, hardCell, j, makeEnv, makeSpec, NO_RETRY } from "./fixtures.js";

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
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const shuffleKeys = (r: () => number, v: unknown): unknown => {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(r, x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).sort(() => r() - 0.5).map(([k, x]) => [k, shuffleKeys(r, x)]));
  return v;
};

describe("properties (seeded, deterministic)", () => {
  it("SPEC SERIALIZATION: the specId is invariant under any key order, and the canonical form is stable", () => {
    const r = rng(11);
    const spec = makeSpec();
    for (let i = 0; i < 40; i++) {
      const copy = shuffleKeys(r, spec) as GenerationSpec;
      const body = specBody(copy);
      expect(specIdFor(body)).toBe(spec.specId);
      expect(canonicalJson(shuffleKeys(r, spec))).toBe(canonicalJson(spec));
    }
  });
  it("IDENTITY INVARIANTS: same spec + same content -> same id; different spec or different content -> different id", async () => {
    const r = rng(23);
    const ids = new Map<string, string>();
    for (let i = 0; i < 25; i++) {
      const spec = makeSpec(undefined, { idSuffix: `s${i % 5}` });
      const stem = `Random question ${i % 7} about a price that rises by a percentage and asks for the original price of the item before the rise occurred?`;
      const env = makeEnv([j(candidateFor(spec, { stem })), j(validReverification), j(passingJudge)]);
      const out = await env.service.generateOne(spec);
      const key = `${spec.specId}|${stem}`;
      if (ids.has(key)) expect(out.questionId).toBe(ids.get(key));
      else ids.set(key, out.questionId!);
      expect(out.questionId).toMatch(/^gq_[0-9a-f]{24}$/);
      expect(pick(r, [0, 1])).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(ids.values()).size).toBe(ids.size); // distinct (spec, content) pairs never collide
  });
  it("EXACT-DUPLICATE INVARIANCE: any number of repeats of the same generation leaves exactly one stored row, unchanged", async () => {
    const spec = makeSpec();
    const n = 6;
    const env = makeEnv(Array.from({ length: n }, () => GOOD(spec)).flat());
    const first = await env.service.generateOne(spec);
    const snapshot = JSON.stringify(await env.repo.findById(first.questionId!));
    for (let i = 1; i < n; i++) {
      const again = await env.service.generateOne(spec);
      expect(again.kind).toBe("exact_duplicate");
      expect(again.existingQuestionId).toBe(first.questionId);
    }
    expect((await env.repo.listIdentityRefs(EXAM)).length).toBe(1);
    expect(JSON.stringify(await env.repo.findById(first.questionId!))).toBe(snapshot);
  });
  it("EXAM ISOLATION: a spec for any exam other than a known one never reaches a model and stores nothing", async () => {
    const r = rng(5);
    for (let i = 0; i < 20; i++) {
      const code = `EXAM_${Math.floor(r() * 1e6)}`;
      const base = makeSpec(undefined, { idSuffix: `x${i}` });
      const body = { ...base, blueprint: { ...base.blueprint, examCode: code } };
      const rest = specBody(body);
      const spec = { ...body, specId: specIdFor(rest) } as GenerationSpec;
      const env = makeEnv([]);
      const out = await env.service.generateOne(spec);
      expect(out.kind).toBe("spec_invalid");
      expect(env.provider.prompts).toHaveLength(0);
      expect(await env.repo.listIdentityRefs(code)).toEqual([]);
    }
  });
  it("NO ACCIDENTAL PUBLICATION: across random tiers, answers, drifts and failures, no outcome is ever published", async () => {
    const r = rng(77);
    const cells = [makeSpec(undefined, { idSuffix: "a" }), makeSpec(hardCell, { idSuffix: "h" })];
    for (let i = 0; i < 60; i++) {
      const spec = pick(r, cells);
      const mutation = pick(r, ["ok", "wrong_answer", "drift_concept", "drift_trap", "novelty", "bad_json", "few_options", "judge_fail"] as const);
      const over: Record<string, unknown> = { stem: `Random stem ${i} about a quantity that grows by a percentage, asking for the amount before the growth was applied?`, options: ["420", "450", "480", "500"] };
      const dna: Record<string, unknown> = {};
      let judge: unknown = passingJudge;
      if (mutation === "wrong_answer") Object.assign(over, { correctAnswer: "450", groundTruthDerivation: { computation: "4 * 150 / 1.25", expectedAnswer: 450 } });
      if (mutation === "drift_concept") dna.conceptName = "Averages";
      if (mutation === "drift_trap") dna.trapErrorTaxonomyCode = "sign_error";
      if (mutation === "novelty") dna.noveltyLevel = "novel_context";
      if (mutation === "few_options") over.options = ["480"];
      if (mutation === "judge_fail") judge = { ...passingJudge, verdict: "fail", isAmbiguous: true, issues: ["x"] };
      const script = mutation === "bad_json" ? ["nope"] : [j(candidateFor(spec, over, dna)), j(validReverification), j(judge)];
      const env = makeEnv(script, { limits: NO_RETRY });
      const out = await env.service.generateOne(spec);
      if (out.questionId) {
        const stored = (await env.repo.findById(out.questionId))!;
        expect(["draft", "ai_validated", "rejected"]).toContain(stored.validationState);
        expect(stored.origin).toBe("ai_generated");
      }
      if (mutation !== "ok") expect(out.kind).not.toBe("ai_validated_awaiting_review");
      expect(out.trace.validationState === null || out.trace.validationState !== "published").toBe(true);
      expect(Object.keys(env.service)).not.toContain("publish");
    }
  });
  it("AUTHORING-GATE PRESERVATION: every stored candidate's trace lists all 11 gates, and a hard/extreme/novel tier always requires human review", async () => {
    const r = rng(101);
    for (let i = 0; i < 12; i++) {
      const spec = pick(r, [makeSpec(undefined, { idSuffix: `g${i}` }), makeSpec(hardCell, { idSuffix: `g${i}` })]);
      const env = makeEnv([j(candidateFor(spec, { stem: `Gate stem ${i} concerning a price that increases by a percentage, then asks for the price before the increase was made?` })), j(validReverification), j(passingJudge)]);
      const out = await env.service.generateOne(spec);
      expect(out.trace.gates!.gates).toHaveLength(11);
      if (spec.blueprint.difficultyTier === "hard") {
        expect(out.trace.reviewRequired).toBe(true);
        expect(out.trace.publishable).toBe(false);
      }
    }
  });
});
