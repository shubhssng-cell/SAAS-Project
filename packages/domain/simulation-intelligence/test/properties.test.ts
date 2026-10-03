import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FinalizedSimulationEvidence } from "@ipmat/exam-simulation";
import { describe, expect, it } from "vitest";
import { buildExamPerformanceIntelligence, SimulationIntelligenceError, type ExamPerformanceIntelligence } from "../src/index.js";
import { EXAM, finalizedSimulation, resetCounter, STUDENT, trapWorld, unitsFor } from "./fixtures.js";

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
const IDS = ["q-1", "q-2", "q-3", "q-trap", "q-fresh"];
const ANSWERS = ["right", "wrong", undefined] as const;

async function randomSims(seed: number): Promise<FinalizedSimulationEvidence[]> {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 5);
  const sims: FinalizedSimulationEvidence[] = [];
  const papers = [IDS.slice(0, 3), IDS.slice(2, 5), IDS.slice(0, 3)];
  for (let i = 0; i < n; i++) {
    const paper = papers[Math.floor(r() * papers.length)]!;
    const answers: Record<number, string> = {};
    paper.forEach((_, p) => {
      const a = ANSWERS[Math.floor(r() * 3)];
      if (a) answers[p + 1] = a;
    });
    sims.push((await finalizedSimulation({ id: `s${seed}-${i}`, questionIds: paper, answers, startMs: i * 4_000_000, end: r() < 0.3 ? "deadline" : "submit", configVersion: r() < 0.2 ? "fixture-v2" : "fixture-v1" })).evidence);
  }
  return sims;
}

const world = trapWorld();
const units = unitsFor(world.records, world.candidates);
const run = (sims: readonly FinalizedSimulationEvidence[]): ExamPerformanceIntelligence =>
  buildExamPerformanceIntelligence({ studentId: STUDENT, examCode: EXAM, simulations: sims, publishedPool: units.publishedPool, evidence: units.evidence, revision: units.revision, curriculum: units.curriculum });

const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j]!, c[i]!]; }
  return c;
};

describe("property: deterministic evidence over generated finalized simulations", () => {
  it.each(SEEDS)("seed %i: deterministic and independent of input order, and a repeated simulation id changes nothing", async (seed) => {
    resetCounter();
    const sims = await randomSims(seed);
    const r = rng(seed * 7919);
    const base = run(sims);
    expect(run(shuffle(sims, r))).toEqual(base);
    expect(run([...sims, ...sims.slice(0, 2)])).toEqual(base);
    expect(base.simulationCount).toBe(sims.length);
  });

  it.each(SEEDS)("seed %i: every aggregate partitions correctly and every id traces back to a supplied simulation", async (seed) => {
    const sims = await randomSims(seed);
    const out = run(sims);
    const ids = new Set(sims.map((s) => s.simulationId));
    for (const buckets of Object.values(out.dimensions)) for (const b of buckets) {
      expect(b.answered + b.unanswered).toBe(b.appearances);
      expect(b.correct + b.incorrect + b.notGraded).toBe(b.answered);
      for (const id of b.simulationIds) expect(ids.has(id)).toBe(true);
    }
    for (const o of out.observations) for (const id of o.simulationIds) expect(ids.has(id)).toBe(true);
    for (const g of out.comparisons.groups) for (const id of g.simulationIds) expect(ids.has(id)).toBe(true);
    const inGroups = out.comparisons.groups.flatMap((g) => g.simulationIds).length + out.comparisons.notCompared.length;
    expect(inGroups).toBe(sims.length); // every simulation is either compared with a comparable one or reported as not compared
    for (const g of out.comparisons.groups) expect(g.simulationIds.length).toBeGreaterThanOrEqual(2);
    expect(out.concepts.reduce((s, c) => s + c.conceptMastery.simulation.appearances, 0)).toBe(out.dimensions.concept.reduce((s, b) => s + b.appearances, 0));
  });

  it.each(SEEDS)("seed %i: monotonic - adding a finalized simulation never decreases any simulation-source count", async (seed) => {
    const sims = await randomSims(seed);
    const extra = (await finalizedSimulation({ id: `extra-${seed}`, questionIds: IDS.slice(0, 3), answers: { 1: "right" }, startMs: 99_000_000 })).evidence;
    const before = run(sims);
    const after = run([...sims, extra]);
    expect(after.simulationCount).toBe(before.simulationCount + 1);
    for (const dim of Object.keys(before.dimensions) as Array<keyof typeof before.dimensions>) {
      for (const b of before.dimensions[dim]) {
        const a = after.dimensions[dim].find((x) => x.value === b.value)!;
        expect(a.appearances).toBeGreaterThanOrEqual(b.appearances);
        expect(a.answered).toBeGreaterThanOrEqual(b.answered);
        expect(a.correct).toBeGreaterThanOrEqual(b.correct);
        expect(a.unanswered).toBeGreaterThanOrEqual(b.unanswered);
      }
    }
  });

  it.each(SEEDS)("seed %i: simulation and exam isolation - another student's or exam's simulation is refused, and never changes the result", async (seed) => {
    const sims = await randomSims(seed);
    const base = run(sims);
    const theirs = (await finalizedSimulation({ id: `other-${seed}`, questionIds: IDS.slice(0, 3), answers: { 1: "right" }, studentId: "student-2" })).evidence;
    const foreign = (await finalizedSimulation({ id: `foreign-${seed}`, questionIds: IDS.slice(0, 3), answers: { 1: "right" }, examCode: "JEE_MAIN" })).evidence;
    for (const bad of [theirs, foreign]) expect(() => run([...sims, bad])).toThrowError(SimulationIntelligenceError);
    expect(run(sims)).toEqual(base);
  });

  it.each(SEEDS)("seed %i: finalized-only - anything not finalized is refused whatever else is supplied", async (seed) => {
    const sims = await randomSims(seed);
    const active = { ...sims[0]!, status: "in_progress" } as unknown as FinalizedSimulationEvidence;
    expect(() => run([...sims, active])).toThrowError(/finalized/);
    const noContract = { ...sims[0]!, contract: undefined } as unknown as FinalizedSimulationEvidence;
    expect(() => run([noContract])).toThrowError(/finalized/);
  });

  it.each(SEEDS)("seed %i: no score, percentage, probability, category, verdict, confidence, ability or prediction anywhere", async (seed) => {
    const out = run(await randomSims(seed));
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); }
    };
    walk(out);
    for (const k of keys) expect(k, k).not.toMatch(/^score$|percent|probab|likelihood|rating|^rank|category|classification|verdict$|confidence|(^|[^a-z])ability|predict/i);
    expect(out.readiness.defined).toBe(false);
    expect(out.status).toBe("evidence_only_readiness_unspecified");
  });
});

describe("boundary: pure, evidence-only, no scoring or inference, no persistence, no clock", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const read = (f: string) => readFileSync(join(SRC, f), "utf-8");
  const code = files.map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n").toLowerCase();
  it("imports only the existing contracts it reads", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/adaptive-curriculum", "@ipmat/autopsy", "@ipmat/exam-simulation", "@ipmat/mastery", "@ipmat/revision-intelligence", "@ipmat/training-systems"]);
  });
  it("reads only the finalized-evidence contract: it never touches the simulation engine's active-state operations", () => {
    for (const w of ["plananswer", "plansubmit", "startsimulation", "applymutation", "simulationservice", "buildsimulationview", "simulationrepository"]) expect(code, w).not.toContain(w);
  });
  it("selects, orders and recommends nothing: no selection engine, provider or orchestrator is called", () => {
    for (const w of ["selectnextquestion", "orchestratenexttrainingaction", "runtrainingsystem", "evaluate(", ".select(", "buildadaptivecurriculum", "buildrevisionintelligence"]) expect(code, w).not.toContain(w);
  });
  it("has no readiness score, probability, confidence, ability, motivation or prediction logic - the words appear only inside disclaimers", () => {
    const disclaimer = /\bno\b|\bnone\b|\bnot\b|\bnever\b|undefined|unresolved|exists|specif|forbids|without|computes/;
    const wordsToCheck = ["probability", "likelihood", "predict", "forecast", "confidence", "motivation", "emotion", "percentage", "passchance", "admission"];
    const sourceLines = code.split(String.fromCharCode(10));
    for (const w of wordsToCheck) {
      for (const line of sourceLines.filter((l) => l.includes(w))) expect(disclaimer.test(line), `${w}: ${line.trim().slice(0, 100)}`).toBe(true);
    }
    expect(code).not.toMatch(/(^|[^a-z])ability/);
    expect(code).not.toMatch(/math\.(round|floor)\([^)]*\*\s*100/); // no percentage computation
  });
  it("has no clock, randomness, network, model call, vendor or persistence", () => {
    expect(code).not.toMatch(/date\.now|new date\(\)|math\.random|fetch\(|https?:\/\/|randomuuid/);
    for (const w of ["anthropic", "openai", "gemini", "claude", "prisma", "@ipmat/db", "writefile", "upsert"]) expect(code, w).not.toContain(w);
  });
  it("applies no exam-date, prep-phase, time-decay or urgency rule", () => {
    for (const w of ["prepphase", "examdate", "decay", "urgency", "recency", "weight"]) expect(code, w).not.toContain(w);
  });
});
