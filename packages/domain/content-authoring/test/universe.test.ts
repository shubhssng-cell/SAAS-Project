import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import {
  buildConceptUniverse,
  buildExamQuestionUniverse,
  structuralSignature,
  TIME_DEMAND_BANDS,
  UNIVERSE_THRESHOLDS,
  type UniverseQuestionRef
} from "../src/index.js";
import { baseDna, otherExamPack } from "./fixtures.js";

let n = 0;
const ref = (over: Partial<ReturnType<typeof baseDna>> = {}, validationState: UniverseQuestionRef["validationState"] = "published", id?: string): UniverseQuestionRef => ({ id: id ?? `u-${++n}`, dna: baseDna(over), validationState });
const universe = (questions: UniverseQuestionRef[], conceptName = "Percentages", pack = ipmatIndoreExamPack) => buildConceptUniverse({ pack, patternFamilies: percentagesPatternFamilies, questions, conceptName });
const region = <T>(rows: Array<{ value: T; published: number; total: number; status: string }>, value: T) => rows.find((r) => r.value === value)!;

describe("Question Universe - concept -> patterns -> instances", () => {
  it("lists every MAPPED pattern family of the concept, including ones with no questions (zero rows are the point)", () => {
    const u = universe([ref()]);
    expect(u.patterns.map((p) => p.patternFamilyName)).toEqual(["Percentage Point vs Percentage Change", "Percentage Share in Data Interpretation", "Reverse Percentage", "Successive Percentage Change"]);
    expect(u.patterns.find((p) => p.patternFamilyName === "Reverse Percentage")!.published).toBe(1);
    expect(u.patterns.find((p) => p.patternFamilyName === "Successive Percentage Change")!.status).toBe("empty");
  });

  it("separates lifecycle: total counts every non-rejected instance, published counts only the trainable pool, rejected counts nowhere", () => {
    const u = universe([ref({}, "published"), ref({}, "ai_validated"), ref({}, "draft"), ref({}, "human_reviewed"), ref({}, "rejected")]);
    const p = u.patterns.find((x) => x.patternFamilyName === "Reverse Percentage")!;
    expect(p.total).toBe(4);
    expect(p.published).toBe(1);
    expect(u.totals).toMatchObject({ questions: 4, published: 1 });
  });
});

describe("PATTERN COVERAGE is not QUESTION COUNT", () => {
  const manySame = Array.from({ length: 100 }, () => ref());
  it("100 published questions of ONE structure span one signature and are flagged concentrated", () => {
    const p = universe(manySame).patterns.find((x) => x.patternFamilyName === "Reverse Percentage")!;
    expect(p.published).toBe(100);
    expect(p.distinctSignatures).toBe(1);
    expect(p.topSignatureShare).toBe(1);
    expect(p.concentrated).toBe(true);
    expect(universe(manySame).totals.distinctSignaturesPublished).toBe(1);
  });

  it("ten questions with ten different structures are broad, not concentrated", () => {
    const tiers = ["standard", "advanced", "hard", "extreme", "novel"] as const;
    const modes = [["reverse"], ["transformed"]] as const;
    const varied = tiers.flatMap((t) => modes.map((m) => ref({ difficultyTier: t, testingModes: [...m], combinesWithConcepts: [] })));
    const p = universe(varied).patterns.find((x) => x.patternFamilyName === "Reverse Percentage")!;
    expect(p.published).toBe(10);
    expect(p.distinctSignatures).toBe(10);
    expect(p.concentrated).toBe(false);
  });

  it("the narrow pool is invisible to a raw count but visible here: more questions, fewer structures", () => {
    const narrow = universe(manySame);
    const small = universe([ref({ testingModes: ["reverse"], combinesWithConcepts: [] }), ref({ testingModes: ["transformed"], combinesWithConcepts: [] }), ref({ difficultyTier: "hard", combinesWithConcepts: [] })]);
    expect(narrow.totals.published).toBeGreaterThan(small.totals.published);
    expect(narrow.totals.distinctSignaturesPublished).toBeLessThan(small.totals.distinctSignaturesPublished);
  });

  it("concentration needs BOTH enough instances and a dominant signature (provisional, centralized thresholds)", () => {
    const few = universe(Array.from({ length: UNIVERSE_THRESHOLDS.CONCENTRATION_MIN_PUBLISHED - 1 }, () => ref())).patterns.find((x) => x.patternFamilyName === "Reverse Percentage")!;
    expect(few.concentrated).toBe(false);
    const half = [...Array.from({ length: 5 }, () => ref()), ...Array.from({ length: 5 }, (_, i) => ref({ testingModes: ["transformed"], combinesWithConcepts: [], expectedTimeSeconds: 60 + i }))];
    expect(universe(half).patterns.find((x) => x.patternFamilyName === "Reverse Percentage")!.concentrated).toBe(false);
  });

  it("signature identity ignores order and wording-irrelevant fields but not structure", () => {
    expect(structuralSignature(baseDna({ testingModes: ["reverse", "combined"] }))).toBe(structuralSignature(baseDna({ testingModes: ["combined", "reverse"] })));
    expect(structuralSignature(baseDna({ expectedTimeSeconds: 10 }))).toBe(structuralSignature(baseDna({ expectedTimeSeconds: 500 })));
    expect(structuralSignature(baseDna({ noveltyLevel: "novel_context" }))).not.toBe(structuralSignature(baseDna()));
  });
});

describe("Question Universe - the other facets", () => {
  const set = [
    ref({ testingModes: ["reverse", "combined"], combinesWithConcepts: ["Ratio"], noveltyLevel: "standard", trapErrorTaxonomyCode: "base_confusion", expectedTimeSeconds: 40 }),
    ref({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], noveltyLevel: "novel_combination", trapErrorTaxonomyCode: "successive_change_error", difficultyTier: "hard", expectedTimeSeconds: 120 }),
    ref({ testingModes: ["transformed"], combinesWithConcepts: [], trapErrorTaxonomyCode: null, expectedTimeSeconds: 200 })
  ];
  const u = universe(set);

  it("combinations: mapped from the pack graph plus observed ones, with instance counts", () => {
    const names = u.combinations.map((c) => c.value.join("+"));
    expect(names).toContain("Percentages+Ratio");
    expect(names).toContain("Percentages+Profit and Loss");
    expect(u.combinations.find((c) => c.value.join("+") === "Percentages+Ratio")!.published).toBe(1);
    expect(u.combinations.find((c) => c.value.join("+") === "Discount+Percentages")).toBeDefined();
    expect(u.combinations.find((c) => c.value.join("+") === "Discount+Percentages")!.status).toBe("empty");
  });
  it("transformations cover the whole TestingMode vocabulary, so unused modes are visible as empty", () => {
    expect(u.transformations).toHaveLength(10);
    expect(region(u.transformations, "combined").published).toBe(2);
    expect(region(u.transformations, "constrained").status).toBe("empty");
  });
  it("novelty: all four levels are always present; absent ones are empty", () => {
    expect(u.noveltyLevels.map((r) => r.value)).toEqual(["standard", "novel_representation", "novel_combination", "novel_context"]);
    expect(region(u.noveltyLevels, "novel_combination").published).toBe(1);
    expect(region(u.noveltyLevels, "novel_context").status).toBe("empty");
  });
  it("difficulty tiers: all five are present", () => {
    expect(u.difficultyTiers.map((r) => r.value)).toEqual(["standard", "advanced", "hard", "extreme", "novel"]);
    expect(region(u.difficultyTiers, "hard").published).toBe(1);
    expect(region(u.difficultyTiers, "extreme").status).toBe("empty");
  });
  it("traps: the mapped traps of the concept's families plus any observed, with zero rows kept", () => {
    expect(u.traps.map((t) => t.value)).toEqual(["base_confusion", "misread_question", "percentage_point_confusion", "successive_change_error"]);
    expect(region(u.traps, "base_confusion").published).toBe(1);
    expect(region(u.traps, "misread_question").status).toBe("empty");
  });
  it("time demand: provisional bands that describe expected time only", () => {
    expect(u.timeDemand.map((b) => b.value)).toEqual(TIME_DEMAND_BANDS.map((b) => b.label));
    expect(region(u.timeDemand, "up_to_45s").published).toBe(1);
    expect(region(u.timeDemand, "91_to_150s").published).toBe(1);
    expect(region(u.timeDemand, "over_150s").published).toBe(1);
  });
  it("difficulty dimensions are reported one by one as low/mid/high published counts - there is no combined score", () => {
    expect(Object.keys(u.difficultyDimensions).sort()).toEqual(["computationalLoad", "conceptualLoad", "multiStepDepth", "representationNovelty", "timePressure", "trapDensity"]);
    for (const bins of Object.values(u.difficultyDimensions)) expect(bins.low + bins.mid + bins.high).toBe(3);
    expect(JSON.stringify(u)).not.toMatch(/overallDifficulty|difficultyScore|compositeScore/);
  });
  it("time demand is independent of difficulty: a slow easy question and a fast hard one are both representable", () => {
    const easy = { conceptualLoad: 0.1, computationalLoad: 0.1, trapDensity: 0.1, representationNovelty: 0.1, timePressure: 0.1, multiStepDepth: 0.1 };
    const hard = { conceptualLoad: 0.9, computationalLoad: 0.9, trapDensity: 0.9, representationNovelty: 0.9, timePressure: 0.9, multiStepDepth: 0.9 };
    const v = universe([ref({ difficultyDimensions: easy, expectedTimeSeconds: 300 }), ref({ difficultyDimensions: hard, expectedTimeSeconds: 20 })]);
    expect(region(v.timeDemand, "over_150s").published).toBe(1);
    expect(region(v.timeDemand, "up_to_45s").published).toBe(1);
    expect(v.difficultyDimensions.conceptualLoad).toEqual({ low: 1, mid: 0, high: 1 });
  });
});

describe("sparse and empty regions", () => {
  it("reports empty and underrepresented regions explicitly, using only 'mapped'/'represented' language", () => {
    const u = universe([ref(), ref(), ref({ testingModes: ["transformed"], combinesWithConcepts: [] })]);
    expect(u.emptyRegions).toContainEqual({ facet: "pattern", value: "Successive Percentage Change" });
    expect(u.emptyRegions).toContainEqual({ facet: "novelty", value: "novel_context" });
    expect(u.underrepresentedRegions).toContainEqual({ facet: "transformation", value: "transformed", published: 1 });
    expect(JSON.stringify(u).toLowerCase()).not.toMatch(/complete|exhaustive|every possible/);
  });
  it("a region becomes 'represented' only above the (provisional) underrepresented bound", () => {
    const k = UNIVERSE_THRESHOLDS.UNDERREPRESENTED_MAX_COUNT;
    const at = universe(Array.from({ length: k }, () => ref()));
    const above = universe(Array.from({ length: k + 1 }, () => ref()));
    expect(region(at.noveltyLevels, "standard").status).toBe("underrepresented");
    expect(region(above.noveltyLevels, "standard").status).toBe("represented");
  });
  it("an empty universe is entirely empty regions, not an error", () => {
    const u = universe([]);
    expect(u.totals).toEqual({ questions: 0, published: 0, distinctSignaturesPublished: 0 });
    expect(u.patterns.every((p) => p.status === "empty")).toBe(true);
  });
});

describe("determinism and cross-exam isolation", () => {
  it("is independent of question order", () => {
    const qs = Array.from({ length: 12 }, (_, i) => ref({ expectedTimeSeconds: 20 + i * 15, noveltyLevel: i % 2 ? "standard" : "novel_context" }));
    expect(universe([...qs].reverse())).toEqual(universe(qs));
  });
  it("only counts the pack's own exam: another exam's questions never appear, even for an identically named concept", () => {
    const foreign = ref({ examCode: "OTHER_EXAM" });
    const u = universe([foreign, ref()]);
    expect(u.totals.questions).toBe(1);
    const other = buildConceptUniverse({ pack: otherExamPack(), patternFamilies: [], questions: [foreign, ref()], conceptName: "Percentages" });
    expect(other.totals.questions).toBe(1);
    expect(other.examCode).toBe("OTHER_EXAM");
  });
  it("the exam-wide universe covers concepts that have mapped families or questions, sorted by key", () => {
    const all = buildExamQuestionUniverse(ipmatIndoreExamPack, percentagesPatternFamilies, [ref(), ref({ conceptName: "Ratio", chapterName: "Ratio and Proportion", patternFamilyName: "Reverse Percentage" })]);
    expect(all.map((c) => c.conceptName)).toEqual(["Percentages", "Ratio"]);
  });
});
