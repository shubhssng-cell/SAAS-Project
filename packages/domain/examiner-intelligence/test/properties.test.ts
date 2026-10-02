import { describe, expect, it } from "vitest";
import { selectRecords, summarizeObservedTesting, validateHistoricalRecord, type HistoricalQuestionRecord } from "../src/index.js";
import { baseClassification, fixtureRecord, ipmatContext, rng, realSourceRecord } from "./fixtures.js";

/** Seeded-PRNG properties (no new dependency; fast-check is not installed). The seed is in the test name. */
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const FAMILIES = ["Reverse Percentage", "Successive Percentage Change", "Percentage Point vs Percentage Change"];
const MODES = ["direct", "reverse", "transformed", "contextualized", "multi_step"] as const;
const NOVELTY = ["standard", "novel_representation", "novel_context"] as const;
const STATES = ["raw_imported", "candidate_annotation", "reviewed_validated"] as const;

function randomRecords(seed: number): HistoricalQuestionRecord[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const n = 5 + Math.floor(r() * 25);
  return Array.from({ length: n }, (_, i) => {
    const state = pick(STATES);
    const exam = r() < 0.25 ? "OTHER_EXAM" : "IPMAT_INDORE";
    const origin = r() < 0.5 ? "fixture" : "real_source";
    const base = origin === "fixture" ? fixtureRecord : realSourceRecord;
    const classification = state === "raw_imported" ? null : { ...baseClassification({ patternFamilyName: pick(FAMILIES), testingModes: [pick(MODES)], noveltyLevel: pick(NOVELTY), combinesWithConcepts: [], expectedTimeSeconds: 30 + Math.floor(r() * 200) }), examCode: exam };
    return base(`r${i}`, {
      examCode: exam,
      annotationState: state,
      classification,
      authorship: classification ? "human" : null,
      review: state === "reviewed_validated" ? { reviewedBy: "x", reviewedAt: "2026-10-02" } : null
    });
  });
}

const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [c[i], c[j]] = [c[j]!, c[i]!];
  }
  return c;
};

describe("property: queries over generated record sets", () => {
  it.each(SEEDS)("seed %i: results are independent of input order", (seed) => {
    const recs = randomRecords(seed);
    const filter = { examCode: "IPMAT_INDORE", origins: ["fixture", "real_source"], states: ["reviewed_validated", "candidate_annotation", "raw_imported"] } as const;
    expect(summarizeObservedTesting(shuffle(recs, rng(seed + 99)), filter)).toEqual(summarizeObservedTesting(recs, filter));
  });

  it.each(SEEDS)("seed %i: a query for one exam never returns another exam's record", (seed) => {
    const recs = randomRecords(seed);
    for (const examCode of ["IPMAT_INDORE", "OTHER_EXAM"]) {
      const out = selectRecords(recs, { examCode, origins: ["fixture", "real_source"], states: [...STATES] });
      expect(out.every((x) => x.examCode === examCode)).toBe(true);
      expect(out.length).toBe(recs.filter((x) => x.examCode === examCode).length);
    }
  });

  it.each(SEEDS)("seed %i: default queries only ever return reviewed, real-source records", (seed) => {
    for (const x of selectRecords(randomRecords(seed), { examCode: "IPMAT_INDORE" })) {
      expect(x.annotationState).toBe("reviewed_validated");
      expect(x.dataOrigin).toBe("real_source");
    }
  });

  it.each(SEEDS)("seed %i: facet counts add up to the number of classified records (no double counting, no loss)", (seed) => {
    const recs = randomRecords(seed);
    const filter = { examCode: "IPMAT_INDORE", origins: ["fixture", "real_source"], states: [...STATES] } as const;
    const s = summarizeObservedTesting(recs, filter);
    const classified = selectRecords(recs, filter).filter((x) => x.classification !== null).length;
    expect(s.recordCount).toBe(classified);
    expect(s.concepts.reduce((n, c) => n + c.count, 0)).toBe(classified);
    expect(s.patterns.reduce((n, c) => n + c.count, 0)).toBe(classified);
    expect(s.noveltyLevels.reduce((n, c) => n + c.count, 0)).toBe(classified);
    expect(s.difficultyTiers.reduce((n, c) => n + c.count, 0)).toBe(classified);
  });

  it.each(SEEDS)("seed %i: every generated record is valid for its own exam context only", (seed) => {
    for (const x of randomRecords(seed).filter((y) => y.examCode === "IPMAT_INDORE")) expect(validateHistoricalRecord(x, ipmatContext()).valid, x.id).toBe(true);
  });
});
