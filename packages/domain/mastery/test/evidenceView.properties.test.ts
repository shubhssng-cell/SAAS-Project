import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMasteryEvidenceView, type EvidenceBucket, type MasteryAttemptRecord } from "../src/index.js";
import { hardNovelQuestion, otherPatternFamilyQuestion, pressureQuestion, record, standardQuestion } from "../fixtures/attemptRecord.js";

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
const QUESTIONS = [standardQuestion, hardNovelQuestion, pressureQuestion, otherPatternFamilyQuestion, { ...standardQuestion, questionId: "q-ratio", conceptName: "Ratio" }, { ...standardQuestion, questionId: "q-jee", examCode: "JEE_MAIN" }];

function generate(seed: number): MasteryAttemptRecord[] {
  const r = rng(seed);
  return Array.from({ length: Math.floor(r() * 40) }, (_, i) => {
    const q = QUESTIONS[Math.floor(r() * QUESTIONS.length)]!;
    const kind = r();
    return record(i, {
      attemptId: `s${seed}-a${i}`,
      studentId: r() < 0.1 ? "other-student" : "student-1",
      status: kind < 0.15 ? "skipped" : kind < 0.2 ? "abandoned" : "submitted",
      isCorrect: kind < 0.2 ? null : kind < 0.25 ? null : r() < 0.6,
      skipped: kind < 0.15,
      timeTakenSeconds: kind < 0.2 ? null : 20 + Math.floor(r() * 200)
    }, q);
  });
}
const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j]!, c[i]!]; }
  return c;
};
const scope = { studentId: "student-1", examCode: "IPMAT_INDORE" };
const allBuckets = (v: ReturnType<typeof buildMasteryEvidenceView>): EvidenceBucket[] =>
  v.concepts.flatMap((c) => [c.overall, ...Object.values(c.byPatternFamily), ...Object.values(c.byNoveltyLevel).filter((b): b is EvidenceBucket => !!b), ...Object.values(c.byTestingMode)]);

describe("property: evidence invariants over generated histories", () => {
  it.each(SEEDS)("seed %i: every bucket partitions its attempts and its distinct counts never exceed its attempt counts", (seed) => {
    const v = buildMasteryEvidenceView(generate(seed), scope);
    for (const b of allBuckets(v)) {
      expect(b.gradedAttempts + b.skippedAttempts + b.abandonedAttempts + b.ungradedAttempts).toBe(b.attempts);
      expect(b.correctGradedAttempts + b.incorrectGradedAttempts).toBe(b.gradedAttempts);
      expect(b.distinctQuestions).toBeLessThanOrEqual(b.attempts);
      expect(b.distinctGradedQuestions).toBeLessThanOrEqual(b.gradedAttempts);
      expect(b.distinctGradedQuestions).toBeLessThanOrEqual(b.distinctQuestions);
      expect(b.distinctSkippedQuestions).toBeLessThanOrEqual(b.skippedAttempts);
      expect(b.contributingAttemptIds).toHaveLength(b.attempts);
      expect(new Set(b.contributingAttemptIds).size).toBe(b.attempts);
      expect(b.timedObservations.length).toBeLessThanOrEqual(b.gradedAttempts);
    }
  });

  it.each(SEEDS)("seed %i: accounting is exact (included + excluded = input) and single-membership dimensions sum to overall", (seed) => {
    const records = generate(seed);
    const v = buildMasteryEvidenceView(records, scope);
    const excluded = v.excluded.otherStudent + v.excluded.otherExam + v.excluded.outsideConceptUniverse + v.excluded.duplicateAttemptRecords;
    expect(v.includedAttempts + excluded).toBe(records.length);
    expect(v.concepts.reduce((s, c) => s + c.overall.attempts, 0)).toBe(v.includedAttempts);
    for (const c of v.concepts) {
      expect(Object.values(c.byPatternFamily).reduce((s, b) => s + b.attempts, 0)).toBe(c.overall.attempts);
      expect(Object.values(c.byNoveltyLevel).reduce((s, b) => s + b!.attempts, 0)).toBe(c.overall.attempts);
      expect(c.questions.reduce((s, q) => s + q.attempts, 0)).toBe(c.overall.attempts);
      expect(c.questions).toHaveLength(c.overall.distinctQuestions);
    }
  });

  it.each(SEEDS)("seed %i: deterministic, order-independent and non-mutating", (seed) => {
    const records = generate(seed);
    const before = JSON.stringify(records);
    const r = rng(seed * 104729);
    expect(buildMasteryEvidenceView(shuffle(records, r), scope)).toEqual(buildMasteryEvidenceView(records, scope));
    expect(JSON.stringify(records)).toBe(before);
  });

  it.each(SEEDS)("seed %i: another student's or another exam's records never change this view; they are only counted", (seed) => {
    const mine = generate(seed).filter((rec) => rec.contribution.studentId === "student-1" && rec.question.examCode === "IPMAT_INDORE");
    const foreign = [
      record(500, { attemptId: `f-${seed}-1`, studentId: "intruder" }),
      record(501, { attemptId: `f-${seed}-2` }, { ...standardQuestion, questionId: "foreign", examCode: "CAT" })
    ];
    const base = buildMasteryEvidenceView(mine, scope);
    const mixed = buildMasteryEvidenceView([...mine, ...foreign], scope);
    expect(mixed.concepts).toEqual(base.concepts);
    expect(mixed.excluded.otherStudent).toBe(base.excluded.otherStudent + 1);
    expect(mixed.excluded.otherExam).toBe(base.excluded.otherExam + 1);
  });

  it.each(SEEDS)("seed %i: adding a duplicate or a skip never changes graded counts", (seed) => {
    const records = generate(seed);
    const base = buildMasteryEvidenceView(records, scope);
    const withExtras = buildMasteryEvidenceView([...records, ...records.slice(0, 3), record(900, { attemptId: `skip-${seed}`, status: "skipped", isCorrect: null, skipped: true })], scope);
    // a skip may create a concept entry that had no evidence before, but with zero graded evidence
    const gradedOf = (v: typeof base, name: string) => v.concepts.find((c) => c.conceptName === name)?.overall.gradedAttempts ?? 0;
    const correctOf = (v: typeof base, name: string) => v.concepts.find((c) => c.conceptName === name)?.overall.correctGradedAttempts ?? 0;
    for (const c of withExtras.concepts) {
      expect(gradedOf(withExtras, c.conceptName)).toBe(gradedOf(base, c.conceptName));
      expect(correctOf(withExtras, c.conceptName)).toBe(correctOf(base, c.conceptName));
    }
  });
});

describe("boundary: the evidence module contains no judgment, inference or prediction", () => {
  const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "evidenceView.ts"), "utf-8");
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").toLowerCase();
  it("imports nothing but types (no model, db, clock or other package behaviour)", () => {
    const imports = [...SRC.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./types.js", "@ipmat/question-engine"]);
    expect(SRC).toMatch(/import type \{ NoveltyLevel \} from "@ipmat\/question-engine"/);
  });
  it("has no clock, randomness, network or vendor", () => {
    expect(code).not.toMatch(/date\.now|new date\(\)|math\.random|fetch\(|https?:\/\//);
    for (const v of ["anthropic", "openai", "gemini", "claude"]) expect(code).not.toContain(v);
  });
  it("has no mastery verdict, score, threshold, confidence, ability or prediction vocabulary", () => {
    for (const w of ["mastered", "unmastered", "score", "threshold", "confidence", "ability", "motivation", "emotion", "likelihood", "predict", "forecast", "decay", "recency", "weight"]) expect(code, w).not.toContain(w);
  });
  it("has no prerequisite, repair, diagnosis, revision or speed-to-mastery logic", () => {
    for (const w of ["prerequisite", "repair", "diagnos", "revision", "speedratio", "fast", "slow"]) expect(code, w).not.toContain(w);
  });
});
