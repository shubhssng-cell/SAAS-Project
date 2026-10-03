import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMutation, assemblePaper, planAnswer, planSettle, planSubmit, startSimulation, type AnswerKey, type SimulationState } from "../src/index.js";
import { candidates, DURATION, fixtureConfig, fixtureSelection, T0 } from "./fixtures.js";

/** Seeded PRNG (no new dependency); the seed is in each test name so a failure is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const KEY: AnswerKey = { qa1: { correctAnswer: "11", contentFingerprint: "fp-qa1" }, qa2: { correctAnswer: "22", contentFingerprint: "fp-qa2" }, qb1: { correctAnswer: "33", contentFingerprint: "fp-qb1" } };
const FP = ["fp-qa1", "fp-qa2", "fp-qb1"];
const loadKey = async (): Promise<AnswerKey> => KEY;
const ms = (offset: number): string => new Date(Date.parse(T0) + offset).toISOString();
const rank = { in_progress: 0, submitted: 1, expired: 1 } as const;

type Op = { kind: "answer"; position: number; answer: string; at: number } | { kind: "submit"; at: number } | { kind: "settle"; at: number };

function ops(seed: number): Op[] {
  const r = rng(seed);
  let at = 0;
  return Array.from({ length: 5 + Math.floor(r() * 30) }, () => {
    at += Math.floor(r() * (DURATION * 1000 * 0.12));
    const k = r();
    if (k < 0.7) return { kind: "answer", position: 1 + Math.floor(r() * 3), answer: ["10", "11", "22", "33", "x"][Math.floor(r() * 5)]!, at };
    if (k < 0.85) return { kind: "settle", at };
    return { kind: "submit", at };
  });
}

async function run(seed: number): Promise<{ trail: SimulationState[]; rejected: number }> {
  const config = fixtureConfig();
  let state = startSimulation({ id: "s", studentId: "a", enrollmentId: "b", config, paper: assemblePaper(config, fixtureSelection(), candidates()), now: T0 });
  const trail = [state];
  let rejected = 0;
  for (const op of ops(seed)) {
    try {
      if (op.kind === "answer") {
        const r = await planAnswer(state, { position: op.position, answer: op.answer }, ms(op.at), { options: null, currentFingerprint: FP[op.position - 1]! }, loadKey);
        if (r.outcome !== "recorded") rejected += 1;
        state = applyMutation(state, r.mutation);
      } else if (op.kind === "submit") {
        state = applyMutation(state, (await planSubmit(state, ms(op.at), loadKey)).mutation);
      } else {
        state = applyMutation(state, (await planSettle(state, ms(op.at), loadKey)).mutation);
      }
    } catch {
      // invalid input is refused with no change
    }
    trail.push(state);
  }
  return { trail, rejected };
}

describe("property: random operation sequences against an advancing server clock", () => {
  it.each(SEEDS)("seed %i: status only moves forward, finalization happens once, and a finalized state never changes", async (seed) => {
    const { trail } = await run(seed);
    let finalizedAt: SimulationState | null = null;
    for (let i = 1; i < trail.length; i++) {
      expect(rank[trail[i]!.status]).toBeGreaterThanOrEqual(rank[trail[i - 1]!.status]);
      if (finalizedAt) expect(trail[i]).toEqual(finalizedAt);
      else if (trail[i]!.status !== "in_progress") finalizedAt = trail[i]!;
    }
  });

  it.each(SEEDS)("seed %i: every recorded answer is strictly before the deadline and precedes finalization", async (seed) => {
    const { trail } = await run(seed);
    const last = trail[trail.length - 1]!;
    for (const e of last.events) {
      expect(Date.parse(e.occurredAt)).toBeLessThan(Date.parse(last.deadlineAt));
      if (last.finalizedAt) expect(Date.parse(e.occurredAt)).toBeLessThanOrEqual(Date.parse(last.finalizedAt));
    }
    if (last.status === "expired") expect(last.finalizedAt).toBe(last.deadlineAt);
    if (last.status === "submitted") expect(Date.parse(last.finalizedAt!)).toBeLessThan(Date.parse(last.deadlineAt));
  });

  it.each(SEEDS)("seed %i: the result matches the event log exactly and its counts partition", async (seed) => {
    const { trail } = await run(seed);
    const last = trail[trail.length - 1]!;
    if (last.status === "in_progress") {
      expect(last.result).toBeNull();
      return;
    }
    const r = last.result!;
    const answeredPositions = new Set(last.events.map((e) => e.position));
    expect(r.questions.filter((q) => q.answered).map((q) => q.position).sort()).toEqual([...answeredPositions].sort());
    expect(r.totals.answered + r.totals.unanswered).toBe(r.totals.questionCount);
    expect(r.totals.correct + r.totals.incorrect + r.totals.notGraded).toBe(r.totals.answered);
    expect(r.sections.reduce((s, x) => s + x.answered, 0)).toBe(r.totals.answered);
    expect(r.status).toBe(last.status);
    expect(r.scoring.defined).toBe(false);
    expect(r.isHistoricalPaper).toBe(false);
  });

  it.each(SEEDS)("seed %i: deterministic - replaying the same operations gives an identical state", async (seed) => {
    expect((await run(seed)).trail).toEqual((await run(seed)).trail);
  });
});

describe("boundary: no exam rule, no scoring, no other system, no client time, no clock of its own", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const read = (f: string) => readFileSync(join(SRC, f), "utf-8");
  const code = files.map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n").toLowerCase();
  it("imports nothing outside its own files: it depends on no other package", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^"']+)["']/g)) imports.add(m[1]!);
    expect([...imports].filter((i) => !i.startsWith("./"))).toEqual([]);
  });
  it("names no training, adaptive, revision, repair, mastery, attempt, curriculum or persistence code", () => {
    for (const w of ["training", "adaptive", "revision", "repairplan", "mastery", "@ipmat/attempt", "curriculum", "prisma", "@ipmat/db", "orchestrat"]) expect(code, w).not.toContain(w);
  });
  it("has no readiness, confidence, ability, motivation or prediction vocabulary", () => {
    for (const w of ["readiness", "confidence", "motivation", "emotion", "likelihood", "predict", "forecast"]) expect(code, w).not.toContain(w);
    expect(code).not.toMatch(/(^|[^a-z])ability/);
  });
  it("has no hard-coded exam rule: no exam name, duration, section name, marks or negative marking", () => {
    for (const w of ["ipmat", "jee", "negative", "marks", "penalty", "section a", "quant"]) expect(code, w).not.toContain(w);
    expect(code).not.toMatch(/overalldurationseconds\s*[:=]\s*\d/);
  });
  it("computes no score: the only 'score' text is the statement that none is computed", () => {
    const occurrences = [...code.matchAll(/score/g)].length;
    expect(occurrences).toBe(1);
    expect(code).toContain("no score is computed");
  });
  it("reads no system clock, randomness or network, and no operation takes a client-supplied time", () => {
    expect(code).not.toMatch(/date\.now|new date\(\)|math\.random|fetch\(|https?:\/\/|randomuuid|performance\.now/);
    const inputs = [...read("engine.ts").matchAll(/export interface AnswerInput\s*\{([^}]*)\}/g)][0]?.[1] ?? "";
    expect(inputs.replace(/\s+/g, " ")).toBe(" position: number; answer: string; ");
  });
  it("has no deletion or reopening path: finalized state is terminal", () => {
    for (const w of ["reopen", "unfinalize", "extenddeadline", "extendtime", "extra time"]) expect(code, w).not.toContain(w);
    // pause/resume exist only as the documented constant `pauseresume: false`, never as an operation
    expect(code).not.toMatch(/(pause|resume)\w*\s*\(|(pause|resume)\w*\s*:\s*true/);
    expect(code).toContain("pauseresume: false");
  });
});
