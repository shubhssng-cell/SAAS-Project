import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRevisionIntelligence, deriveRevisionSignals, scopeContextToExam } from "../src/index.js";
import { attempt, candidate, contextOf, evidenceOf, EXAM, question, realRuns, resetCounter, STUDENT } from "./fixtures.js";

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
const FAMILIES = ["Reverse Percentage", "Successive Percentage Change", "Percentage Point vs Percentage Change"];
const NOVELTY = ["standard", "novel_representation", "novel_context"] as const;
const MODES = ["direct", "reverse", "combined", "contextualized"] as const;
const TRAPS = [null, "base_confusion", "sign_error"] as const;

function world(seed: number) {
  resetCounter();
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const questions = Array.from({ length: 4 + Math.floor(r() * 12) }, (_, i) =>
    question(`s${seed}-q${i}`, {
      conceptName: pick(CONCEPTS),
      patternFamilyName: pick(FAMILIES),
      noveltyLevel: pick(NOVELTY),
      testingModes: [pick(MODES)],
      trapErrorTaxonomyCode: pick(TRAPS),
      examCode: r() < 0.1 ? "JEE_MAIN" : EXAM
    })
  );
  const records = Array.from({ length: Math.floor(r() * 30) }, (_, i) => {
    const q = pick(questions);
    const kind = r();
    return attempt(q, {
      id: `s${seed}-a${i}`,
      studentId: r() < 0.08 ? "student-2" : STUDENT,
      status: kind < 0.15 ? "skipped" : kind < 0.2 ? "abandoned" : "submitted",
      isCorrect: r() < 0.55,
      daysAgo: Math.floor(r() * 60)
    });
  });
  const candidates = questions.map((q) => candidate(q, { validationState: r() < 0.2 ? "draft" : "published" }));
  return { records, candidates };
}
const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j]!, c[i]!]; }
  return c;
};
function compute(records: ReturnType<typeof attempt>[], candidates: ReturnType<typeof candidate>[]) {
  const scoped = scopeContextToExam(contextOf(records, candidates), EXAM);
  const evidence = evidenceOf(scoped.attemptRecords);
  return { scoped, result: buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence, context: scoped, runs: realRuns(scoped) }) };
}

describe("property: revision intelligence over generated histories", () => {
  it.each(SEEDS)("seed %i: trace integrity - every id referenced exists, every recommended question is a published pool question of this exam", (seed) => {
    const { records, candidates } = world(seed);
    const { scoped, result } = compute(records, candidates);
    const attemptIds = new Set(scoped.attemptRecords.map((x) => x.contribution.attemptId));
    const signalIds = new Set(result.signals.map((s) => s.id));
    expect(signalIds.size).toBe(result.signals.length);
    for (const s of result.signals) for (const id of s.contributingAttemptIds) expect(attemptIds.has(id)).toBe(true);
    for (const rec of result.recommendations) {
      for (const id of rec.supportingSignalIds) expect(signalIds.has(id)).toBe(true);
      for (const id of rec.contributingAttemptIds) expect(attemptIds.has(id)).toBe(true);
      const pooled = scoped.candidates.find((c) => c.question.questionId === rec.question.questionId);
      expect(pooled?.validationState).toBe("published");
      expect(pooled?.question.examCode).toBe(EXAM);
      expect(rec.producedBy).toBe(rec.systemId);
    }
    for (const u of result.unservedSignals) expect(signalIds.has(u.signalId)).toBe(true);
    const served = new Set(result.recommendations.flatMap((x) => x.supportingSignalIds));
    expect(result.unservedSignals.map((u) => u.signalId).sort()).toEqual(result.signals.filter((s) => !served.has(s.id)).map((s) => s.id).sort());
    expect(result.priority.defined).toBe(false);
  });

  it.each(SEEDS)("seed %i: deterministic and independent of record/candidate order", (seed) => {
    const { records, candidates } = world(seed);
    const r = rng(seed * 7919);
    expect(compute(shuffle(records, r), shuffle(candidates, r)).result).toEqual(compute(records, candidates).result);
  });

  it.each(SEEDS)("seed %i: other students' and other exams' data never changes the result (after scoping)", (seed) => {
    const { records, candidates } = world(seed);
    const mine = records.filter((x) => x.contribution.studentId === STUDENT && x.question.examCode === EXAM);
    const mineCandidates = candidates.filter((c) => c.question.examCode === EXAM);
    expect(compute(records, candidates).result).toEqual(compute(mine, mineCandidates).result);
  });

  it.each(SEEDS)("seed %i: adding a question that is not published or not in this exam never changes the recommendations", (seed) => {
    const { records, candidates } = world(seed);
    const base = compute(records, candidates).result;
    const noise = [candidate(question(`zz-draft-${seed}`), { validationState: "draft" }), candidate(question(`zz-foreign-${seed}`, { examCode: "JEE_MAIN" }))];
    const widened = compute(records, [...candidates, ...noise]).result;
    expect(widened.recommendations.map((x) => [x.systemId, x.question.questionId])).toEqual(base.recommendations.map((x) => [x.systemId, x.question.questionId]));
  });

  it.each(SEEDS)("seed %i: signals are a pure function of evidence + context (no mutation, repeated calls equal)", (seed) => {
    const { records, candidates } = world(seed);
    const scoped = scopeContextToExam(contextOf(records, candidates), EXAM);
    const evidence = evidenceOf(scoped.attemptRecords);
    const before = JSON.stringify([evidence, scoped]);
    const first = deriveRevisionSignals(evidence, scoped);
    expect(deriveRevisionSignals(evidence, scoped)).toEqual(first);
    expect(JSON.stringify([evidence, scoped])).toBe(before);
  });
});

describe("boundary: no scoring, ranking, verdict, inference, randomness or hidden model", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const read = (f: string) => readFileSync(join(SRC, f), "utf-8");
  const code = files.map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n").toLowerCase();
  it("imports only the existing domain vocabulary and providers' shared pure helpers", () => {
    const imports = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/from\s+["']([^."'][^"']*)["']/g)) imports.add(m[1]!);
    expect([...imports].sort()).toEqual(["@ipmat/autopsy", "@ipmat/mastery", "@ipmat/revision-training", "@ipmat/training-systems", "@ipmat/trap-lab"]);
  });
  it("has no clock, randomness, network, model call or vendor", () => {
    expect(code).not.toMatch(/date\.now|new date\(\)|math\.random|fetch\(|https?:\/\//);
    for (const v of ["anthropic", "openai", "gemini", "claude", "generatestructured"]) expect(code).not.toContain(v);
  });
  it("has no score, ranking, verdict, confidence, ability or prediction vocabulary", () => {
    for (const w of ["score", "ranking", "leaderboard", "mastered", "unmastered", "confidence", "motivation", "emotion", "likelihood", "predict", "forecast", "readiness"]) expect(code, w).not.toContain(w);
  });
  it("imports no persistence, route or web code, and writes nothing", () => {
    for (const w of ["prisma", "@ipmat/db", "writefile", "insert ", "upsert"]) expect(code, w).not.toContain(w);
  });
  it("does not re-implement a provider: it never selects, filters or sorts candidate questions", () => {
    expect(code).not.toMatch(/candidates\s*\.sort|\.sort\(\(a, b\) => .*expectedtime/);
  });
});
