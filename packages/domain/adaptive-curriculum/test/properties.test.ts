import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectNextQuestion } from "@ipmat/adaptive-selection";
import { orchestrateNextTrainingAction } from "@ipmat/training-orchestration";
import { describe, expect, it } from "vitest";
import { attempt, build, candidate, EXAM, question, repairCandidate, repairPlan, resetCounter, STUDENT, type Pool, type Records } from "./fixtures.js";

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
const CONCEPTS = ["Percentages", "Ratio"];
const FAMILIES = ["Reverse Percentage", "Successive Percentage Change"];
const NOVELTY = ["standard", "novel_representation", "novel_context"] as const;
const MODES = ["direct", "reverse", "combined"] as const;
const TRAPS = [null, "base_confusion", "sign_error"] as const;

function world(seed: number): { records: Records; candidates: Pool; withRepair: boolean } {
  resetCounter();
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const questions = Array.from({ length: 3 + Math.floor(r() * 10) }, (_, i) =>
    question(`s${seed}-q${i}`, { conceptName: pick(CONCEPTS), patternFamilyName: pick(FAMILIES), noveltyLevel: pick(NOVELTY), testingModes: [pick(MODES)], trapErrorTaxonomyCode: pick(TRAPS), examCode: r() < 0.1 ? "JEE_MAIN" : EXAM })
  );
  const records = Array.from({ length: Math.floor(r() * 25) }, (_, i) => {
    const q = pick(questions);
    const k = r();
    return attempt(q, { id: `s${seed}-a${i}`, studentId: r() < 0.08 ? "student-2" : STUDENT, status: k < 0.15 ? "skipped" : k < 0.2 ? "abandoned" : "submitted", isCorrect: r() < 0.55, daysAgo: Math.floor(r() * 60) });
  });
  const candidates = questions.map((q) => candidate(q, { validationState: r() < 0.2 ? "draft" : "published" }));
  return { records, candidates, withRepair: r() < 0.3 };
}
const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j]!, c[i]!]; }
  return c;
};
const plans = (withRepair: boolean) => (withRepair ? [repairPlan()] : []);

describe("property: curriculum over generated histories", () => {
  it.each(SEEDS)("seed %i: structural invariants - one chain of 7 tiers, at most one orchestrator action, every id and question traceable", (seed) => {
    const w = world(seed);
    const pool = [...w.candidates, repairCandidate()];
    const { curriculum } = build(w.records, pool, plans(w.withRepair));
    expect(curriculum.chain).toHaveLength(7);
    expect(curriculum.chain.map((c) => c.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(curriculum.sequencing.definedBeyondExistingChain).toBe(false);
    expect(curriculum.steps.filter((s) => s.isOrchestratorNextAction).length).toBeLessThanOrEqual(1);
    expect(curriculum.steps.filter((s) => s.outsideAdaptiveChain).every((s) => s.chainOrder === null && s.systemId === "revision")).toBe(true);
    const published = new Set(pool.filter((c) => c.validationState === "published" && c.question.examCode === EXAM).map((c) => c.question.questionId));
    for (const s of curriculum.steps) expect(published.has(s.question.questionId)).toBe(true);
    if (curriculum.nextAction.status === "selected") {
      expect(published.has(curriculum.nextAction.question.questionId)).toBe(true);
      expect(curriculum.steps.some((s) => s.isOrchestratorNextAction)).toBe(true);
      const next = curriculum.nextAction;
      expect(next.chainOrder).toBe(curriculum.chain.find((c) => c.selectedQuestionId === next.question.questionId && c.reachedByOrchestrator)!.order);
    } else {
      expect(curriculum.steps.some((s) => !s.outsideAdaptiveChain)).toBe(false);
    }
    const signalIds = new Set(curriculum.revision.signals.map((s) => s.id));
    for (const c of curriculum.concepts) for (const id of c.revisionSignalIds) expect(signalIds.has(id)).toBe(true);
    expect(curriculum.concepts.map((c) => c.conceptName)).toEqual([...curriculum.concepts.map((c) => c.conceptName)].sort());
  });

  it.each(SEEDS)("seed %i: deterministic and independent of record/candidate order", (seed) => {
    const w = world(seed);
    const r = rng(seed * 7919);
    const pool = [...w.candidates, repairCandidate()];
    expect(build(shuffle(w.records, r), shuffle(pool, r), plans(w.withRepair)).curriculum).toEqual(build(w.records, pool, plans(w.withRepair)).curriculum);
  });

  it.each(SEEDS)("seed %i: other students' and other exams' data never changes the curriculum", (seed) => {
    const w = world(seed);
    const mine = w.records.filter((x) => x.contribution.studentId === STUDENT && x.question.examCode === EXAM);
    const myPool = w.candidates.filter((c) => c.question.examCode === EXAM);
    const a = build(w.records, w.candidates, plans(w.withRepair)).curriculum;
    const b = build(mine, myPool, plans(w.withRepair)).curriculum;
    for (const key of Object.keys(a) as Array<keyof typeof a>) expect(a[key], String(key)).toEqual(b[key]);
  });

  it.each(SEEDS)("seed %i: adding unpublished or other-exam questions changes neither the next action nor the steps", (seed) => {
    const w = world(seed);
    const base = build(w.records, w.candidates).curriculum;
    const noise = [candidate(question(`zz-d-${seed}`), { validationState: "draft" }), candidate(question(`zz-f-${seed}`, { examCode: "JEE_MAIN" }))];
    const widened = build(w.records, [...w.candidates, ...noise]).curriculum;
    expect(widened.nextAction).toEqual(base.nextAction);
    expect(widened.steps).toEqual(base.steps);
  });

  it.each(SEEDS)("seed %i: Phase 3 and Phase 5D behaviour is unchanged - the embedded next action equals the orchestrator's own result", (seed) => {
    const w = world(seed);
    const { curriculum, orchestrationInput } = build(w.records, w.candidates, plans(w.withRepair));
    const scoped = { ...orchestrationInput, attemptRecords: w.records.filter((x) => x.contribution.studentId === STUDENT && x.question.examCode === EXAM), candidates: w.candidates.filter((c) => c.question.examCode === EXAM) };
    const direct = orchestrateNextTrainingAction(scoped);
    if (direct.status === "selected") {
      expect(curriculum.nextAction.status === "selected" && curriculum.nextAction.question.questionId).toBe(direct.question.questionId);
      expect(curriculum.nextAction.status === "selected" && curriculum.nextAction.actionType).toBe(direct.actionType);
    } else {
      expect(curriculum.nextAction.status).toBe("no_action");
    }
  });
});

describe("Phase 3 adaptive selection is untouched by composition", () => {
  it("selectNextQuestion gives the same answer before and after a curriculum is built", () => {
    const w = world(7);
    const input = { studentId: STUDENT, masteryByConcept: [], attemptRecords: w.records.filter((x) => x.contribution.studentId === STUDENT), candidates: w.candidates.filter((c) => c.question.examCode === EXAM) } as unknown as Parameters<typeof selectNextQuestion>[0];
    const before = JSON.stringify(selectNextQuestion(input));
    build(w.records, w.candidates);
    expect(JSON.stringify(selectNextQuestion(input))).toBe(before);
  });
});

describe("boundary: orchestration only - no scoring, selection, ranking, inference, randomness or hidden model", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const read = (f: string) => readFileSync(join(SRC, f), "utf-8");
  const code = files.map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n").toLowerCase();
  it("imports only the existing domain contracts", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/mastery", "@ipmat/revision-intelligence", "@ipmat/training-orchestration", "@ipmat/training-systems"]);
  });
  it("calls no selection engine or provider: it never invokes the orchestrator, adaptive, repair or any provider itself", () => {
    for (const w of ["selectnextquestion", "selectrepairquestion", "orchestratenexttrainingaction", "runtrainingsystem", "evaluate(", ".select("]) expect(code, w).not.toContain(w);
  });
  it("has no clock, randomness, network, model call or vendor", () => {
    expect(code).not.toMatch(/date\.now|new date\(\)|math\.random|fetch\(|https?:\/\//);
    for (const v of ["anthropic", "openai", "gemini", "claude", "generatestructured"]) expect(code).not.toContain(v);
  });
  it("has no score, ranking, verdict, confidence, ability or prediction vocabulary, and does not sort candidate questions", () => {
    for (const w of ["score", "leaderboard", "mastered", "unmastered", "confidence", "motivation", "emotion", "likelihood", "predict", "forecast", "readiness"]) expect(code, w).not.toContain(w);
    expect(code).not.toMatch(/candidates\s*\.sort|pool\s*\.sort/);
  });
  it("imports no persistence, route or web code and writes nothing", () => {
    for (const w of ["prisma", "@ipmat/db", "writefile", "insert ", "upsert"]) expect(code, w).not.toContain(w);
  });
});
