import { describe, expect, it } from "vitest";
import { computeCoverage, selectQuestions, type ContentQuestionView, type QuestionSelectionConstraints } from "../src/index.js";
import { record, rng, snapshot, view } from "./fixtures.js";

/** Seeded-PRNG properties (no new dependency). The seed is in the test name, so a failure is reproducible. */
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const FAMILIES = ["Reverse Percentage", "Successive Percentage Change", "Percentage Point vs Percentage Change", "Percentage Share in Data Interpretation"];
const MODES = ["direct", "reverse", "transformed", "contextualized", "multi_step", "represented_differently"] as const;
const NOVELTY = ["standard", "novel_representation", "novel_context"] as const;
const TIERS = ["standard", "advanced", "hard", "extreme", "novel"] as const;
const STATES = ["published", "published", "human_reviewed", "ai_validated", "draft", "rejected"] as const;
const TRAPS = [null, "base_confusion", "successive_change_error", "percentage_point_confusion", "misread_question"] as const;

function generate(seed: number): { questions: ContentQuestionView[]; records: ReturnType<typeof record>[] } {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const questions = Array.from({ length: Math.floor(r() * 40) }, (_, i) => {
    const bad = r() < 0.1;
    return view({
      id: `s${seed}-q${String(i).padStart(3, "0")}`,
      validationState: pick(STATES),
      isFixture: r() < 0.05,
      dna: {
        patternFamilyName: bad ? "No Such Pattern" : pick(FAMILIES),
        testingModes: [pick(MODES)],
        combinesWithConcepts: [],
        noveltyLevel: pick(NOVELTY),
        difficultyTier: pick(TIERS),
        trapErrorTaxonomyCode: pick(TRAPS),
        expectedTimeSeconds: 20 + Math.floor(r() * 250),
        examCode: r() < 0.05 ? "JEE_MAIN" : "IPMAT_INDORE"
      }
    });
  });
  const records = Array.from({ length: Math.floor(r() * 8) }, (_, i) => record(`s${seed}-h${i}`, { dna: { patternFamilyName: pick(FAMILIES), testingModes: [pick(MODES)], combinesWithConcepts: [] } }));
  return { questions, records };
}

const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [c[i], c[j]] = [c[j]!, c[i]!];
  }
  return c;
};

describe("property: coverage invariants over generated data", () => {
  it.each(SEEDS)("seed %i: numerator <= denominator, ratio = numerator/denominator, and published ⊆ validated ⊆ available", (seed) => {
    const { questions, records } = generate(seed);
    const report = computeCoverage(snapshot(questions, records));
    for (const metrics of [report.content.published, report.content.validated, report.content.available, report.historical]) {
      for (const m of metrics) {
        expect(m.numerator).toBeLessThanOrEqual(m.denominator);
        expect(m.members).toHaveLength(m.denominator);
        expect(m.numerator).toBe(m.members.filter((x) => x.count > 0).length);
        if (m.state === "measured") expect(m.ratio).toBe(m.denominator === 0 ? null : m.numerator / m.denominator);
        else expect(m.ratio).toBeNull();
        expect(m.unmapped.every((u) => !m.members.some((x) => x.member === u.member))).toBe(true);
      }
    }
    for (let i = 0; i < report.content.published.length; i++) {
      const p = report.content.published[i]!;
      const v = report.content.validated[i]!;
      const a = report.content.available[i]!;
      expect(p.itemCount).toBeLessThanOrEqual(v.itemCount);
      expect(v.itemCount).toBeLessThanOrEqual(a.itemCount);
      expect(p.numerator).toBeLessThanOrEqual(v.numerator);
      expect(v.numerator).toBeLessThanOrEqual(a.numerator);
    }
  });

  it.each(SEEDS)("seed %i: denominators depend only on the exam model, never on the data", (seed) => {
    const denominators = (r: ReturnType<typeof computeCoverage>) => r.content.published.map((m) => [m.facet, m.denominator]);
    expect(denominators(computeCoverage(snapshot(generate(seed).questions)))).toEqual(denominators(computeCoverage(snapshot([]))));
  });

  it.each(SEEDS)("seed %i: every question is accounted for exactly once (counted + excluded = total)", (seed) => {
    const { questions } = generate(seed);
    const { accounting } = computeCoverage(snapshot(questions));
    expect(accounting.content.total).toBe(questions.length);
    expect(accounting.content.counted + Object.values(accounting.content.excluded).reduce((a, b) => a + b, 0)).toBe(questions.length);
    expect(accounting.content.tiers.published).toBeLessThanOrEqual(accounting.content.tiers.validated);
    expect(accounting.content.tiers.validated).toBeLessThanOrEqual(accounting.content.tiers.available);
  });

  it.each(SEEDS)("seed %i: single-membership facets partition the items (member counts sum to itemCount)", (seed) => {
    const report = computeCoverage(snapshot(generate(seed).questions));
    for (const m of report.content.available) {
      if (!["difficulty_tier", "novelty", "time_demand", "concept"].includes(m.facet)) continue;
      expect(m.members.reduce((s, x) => s + x.count, 0) + m.unmapped.reduce((s, x) => s + x.count, 0)).toBe(m.itemCount);
    }
  });

  it.each(SEEDS)("seed %i: results are independent of input order (deterministic ordering)", (seed) => {
    const { questions, records } = generate(seed);
    const r = rng(seed * 7919);
    expect(computeCoverage(snapshot(shuffle(questions, r), shuffle(records, r)))).toEqual(computeCoverage(snapshot(questions, records)));
  });
});

describe("property: exam isolation", () => {
  it.each(SEEDS)("seed %i: another exam's questions and records never change this exam's coverage, selection or counts", (seed) => {
    const { questions, records } = generate(seed);
    const foreignQuestions = Array.from({ length: 10 }, (_, i) => view({ id: `jee-${seed}-${i}`, dna: { examCode: "JEE_MAIN" } }));
    const foreignRecords = [record(`jee-h-${seed}`, { examCode: "JEE_MAIN" })];
    const base = computeCoverage(snapshot(questions, records));
    const mixed = computeCoverage(snapshot([...questions, ...foreignQuestions], [...records, ...foreignRecords]));
    expect(mixed.content).toEqual(base.content);
    expect(mixed.historical).toEqual(base.historical);
    expect(mixed.accounting.content.excluded.excluded_cross_exam).toBe(base.accounting.content.excluded.excluded_cross_exam + 10);
    expect(selectQuestions(snapshot([...questions, ...foreignQuestions]), {}).candidates).toEqual(selectQuestions(snapshot(questions), {}).candidates);
  });
});

describe("property: selection is monotone and deterministic", () => {
  const CONSTRAINT_POOL: QuestionSelectionConstraints[] = [
    { concepts: ["Percentages"] },
    { patternFamilies: ["Reverse Percentage", "Successive Percentage Change"] },
    { novelty: ["standard", "novel_context"] },
    { difficultyTiers: ["standard", "advanced", "hard"] },
    { timeBands: ["up_to_45s", "46_to_90s", "91_to_150s"] },
    { expectedTimeSeconds: { max: 200 } },
    { trap: { any: true } },
    { testingModes: { mode: "any", values: ["direct", "reverse", "transformed"] } },
    { sourceTypes: ["original"] },
    { difficultyDimensions: { conceptualLoad: { min: 0, max: 1 } } },
    { states: ["published", "human_reviewed"] }
  ];
  it.each(SEEDS)("seed %i: adding a constraint never grows the result; the final set is the intersection of the parts", (seed) => {
    const r = rng(seed);
    const s = snapshot(generate(seed).questions);
    const chosen = shuffle(CONSTRAINT_POOL, r).slice(0, 1 + Math.floor(r() * 5));
    let acc: QuestionSelectionConstraints = { states: ["published", "human_reviewed", "ai_validated", "draft"] };
    let previous = selectQuestions(s, acc).candidates.map((c) => c.questionId);
    for (const c of chosen) {
      acc = { ...acc, ...c, states: c.states ?? acc.states };
      const next = selectQuestions(s, acc).candidates.map((x) => x.questionId);
      if (!c.states) for (const id of next) expect(previous).toContain(id); // monotone
      previous = next;
    }
    const final = selectQuestions(s, acc).candidates.map((c) => c.questionId);
    const alone = chosen.map((c) => new Set(selectQuestions(s, { states: acc.states, ...c, ...(c.states ? {} : {}) }).candidates.map((x) => x.questionId)));
    for (const id of final) for (const set of alone) if (!chosen.some((c) => c.states)) expect(set.has(id)).toBe(true);
  });
  it.each(SEEDS)("seed %i: results are ordered by id, trace counts are consistent, and no excluded question can ever be selected", (seed) => {
    const { questions } = generate(seed);
    const s = snapshot(questions);
    const result = selectQuestions(s, { states: ["published", "human_reviewed", "ai_validated", "draft", "rejected"] });
    const ids = result.candidates.map((c) => c.questionId);
    expect(ids).toEqual([...ids].sort());
    for (const step of result.trace) expect(step.after).toBeLessThanOrEqual(step.before);
    const bad = new Set(computeCoverage(s).dispositions.filter((d) => d.disposition !== "counted").map((d) => d.id));
    for (const id of ids) expect(bad.has(id)).toBe(false);
  });
});

describe("property: empty and sparse datasets are well-defined", () => {
  it("no data at all: every content metric is a measured 0 (or no_universe), every historical metric is insufficient_data, nothing throws", () => {
    const r = computeCoverage(snapshot([], []));
    for (const m of r.content.published) expect(["measured", "no_universe"]).toContain(m.state);
    for (const m of r.historical) expect(m.state).toBe("insufficient_data");
    expect(r.dispositions).toEqual([]);
  });
  it.each([1, 2, 3, 5])("%i question(s): never concentrated (below the provisional minimum), never an invented ratio", (n) => {
    const r = computeCoverage(snapshot(Array.from({ length: n }, () => view())));
    for (const m of r.content.published) {
      expect(m.concentrated).toBe(false);
      if (m.state === "measured") expect(m.ratio).toBe(m.numerator / m.denominator);
    }
  });
});
