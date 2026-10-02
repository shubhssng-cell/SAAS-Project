import { describe, expect, it } from "vitest";
import { computeCoverage, FACET_DEFINITIONS, FACETS, type CoverageMetric, type FacetName } from "../src/index.js";
import { fixtureRecord, pub, record, snapshot, view } from "./fixtures.js";

const published = (r: ReturnType<typeof computeCoverage>, f: FacetName): CoverageMetric => r.content.published.find((m) => m.facet === f)!;
const historical = (r: ReturnType<typeof computeCoverage>, f: FacetName): CoverageMetric => r.historical.find((m) => m.facet === f)!;

describe("every metric states its universe, observed set, denominator and numerator", () => {
  it("each facet has an explicit written definition", () => {
    for (const f of FACETS) {
      const d = FACET_DEFINITIONS[f].definition;
      for (const k of ["universe", "observed", "denominator", "numerator"] as const) expect(d[k].length, `${f}.${k}`).toBeGreaterThan(10);
    }
  });
  it("denominators are the MAPPED universe: pack concepts, mapped families, combinable pairs, declared modes and traps, fixed vocabularies", () => {
    const r = computeCoverage(snapshot());
    expect(published(r, "concept").denominator).toBe(12); // pack concepts
    expect(published(r, "pattern").denominator).toBe(4); // mapped pattern families
    expect(published(r, "combination").denominator).toBe(6); // commonly_combined / application / dependent useful pairs
    expect(published(r, "transformation").denominator).toBe(6); // distinct potential modes across families
    expect(published(r, "difficulty_tier").denominator).toBe(5);
    expect(published(r, "difficulty_dimension").denominator).toBe(18);
    expect(published(r, "novelty").denominator).toBe(4);
    expect(published(r, "trap").denominator).toBe(4);
    expect(published(r, "time_demand").denominator).toBe(4);
  });
  it("numerator/denominator is the ratio, and an empty content pool is a real measurement of 0 - not 'no data'", () => {
    const r = computeCoverage(snapshot());
    for (const m of r.content.published) {
      expect(m.state).toBe("measured");
      expect(m.numerator).toBe(0);
      expect(m.ratio).toBe(0);
      expect(m.itemCount).toBe(0);
      expect(m.emptyMembers.length).toBe(m.denominator);
    }
  });
  it("a metric with an empty universe has no ratio (never a made-up 0 or 100)", () => {
    const empty = snapshot([], [], { patternFamilies: [] });
    const m = published(computeCoverage(empty), "pattern");
    expect(m).toMatchObject({ state: "no_universe", denominator: 0, ratio: null });
    expect(published(computeCoverage(empty), "trap").state).toBe("no_universe");
  });
  it("there is no single overall coverage number anywhere in the report", () => {
    const text = JSON.stringify(computeCoverage(snapshot([pub()])));
    expect(text).not.toMatch(/overallCoverage|coverageScore|totalCoverage|coveragePercent|overall_/);
  });
});

describe("COVERAGE IS NOT QUESTION COUNT", () => {
  it("100 published questions of ONE pattern: 1 of 4 patterns covered, flagged concentrated", () => {
    const qs = Array.from({ length: 100 }, () => pub());
    const m = published(computeCoverage(snapshot(qs)), "pattern");
    expect(m.itemCount).toBe(100);
    expect(m.numerator).toBe(1);
    expect(m.denominator).toBe(4);
    expect(m.ratio).toBe(0.25);
    expect(m.topMember).toBe("Percentages / Reverse Percentage");
    expect(m.topMemberShare).toBe(1);
    expect(m.concentrated).toBe(true);
    expect(m.members.find((x) => x.member === "Percentages / Reverse Percentage")!.distinctStructures).toBe(1);
    expect(m.emptyMembers).toHaveLength(3);
  });
  it("100 questions over only 2 patterns covers 2 of 4, while 4 questions over 4 patterns covers 4 of 4", () => {
    const many = [...Array.from({ length: 60 }, () => pub()), ...Array.from({ length: 40 }, () => pub({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], trapErrorTaxonomyCode: "successive_change_error" }))];
    expect(published(computeCoverage(snapshot(many)), "pattern")).toMatchObject({ itemCount: 100, numerator: 2, denominator: 4 });
    const few = ["Reverse Percentage", "Successive Percentage Change", "Percentage Point vs Percentage Change", "Percentage Share in Data Interpretation"].map((name) => pub({ patternFamilyName: name, testingModes: ["direct"], combinesWithConcepts: [] }));
    const m = published(computeCoverage(snapshot(few)), "pattern");
    expect(m).toMatchObject({ itemCount: 4, numerator: 4, denominator: 4, ratio: 1 });
    expect(m.concentrated).toBe(false);
  });
  it("many STANDARD questions but almost nothing novel, reverse/transformed, hard or time-varied: the gaps are explicit", () => {
    const qs = Array.from({ length: 30 }, () => pub({ difficultyTier: "standard", noveltyLevel: "standard", testingModes: ["direct"], combinesWithConcepts: [], expectedTimeSeconds: 40 }));
    const r = computeCoverage(snapshot(qs));
    expect(published(r, "novelty")).toMatchObject({ numerator: 1, denominator: 4, concentrated: true });
    expect(published(r, "novelty").emptyMembers).toEqual(["novel_representation", "novel_combination", "novel_context"]);
    expect(published(r, "difficulty_tier").emptyMembers).toEqual(["advanced", "hard", "extreme", "novel"]);
    expect(published(r, "transformation").emptyMembers).toEqual(expect.arrayContaining(["reverse", "transformed", "combined"]));
    expect(published(r, "time_demand").emptyMembers).toEqual(["46_to_90s", "91_to_150s", "over_150s"]);
    expect(published(r, "combination").numerator).toBe(0);
    const universe = r.concepts.find((c) => c.conceptName === "Percentages")!;
    expect(universe.emptyRegions).toEqual(expect.arrayContaining([{ facet: "novelty", value: "novel_combination" }, { facet: "difficulty_tier", value: "hard" }]));
    expect(universe.patterns.find((p) => p.patternFamilyName === "Reverse Percentage")!.concentrated).toBe(true);
  });
  it("sparse regions are 'underrepresented', and the bound is the provisional shared constant", () => {
    const qs = [...Array.from({ length: 10 }, () => pub({ noveltyLevel: "standard" })), pub({ noveltyLevel: "novel_context" }, {})];
    const m = published(computeCoverage(snapshot(qs)), "novelty");
    expect(m.underrepresentedMembers).toEqual(["novel_context"]);
    expect(m.members.find((x) => x.member === "standard")!.status).toBe("represented");
  });
  it("count is not breadth: members report distinct structures beside their count", () => {
    const same = Array.from({ length: 5 }, () => pub());
    const varied = Array.from({ length: 5 }, (_, i) => pub({ difficultyTier: (["standard", "advanced", "hard", "extreme", "novel"] as const)[i]! }));
    const a = published(computeCoverage(snapshot(same)), "pattern").members.find((x) => x.count > 0)!;
    const b = published(computeCoverage(snapshot(varied)), "pattern").members.find((x) => x.count > 0)!;
    expect(a).toMatchObject({ count: 5, distinctStructures: 1 });
    expect(b).toMatchObject({ count: 5, distinctStructures: 5 });
  });
});

describe("the facets", () => {
  const qs = [
    pub({ conceptName: "Percentages", patternFamilyName: "Reverse Percentage", testingModes: ["reverse", "combined"], combinesWithConcepts: ["Ratio"], noveltyLevel: "standard", trapErrorTaxonomyCode: "base_confusion", expectedTimeSeconds: 40, difficultyTier: "advanced" }),
    pub({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], noveltyLevel: "novel_combination", trapErrorTaxonomyCode: "successive_change_error", expectedTimeSeconds: 120, difficultyTier: "hard" }),
    pub({ testingModes: ["transformed"], combinesWithConcepts: [], trapErrorTaxonomyCode: null, expectedTimeSeconds: 200 })
  ];
  const r = computeCoverage(snapshot(qs));
  it("concept", () => expect(published(r, "concept")).toMatchObject({ numerator: 1, denominator: 12 }));
  it("combination: only MAPPED pairs count; the rest is reported unmapped", () => {
    const m = published(r, "combination");
    expect(m.members.filter((x) => x.count > 0).map((x) => x.member).sort()).toEqual(["Percentages + Profit and Loss", "Percentages + Ratio"]);
    expect(m.numerator).toBe(2);
  });
  it("transformation: a mode used but not declared by any mapped family is unmapped, not counted", () => {
    const x = computeCoverage(snapshot([pub({ testingModes: ["time_pressured"], combinesWithConcepts: [] })]));
    const m = published(x, "transformation");
    expect(m.unmapped).toEqual([{ member: "time_pressured", count: 1 }]);
    expect(m.numerator).toBe(0);
  });
  it("trap: an item with no trap contributes to none; a trap is a question property", () => {
    expect(published(r, "trap")).toMatchObject({ numerator: 2, itemCount: 3 });
    expect(published(r, "trap").members.find((m) => m.member === "base_confusion")!.count).toBe(1);
  });
  it("time demand uses the provisional bands", () => {
    expect(published(r, "time_demand").members.map((m) => [m.member, m.count])).toEqual([["up_to_45s", 1], ["46_to_90s", 0], ["91_to_150s", 1], ["over_150s", 1]]);
  });
  it("difficulty dimensions are covered one by one (18 cells), never combined", () => {
    const m = published(r, "difficulty_dimension");
    expect(m.denominator).toBe(18);
    expect(m.members.every((c) => /^[a-zA-Z]+:(low|mid|high)$/.test(c.member))).toBe(true);
  });
  it("difficulty tier", () => expect(published(r, "difficulty_tier").members.filter((m) => m.count > 0).map((m) => m.member)).toEqual(["advanced", "hard"]));
});

describe("content tiers are separate and nested: available ⊇ validated ⊇ published", () => {
  const qs = [pub({}, { id: "p1" }), view({ id: "h1", validationState: "human_reviewed", dna: { patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], trapErrorTaxonomyCode: "successive_change_error" } }), view({ id: "d1", validationState: "draft", dna: { patternFamilyName: "Percentage Point vs Percentage Change", testingModes: ["contextualized"], combinesWithConcepts: [], trapErrorTaxonomyCode: "percentage_point_confusion" } })];
  const r = computeCoverage(snapshot(qs));
  it("pattern coverage differs by tier", () => {
    const n = (basis: "published" | "validated" | "available") => r.content[basis].find((m) => m.facet === "pattern")!.numerator;
    expect([n("published"), n("validated"), n("available")]).toEqual([1, 2, 3]);
  });
  it("each tier is labelled with its basis", () => {
    expect(r.content.published[0]!.basis).toBe("published_content");
    expect(r.content.validated[0]!.basis).toBe("validated_content");
    expect(r.content.available[0]!.basis).toBe("available_content");
    expect(r.historical[0]!.basis).toBe("historical_observed");
  });
  it("unpublished/unvalidated content is excluded from the PUBLISHED view but accounted for", () => {
    expect(r.accounting.content.tiers).toEqual({ available: 3, validated: 2, published: 1 });
  });
});

describe("data quality is visible in the report and in the audit trail", () => {
  it("excluded questions are not counted and each says why", () => {
    const s = snapshot([pub({}, { id: "ok" }), view({ id: "x", dna: { examCode: "JEE_MAIN" } }), view({ id: "f", isFixture: true }), view({ id: "r", validationState: "rejected" }), view({ id: "bad", dna: { conceptName: "Nope" } })]);
    const r = computeCoverage(s);
    expect(r.accounting.content).toMatchObject({ counted: 1, excluded: { excluded_cross_exam: 1, excluded_fixture: 1, excluded_rejected: 1, excluded_invalid_metadata: 1, excluded_duplicate: 0 } });
    expect(r.dispositions.map((d) => [d.id, d.disposition])).toEqual([["bad", "excluded_invalid_metadata"], ["f", "excluded_fixture"], ["ok", "counted"], ["r", "excluded_rejected"], ["x", "excluded_cross_exam"]]);
    expect(published(r, "concept").itemCount).toBe(1);
  });
  it("duplicates are collapsed before counting (one logical question = one item)", () => {
    const fp = "f".repeat(64);
    const r = computeCoverage(snapshot(Array.from({ length: 10 }, () => pub({}, { fingerprint: fp }))));
    expect(published(r, "pattern").itemCount).toBe(1);
    expect(r.accounting.content.excluded.excluded_duplicate).toBe(9);
  });
  it("a missing-metadata question changes no coverage number", () => {
    const good = [pub()];
    const withBad = [...good, view({ dna: { skill: "" } }), view({ dna: { patternFamilyName: "" } })];
    expect(computeCoverage(snapshot(withBad)).content.published).toEqual(computeCoverage(snapshot(good)).content.published);
  });
});

describe("HISTORICAL evidence is its own basis and is never mixed with content", () => {
  it("with no real historical record the state is insufficient_data, not zero coverage", () => {
    const r = computeCoverage(snapshot([pub()]));
    for (const m of r.historical) expect(m).toMatchObject({ state: "insufficient_data", ratio: null, itemCount: 0, basis: "historical_observed" });
    expect(r.accounting.historical).toEqual({ total: 0, counted: 0, excluded: { cross_exam: 0, fixture: 0, not_reviewed: 0, invalid_classification: 0 } });
  });
  it("published content does not make anything historically observed", () => {
    const r = computeCoverage(snapshot(Array.from({ length: 20 }, () => pub())));
    expect(historical(r, "concept").itemCount).toBe(0);
    expect(published(r, "concept").itemCount).toBe(20);
  });
  it("a historical record does not become content", () => {
    const r = computeCoverage(snapshot([], [record("h1")]));
    expect(published(r, "concept").itemCount).toBe(0);
    expect(historical(r, "concept")).toMatchObject({ itemCount: 1, numerator: 1, state: "measured" });
  });
  it("only REVIEWED, REAL-source records count: fixtures, candidates and raw imports are excluded and counted", () => {
    const records = [
      record("real"),
      fixtureRecord("fix"),
      record("cand", { annotationState: "candidate_annotation", review: null }),
      record("raw", { annotationState: "raw_imported", classification: null, authorship: null, review: null }),
      record("other", { examCode: "JEE_MAIN" })
    ];
    const r = computeCoverage(snapshot([], records));
    expect(r.accounting.historical).toEqual({ total: 5, counted: 1, excluded: { cross_exam: 1, fixture: 1, not_reviewed: 2, invalid_classification: 0 } });
    expect(historical(r, "concept").itemCount).toBe(1);
  });
  it("a reviewed record whose classification is invalid for this pack is excluded, not trusted", () => {
    const r = computeCoverage(snapshot([], [record("badc", { dna: { conceptName: "Nope" } })]));
    expect(r.accounting.historical.excluded.invalid_classification).toBe(1);
    expect(historical(r, "concept").state).toBe("insufficient_data");
  });
  it("historical coverage uses the SAME facet definitions and denominators as content", () => {
    const r = computeCoverage(snapshot([], [record("a"), record("b", { dna: { patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], trapErrorTaxonomyCode: "successive_change_error" } })]));
    expect(historical(r, "pattern")).toMatchObject({ numerator: 2, denominator: 4 });
    expect(historical(r, "pattern").definition).toEqual(published(r, "pattern").definition);
  });
  it("output reports occurrence only: no likelihood, probability, importance or future-paper wording anywhere", () => {
    const text = JSON.stringify(computeCoverage(snapshot([pub()], [record("a")]))).toLowerCase();
    for (const forbidden of ["likely", "likelihood", "probability that", "predict", "forecast", "will appear", "next exam", "expected to appear", "importance"]) expect(text, forbidden).not.toContain(forbidden);
  });
});

describe("audit trail: a number traces back to its questions", () => {
  it("every counted question has a disposition; every excluded one has reasons", () => {
    const s = snapshot([pub({}, { id: "a" }), view({ id: "b", dna: { conceptName: "Nope" } })]);
    const d = computeCoverage(s).dispositions;
    expect(d.find((x) => x.id === "a")!.reasons).toEqual([]);
    expect(d.find((x) => x.id === "b")!.reasons.length).toBeGreaterThan(0);
  });
});
