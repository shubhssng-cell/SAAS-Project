import { describe, expect, it } from "vitest";
import {
  combinationsObserved,
  difficultyDimensionsObserved,
  noveltyLevelsObserved,
  patternsForConcept,
  recordsForPattern,
  selectRecords,
  sourceSupport,
  summarizeObservedTesting,
  transformationsObserved,
  trapsObserved,
  type HistoricalQuestionRecord
} from "../src/index.js";
import { baseClassification, fixtureRecord, realSourceRecord } from "./fixtures.js";

const all = { examCode: "IPMAT_INDORE", origins: ["fixture", "real_source"] } as const;

// Three reviewed fixtures + one candidate + one raw + one real-source reviewed.
const recs: HistoricalQuestionRecord[] = [
  fixtureRecord("a", { classification: baseClassification({ patternFamilyName: "Reverse Percentage", testingModes: ["reverse", "combined"], combinesWithConcepts: ["Ratio"], noveltyLevel: "standard", trapErrorTaxonomyCode: "base_confusion", expectedTimeSeconds: 90 }) }),
  fixtureRecord("b", { classification: baseClassification({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], noveltyLevel: "novel_combination", trapErrorTaxonomyCode: "successive_change_error", difficultyTier: "advanced", expectedTimeSeconds: 120 }) }),
  fixtureRecord("c", { classification: baseClassification({ patternFamilyName: "Reverse Percentage", testingModes: ["transformed"], combinesWithConcepts: [], trapErrorTaxonomyCode: null, expectedTimeSeconds: 60 }) }),
  fixtureRecord("d", { annotationState: "candidate_annotation", review: null, authorship: "ai_assisted", proposedBy: "classifier-v1", classification: baseClassification({ patternFamilyName: "Percentage Point vs Percentage Change", testingModes: ["direct"], combinesWithConcepts: [] }) }),
  fixtureRecord("e", { annotationState: "raw_imported", classification: null, authorship: null, review: null }),
  realSourceRecord("f", { classification: baseClassification({ patternFamilyName: "Reverse Percentage", testingModes: ["multi_step"], combinesWithConcepts: [] }) })
];

describe("deterministic querying", () => {
  it("defaults are conservative: only REVIEWED, REAL-SOURCE records count (fixtures, candidates and raw imports are excluded)", () => {
    expect(selectRecords(recs, { examCode: "IPMAT_INDORE" }).map((r) => r.id)).toEqual(["f"]);
  });

  it("opting in is explicit: states and origins are separate switches", () => {
    expect(selectRecords(recs, all).map((r) => r.id)).toEqual(["a", "b", "c", "f"]);
    expect(selectRecords(recs, { ...all, states: ["candidate_annotation"] }).map((r) => r.id)).toEqual(["d"]);
    expect(selectRecords(recs, { ...all, states: ["raw_imported"] }).map((r) => r.id)).toEqual(["e"]);
    expect(selectRecords(recs, { ...all, states: ["reviewed_validated", "candidate_annotation", "raw_imported"] }).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("unvalidated content is excluded from every facet query by default, and a raw import never contributes a facet even when opted in", () => {
    const optIn = { ...all, states: ["reviewed_validated", "candidate_annotation", "raw_imported"] } as const;
    expect(patternsForConcept(recs, optIn, "Percentages").reduce((n, p) => n + p.count, 0)).toBe(5); // a b c d f - e (raw) has no classification
    expect(patternsForConcept(recs, { examCode: "IPMAT_INDORE" }, "Percentages")).toEqual([{ value: "Reverse Percentage", count: 1 }]);
  });

  it("which patterns belong to a concept, with instance counts, sorted", () => {
    expect(patternsForConcept(recs, all, "Percentages")).toEqual([
      { value: "Reverse Percentage", count: 3 },
      { value: "Successive Percentage Change", count: 1 }
    ]);
    expect(patternsForConcept(recs, all, "Ratio")).toEqual([]);
  });

  it("which concept combinations have evidence (concept + partners, as a sorted set)", () => {
    expect(combinationsObserved(recs, all)).toEqual([
      { concepts: ["Percentages", "Profit and Loss"], count: 1 },
      { concepts: ["Percentages", "Ratio"], count: 1 }
    ]);
  });

  it("which transformations (testing modes) occur", () => {
    expect(transformationsObserved(recs, all)).toEqual([
      { value: "combined", count: 2 },
      { value: "multi_step", count: 1 },
      { value: "reverse", count: 1 },
      { value: "transformed", count: 1 }
    ]);
  });

  it("which novelty levels and traps exist for a concept", () => {
    expect(noveltyLevelsObserved(recs, all, "Percentages")).toEqual([
      { value: "novel_combination", count: 1 },
      { value: "standard", count: 3 }
    ]);
    expect(trapsObserved(recs, all)).toEqual([
      { value: "base_confusion", count: 2 },
      { value: "successive_change_error", count: 1 }
    ]);
  });

  it("difficulty dimensions are reported SEPARATELY as observed ranges and flagged provisional - there is no combined score", () => {
    const d = difficultyDimensionsObserved(recs, all);
    expect(d.calibration).toBe("provisional");
    expect(Object.keys(d.dimensions).sort()).toEqual(["computationalLoad", "conceptualLoad", "multiStepDepth", "representationNovelty", "timePressure", "trapDensity"]);
    expect(d.expectedTimeSeconds).toEqual({ min: 60, max: 120, count: 4 });
    expect(JSON.stringify(d)).not.toMatch(/overall|composite|totalScore|difficultyScore/);
  });

  it("which records (instances) map to a pattern (structure)", () => {
    expect(recordsForPattern(recs, all, "reverse percentage").map((r) => r.id)).toEqual(["a", "c", "f"]);
    expect(recordsForPattern(recs, all, "Reverse Percentage", "Ratio")).toEqual([]);
  });

  it("what source supports a classification (admin/internal)", () => {
    const s = sourceSupport(recs, "IPMAT_INDORE", "f")!;
    expect(s.source.sourceRef).toBe("source-doc-f");
    expect(s.dataOrigin).toBe("real_source");
    expect(s.review?.reviewedBy).toBe("fixture-reviewer");
    expect(sourceSupport(recs, "IPMAT_INDORE", "a")!.fixtureLabel).toMatch(/FIXTURE/);
    expect(sourceSupport(recs, "IPMAT_INDORE", "nope")).toBeNull();
  });

  it("results do not depend on input order", () => {
    const reversed = [...recs].reverse();
    expect(summarizeObservedTesting(reversed, all)).toEqual(summarizeObservedTesting(recs, all));
  });

  it("the summary carries every facet a later coverage engine needs, and only counts of what was observed", () => {
    const s = summarizeObservedTesting(recs, all);
    expect(Object.keys(s).sort()).toEqual(["combinations", "concepts", "difficulty", "difficultyTiers", "examCode", "noveltyLevels", "patterns", "recordCount", "transformations", "traps"]);
    expect(s.recordCount).toBe(4);
  });
});

describe("cross-exam isolation of queries", () => {
  const mixed: HistoricalQuestionRecord[] = [...recs, fixtureRecord("x", { examCode: "OTHER_EXAM", classification: { ...baseClassification(), examCode: "OTHER_EXAM" } })];

  it("a record of exam A never appears in exam B's intelligence, and vice versa", () => {
    expect(selectRecords(mixed, { examCode: "OTHER_EXAM", origins: ["fixture"] }).map((r) => r.id)).toEqual(["x"]);
    expect(selectRecords(mixed, { examCode: "IPMAT_INDORE", origins: ["fixture"] }).map((r) => r.id)).not.toContain("x");
    expect(patternsForConcept(mixed, { examCode: "OTHER_EXAM", origins: ["fixture"] }, "Percentages")).toEqual([{ value: "Reverse Percentage", count: 1 }]);
    expect(summarizeObservedTesting(mixed, { examCode: "IPMAT_INDORE", origins: ["fixture"] }).recordCount).toBe(3);
    expect(sourceSupport(mixed, "IPMAT_INDORE", "x")).toBeNull();
  });

  it("an unknown exam code yields empty answers, never another exam's data", () => {
    expect(selectRecords(mixed, { examCode: "NO_EXAM", origins: ["fixture", "real_source"] })).toEqual([]);
    expect(summarizeObservedTesting(mixed, { examCode: "NO_EXAM" }).recordCount).toBe(0);
  });
});
