import { describe, expect, it } from "vitest";
import { ExamIntelligenceError, ExamIntelligenceQueries } from "../src/index.js";
import { fixtureRecord, pub, record, snapshot, view } from "./fixtures.js";

const content = [
  pub({ patternFamilyName: "Reverse Percentage", testingModes: ["reverse", "combined"], combinesWithConcepts: ["Ratio"], noveltyLevel: "standard", trapErrorTaxonomyCode: "base_confusion", expectedTimeSeconds: 40, difficultyTier: "advanced" }, { id: "p1", sourceType: "original" }),
  pub({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], noveltyLevel: "novel_combination", trapErrorTaxonomyCode: "successive_change_error", expectedTimeSeconds: 120, difficultyTier: "hard" }, { id: "p2", sourceType: "licensed" }),
  view({ id: "v1", validationState: "human_reviewed" }),
  view({ id: "d1", validationState: "draft" }),
  view({ id: "fx", isFixture: true })
];
const history = [record("h1"), record("h2", { dna: { patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], trapErrorTaxonomyCode: "successive_change_error" } }), fixtureRecord("hf"), record("hc", { annotationState: "candidate_annotation", review: null })];
const q = new ExamIntelligenceQueries(snapshot(content, history));

describe("exam model queries", () => {
  it("sections and their chapters in declared order", () => {
    const [quant] = q.sections();
    expect(quant).toMatchObject({ key: "quant", name: "Quant", order: 1 });
    expect(quant!.chapters).toHaveLength(15);
    expect(quant!.chapters.map((c) => c.order)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it("concepts with their chapter and section, sorted by key", () => {
    const concepts = q.concepts();
    expect(concepts).toHaveLength(12);
    expect(concepts.map((c) => c.key)).toEqual([...concepts.map((c) => c.key)].sort());
    expect(concepts.find((c) => c.name === "Discount")).toMatchObject({ chapterName: "Percentages", sectionName: "Quant" });
  });
  it("prerequisites: direct, and transitive with distances", () => {
    expect(q.prerequisites("Percentages")).toEqual(["ratio"]);
    expect(q.prerequisites("percentages")).toEqual(["ratio"]);
    expect(q.prerequisites("Percentages", { transitive: true })).toEqual([{ key: "ratio", distance: 1 }]);
  });
  it("relationships carry their type and the pack's own provenance (a relation is only as strong as its review)", () => {
    const rels = q.relationships("Percentages");
    expect(rels.length).toBeGreaterThan(5);
    expect(rels.every((r) => r.provenanceKind === "authored" && r.reviewState === "unvalidated")).toBe(true);
    expect(rels.map((r) => r.type)).toEqual(expect.arrayContaining(["prerequisite", "foundational", "application", "commonly_combined"]));
  });
  it("an unknown concept is a typed error, not an empty answer", () => {
    expect(() => q.prerequisites("Nope")).toThrow(ExamIntelligenceError);
    expect(() => q.patterns("Nope")).toThrow(ExamIntelligenceError);
    expect(() => q.availability("Nope")).toThrow(ExamIntelligenceError);
    expect(() => q.historicalEvidence("Nope")).toThrow(ExamIntelligenceError);
  });
});

describe("per-concept content facets (scoped universes)", () => {
  it("patterns: the concept's mapped families only, with published counts", () => {
    const m = q.patterns("Percentages");
    expect(m.denominator).toBe(4);
    expect(m.members.map((x) => [x.member, x.count])).toEqual([["Percentages / Percentage Point vs Percentage Change", 0], ["Percentages / Percentage Share in Data Interpretation", 0], ["Percentages / Reverse Percentage", 1], ["Percentages / Successive Percentage Change", 1]]);
    expect(q.patterns("Ratio").denominator).toBe(0);
    expect(q.patterns("Ratio").state).toBe("no_universe");
  });
  it("combinations: mapped pairs that include the concept", () => {
    const m = q.combinations("Percentages");
    expect(m.members.every((x) => x.member.split(" + ").includes("Percentages"))).toBe(true);
    expect(m.members.filter((x) => x.count > 0).map((x) => x.member).sort()).toEqual(["Percentages + Profit and Loss", "Percentages + Ratio"]);
  });
  it("transformations, novelty, traps, time demand, difficulty", () => {
    expect(q.transformations("Percentages").members.filter((x) => x.count > 0).map((x) => x.member).sort()).toEqual(["combined", "reverse"]);
    expect(q.novelty("Percentages").members.filter((x) => x.count > 0).map((x) => x.member)).toEqual(["standard", "novel_combination"]);
    expect(q.traps("Percentages").members.filter((x) => x.count > 0).map((x) => x.member).sort()).toEqual(["base_confusion", "successive_change_error"]);
    expect(q.timeDemand("Percentages").members.filter((x) => x.count > 0).map((x) => x.member)).toEqual(["up_to_45s", "91_to_150s"]);
    expect(q.difficultyTiers("Percentages").members.filter((x) => x.count > 0).map((x) => x.member)).toEqual(["advanced", "hard"]);
    expect(q.difficultyDimensions("Percentages").denominator).toBe(18);
  });
  it("the content tier is selectable and nests", () => {
    expect(q.patterns("Percentages", "published").itemCount).toBe(2);
    expect(q.patterns("Percentages", "validated").itemCount).toBe(3);
    expect(q.patterns("Percentages", "available").itemCount).toBe(4);
  });
  it("fixtures and invalid questions never contribute", () => {
    expect(q.availability("Percentages").available).toBe(4); // p1 p2 v1 d1; the fixture is excluded
  });
});

describe("historical evidence: occurrence only, with sources", () => {
  it("returns reviewed real-source records with their source references and locator; fixtures and candidates are not evidence", () => {
    const ev = q.historicalEvidence("Percentages");
    expect(ev.map((e) => e.recordId)).toEqual(["h1", "h2"]);
    expect(ev[0]).toMatchObject({ sourceType: "licensed", sourceRef: "source-doc-h1", reviewedBy: "fixture-reviewer" });
  });
  it("historical facets use the same scoped definitions; with none the state is insufficient_data, not zero", () => {
    expect(q.historicalFacet("Percentages", "pattern")).toMatchObject({ basis: "historical_observed", state: "measured", numerator: 2, denominator: 4 });
    const none = new ExamIntelligenceQueries(snapshot(content, []));
    expect(none.historicalFacet("Percentages", "pattern")).toMatchObject({ state: "insufficient_data", ratio: null });
    expect(none.historicalEvidence("Percentages")).toEqual([]);
  });
  it("a concept with history can be queried while content stays separate", () => {
    const onlyHistory = new ExamIntelligenceQueries(snapshot([], [record("h1")]));
    expect(onlyHistory.patterns("Percentages").itemCount).toBe(0);
    expect(onlyHistory.historicalFacet("Percentages", "pattern").itemCount).toBe(1);
  });
});

describe("availability and provenance constraints", () => {
  it("availability by tier, overall and per concept", () => {
    expect(q.availability()).toEqual({ conceptName: null, available: 4, validated: 3, published: 2 });
    expect(q.availability("percentages")).toEqual({ conceptName: "Percentages", available: 4, validated: 3, published: 2 });
    expect(q.availability("Ratio")).toEqual({ conceptName: "Ratio", available: 0, validated: 0, published: 0 });
  });
  it("provenance KINDS only (never references or licenses), by tier", () => {
    const kinds = q.provenanceConstraints();
    expect(kinds.find((k) => k.sourceType === "original")).toMatchObject({ published: 1 });
    expect(kinds.find((k) => k.sourceType === "licensed")).toMatchObject({ published: 1 });
    expect(JSON.stringify(kinds)).not.toMatch(/sourceRef|licenseRef|license-ref/);
  });
  it("explains a metric member: which questions it counts, with state and facts", () => {
    expect(q.explainContentMember("pattern", "Percentages / Reverse Percentage")).toEqual([{ questionId: "p1", validationState: "published", conceptName: "Percentages", patternFamilyName: "Reverse Percentage" }]);
    expect(q.explainContentMember("novelty", "novel_combination")).toHaveLength(1);
    expect(q.explainContentMember("novelty", "novel_context")).toEqual([]);
  });
});

describe("determinism and scope", () => {
  it("answers do not depend on input order", () => {
    const a = new ExamIntelligenceQueries(snapshot([...content].reverse(), [...history].reverse()));
    expect(a.patterns("Percentages")).toEqual(q.patterns("Percentages"));
    expect(a.historicalEvidence("Percentages")).toEqual(q.historicalEvidence("Percentages"));
    expect(a.availability()).toEqual(q.availability());
  });
  it("another exam's questions and records never appear", () => {
    const mixed = new ExamIntelligenceQueries(snapshot([...content, view({ id: "jee", dna: { examCode: "JEE_MAIN" } })], [...history, record("jee-h", { examCode: "JEE_MAIN" })]));
    expect(mixed.availability()).toEqual(q.availability());
    expect(mixed.historicalEvidence("Percentages").map((e) => e.recordId)).toEqual(["h1", "h2"]);
    expect(mixed.examCode).toBe("IPMAT_INDORE");
  });
});
