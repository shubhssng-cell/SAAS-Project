import { computeContentFingerprint } from "@ipmat/content-authoring";
import { describe, expect, it } from "vitest";
import { assessQuestions, qualifiedQuestions, summarizeAssessments, tierOf } from "../src/index.js";
import { baseDna, pub, snapshot, view } from "./fixtures.js";

const disposition = (s: ReturnType<typeof snapshot>, id: string, options = {}) => assessQuestions(s, options).find((a) => a.id === id)!;

describe("every question gets exactly one disposition, with reasons", () => {
  it("a clean question is counted at its lifecycle tier", () => {
    const q = pub({}, { id: "ok" });
    expect(disposition(snapshot([q]), "ok")).toMatchObject({ disposition: "counted", reasons: [], tier: "published" });
  });
  it("tiers nest: published ⊂ validated ⊂ available", () => {
    const qs = [pub({}, { id: "p" }), view({ id: "h", validationState: "human_reviewed" }), view({ id: "a", validationState: "ai_validated" }), view({ id: "d", validationState: "draft" })];
    const s = snapshot(qs);
    const a = assessQuestions(s);
    const ids = (basis: "available" | "validated" | "published") => qualifiedQuestions(s, a, basis).map((q) => q.view.id).sort();
    expect(ids("published")).toEqual(["p"]);
    expect(ids("validated")).toEqual(["a", "h", "p"]);
    expect(ids("available")).toEqual(["a", "d", "h", "p"]);
    expect(tierOf({ validationState: "draft" })).toBe("available");
  });
  it("a rejected question is never content", () => {
    expect(disposition(snapshot([view({ id: "r", validationState: "rejected" })]), "r").disposition).toBe("excluded_rejected");
  });
  it("another exam's question is excluded as cross-exam, never counted", () => {
    expect(disposition(snapshot([view({ id: "x", dna: { examCode: "JEE_MAIN" } })]), "x")).toMatchObject({ disposition: "excluded_cross_exam", tier: null });
  });
  it("synthetic fixtures are excluded unless explicitly included", () => {
    const s = snapshot([view({ id: "f", isFixture: true })]);
    expect(disposition(s, "f").disposition).toBe("excluded_fixture");
    expect(disposition(s, "f", { includeFixtures: true }).disposition).toBe("counted");
  });
});

describe("invalid, missing and contradictory metadata is excluded with the reason - no default is invented", () => {
  const cases: Array<[string, Partial<ReturnType<typeof baseDna>>, string]> = [
    ["unknown concept", { conceptName: "Nope" }, "unknown_concept"],
    ["unknown pattern family", { patternFamilyName: "Nope" }, "unknown_pattern_family"],
    ["unknown trap", { trapErrorTaxonomyCode: "made_up" }, "unknown_trap"],
    ["invalid expected time", { expectedTimeSeconds: 0 }, "invalid_expected_time"],
    ["missing testing modes", { testingModes: [] }, "invalid_testing_modes"],
    ["out-of-range difficulty dimension", { difficultyDimensions: { conceptualLoad: 3, computationalLoad: 0.1, trapDensity: 0.1, representationNovelty: 0.1, timePressure: 0.1, multiStepDepth: 0.1 } }, "invalid_difficulty"],
    ["unknown novelty", { noveltyLevel: "alien" as never }, "invalid_novelty"],
    ["contradictory: concept combined with itself", { combinesWithConcepts: ["Percentages"] }, "contradictory_metadata"],
    ["contradictory: 'combined' mode without partners", { testingModes: ["combined"], combinesWithConcepts: [] }, "contradictory_metadata"],
    ["missing skill", { skill: " " }, "missing_metadata"]
  ];
  it.each(cases)("%s", (_name, dna, code) => {
    const a = disposition(snapshot([view({ id: "bad", dna })]), "bad");
    expect(a.disposition).toBe("excluded_invalid_metadata");
    expect(a.reasons).toContain(code);
  });
  it("a malformed DNA object is excluded, not thrown", () => {
    const broken = { ...view({ id: "m" }), dna: { ...baseDna(), difficultyDimensions: undefined, testingModes: undefined } } as never;
    expect(disposition(snapshot([broken]), "m").disposition).toBe("excluded_invalid_metadata");
  });
  it("the data-quality worklist counts invalid questions by code", () => {
    const s = snapshot([view({ id: "a", dna: { conceptName: "Nope" } }), view({ id: "b", dna: { conceptName: "Nope2" } }), view({ id: "c", dna: { expectedTimeSeconds: 0 } })]);
    const sum = summarizeAssessments(s, assessQuestions(s));
    expect(sum.excluded.excluded_invalid_metadata).toBe(3);
    expect(sum.invalidMetadataCodes).toEqual([{ code: "invalid_expected_time", count: 1 }, { code: "unknown_concept", count: 2 }, { code: "unknown_pattern_family", count: 2 }]);
  });
});

describe("duplicates are counted once", () => {
  const fp = (s: string) => computeContentFingerprint("IPMAT_INDORE", s, []);
  it("the same logical question (same fingerprint) is counted once; the highest tier wins, then the lowest id", () => {
    const s = snapshot([view({ id: "b", fingerprint: fp("same"), validationState: "ai_validated" }), view({ id: "a", fingerprint: fp("same"), validationState: "published" }), view({ id: "c", fingerprint: fp("same"), validationState: "published" })]);
    const byId = Object.fromEntries(assessQuestions(s).map((x) => [x.id, x]));
    expect(byId.a!.disposition).toBe("counted");
    expect(byId.b).toMatchObject({ disposition: "excluded_duplicate", reasons: ["duplicate of a"] });
    expect(byId.c!.disposition).toBe("excluded_duplicate");
  });
  it("100 copies of one question count as ONE", () => {
    const s = snapshot(Array.from({ length: 100 }, (_, i) => view({ id: `d${String(i).padStart(3, "0")}`, fingerprint: fp("one question") })));
    expect(summarizeAssessments(s, assessQuestions(s)).counted).toBe(1);
  });
  it("different fingerprints are different questions; a null fingerprint cannot be checked and is reported as such", () => {
    const s = snapshot([view({ id: "a", fingerprint: fp("x") }), view({ id: "b", fingerprint: fp("y") }), view({ id: "n1", fingerprint: null }), view({ id: "n2", fingerprint: null })]);
    const sum = summarizeAssessments(s, assessQuestions(s));
    expect(sum.counted).toBe(4);
    expect(sum.duplicateCheckUnavailable).toBe(2);
  });
  it("an invalid question never shadows a valid duplicate", () => {
    const s = snapshot([view({ id: "a", fingerprint: fp("z"), dna: { conceptName: "Nope" } }), view({ id: "b", fingerprint: fp("z") })]);
    const byId = Object.fromEntries(assessQuestions(s).map((x) => [x.id, x]));
    expect(byId.a!.disposition).toBe("excluded_invalid_metadata");
    expect(byId.b!.disposition).toBe("counted");
  });
});

describe("determinism", () => {
  it("assessments do not depend on input order", () => {
    const qs = [view({ id: "c" }), view({ id: "a", validationState: "draft" }), view({ id: "b", dna: { conceptName: "Nope" } })];
    expect(assessQuestions(snapshot([...qs].reverse()))).toEqual(assessQuestions(snapshot(qs)));
  });
  it("summary totals add up", () => {
    const s = snapshot([view({ id: "a" }), view({ id: "b", validationState: "rejected" }), view({ id: "c", isFixture: true }), view({ id: "d", dna: { examCode: "X" } })]);
    const sum = summarizeAssessments(s, assessQuestions(s));
    expect(sum.total).toBe(4);
    expect(sum.counted + Object.values(sum.excluded).reduce((a, b) => a + b, 0)).toBe(4);
  });
});
