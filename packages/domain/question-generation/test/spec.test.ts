import { describe, expect, it } from "vitest";
import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies, percentagesTaxonomyCells } from "@ipmat/question-engine";
import { buildGenerationSpec, canonicalJson, planSpecsForUncoveredCells, specBody, specIdFor, validateGenerationSpec, type GenerationSpec } from "../src/index.js";
import { ERROR_TAXONOMY_CODES, EXAM, GOOD, advancedCell, hardCell, makeEnv, makeSpec, otherExamPack } from "./fixtures.js";

const ctx = { pack: ipmatIndoreExamPack, patternFamilies: percentagesPatternFamilies, errorTaxonomyCodes: ERROR_TAXONOMY_CODES };
const codes = (spec: GenerationSpec) => validateGenerationSpec(spec, ctx).map((i) => i.code);
/** Re-signs a modified spec so only the targeted rule can fire (a tampered body with a stale id is its own test). */
const resign = (spec: GenerationSpec, mutate: (s: GenerationSpec) => void): GenerationSpec => {
  const copy = structuredClone(spec);
  mutate(copy);
  const body = specBody(copy);
  return { ...copy, specId: specIdFor(body) };
};

describe("specification: complete, deterministic, exam-scoped", () => {
  it("a spec built from an existing taxonomy cell is valid and carries only existing DNA vocabulary", () => {
    const spec = makeSpec();
    expect(codes(spec)).toEqual([]);
    expect(spec.provenanceSourceType).toBe("original");
    expect(spec.blueprint.difficultyCalibrationStatus).toBe("provisional");
    expect(spec.specId).toMatch(/^spec_[0-9a-f]{24}$/);
    expect(codes(makeSpec(hardCell))).toEqual([]);
  });
  it("is deterministic: the same inputs give the same specId, whatever the key order or combination order", () => {
    const a = makeSpec();
    const b = makeSpec();
    expect(a.specId).toBe(b.specId);
    const shuffled = JSON.parse(JSON.stringify({ ...a, blueprint: Object.fromEntries(Object.entries(a.blueprint).reverse()) })) as GenerationSpec;
    const body = specBody(shuffled);
    expect(specIdFor(body)).toBe(a.specId);
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
    const multi = resign(makeSpec(), (s) => (s.blueprint.combinationConcepts = ["Ratio", "Algebra"]));
    const swapped = resign(multi, (s) => (s.blueprint.combinationConcepts = ["Algebra", "Ratio"]));
    expect(swapped.specId).toBe(multi.specId); // the combination is a SET
  });
  it.each([
    ["conceptName", (s: GenerationSpec) => (s.blueprint.conceptName = "Ratio")],
    ["patternFamilyName", (s: GenerationSpec) => (s.blueprint.patternFamilyName = "Successive Percentage Change")],
    ["difficultyTier", (s: GenerationSpec) => (s.blueprint.difficultyTier = "hard")],
    ["trapErrorTaxonomyCode", (s: GenerationSpec) => (s.blueprint.trapErrorTaxonomyCode = "sign_error")],
    ["testingModes", (s: GenerationSpec) => (s.blueprint.testingModes = ["transformed"])],
    ["noveltyLevel", (s: GenerationSpec) => (s.noveltyLevel = "novel_context")],
    ["examRelevance", (s: GenerationSpec) => (s.examRelevance = "stretch")],
    ["expectedTimeSeconds", (s: GenerationSpec) => (s.blueprint.expectedTimeSeconds = 91)]
  ])("changing %s changes the specId", (_n, mutate) => {
    expect(resign(makeSpec(), mutate).specId).not.toBe(makeSpec().specId);
  });
  it("a tampered spec (content changed, id not recomputed) is refused", () => {
    const spec = structuredClone(makeSpec());
    spec.blueprint.expectedTimeSeconds = 5;
    expect(codes(spec)).toContain("spec_id_mismatch");
  });
});

describe("specification: missing fields and invalid combinations", () => {
  it("rejects a malformed or empty spec without throwing", () => {
    expect(validateGenerationSpec({} as GenerationSpec, ctx).map((i) => i.code)).toEqual(["malformed_spec"]);
    expect(validateGenerationSpec(null as never, ctx).map((i) => i.code)).toEqual(["malformed_spec"]);
    const noConcept = resign(makeSpec(), (s) => delete (s.blueprint as Partial<typeof s.blueprint>).conceptName);
    expect(codes(noConcept).length).toBeGreaterThan(0);
  });
  it.each([
    ["concept/pattern mismatch", (s: GenerationSpec) => (s.blueprint.conceptName = "Ratio"), "concept_pattern_mismatch"],
    ["a trap outside the family's space", (s: GenerationSpec) => (s.blueprint.trapErrorTaxonomyCode = "percentage_point_confusion"), "trap_not_in_pattern_family"],
    ["a testing mode outside the family's space", (s: GenerationSpec) => (s.blueprint.testingModes = ["time_pressured"]), "testing_mode_not_in_pattern_family"],
    ["a combination outside the family's space", (s: GenerationSpec) => (s.blueprint.combinationConcepts = ["Geometry"]), "combination_not_in_pattern_family"],
    ["an unknown pattern family", (s: GenerationSpec) => (s.blueprint.patternFamilyName = "Made Up Family"), "unknown_pattern_family"],
    ["an unknown concept", (s: GenerationSpec) => (s.blueprint.conceptName = "Astrology"), "unknown_concept"],
    ["an unknown section", (s: GenerationSpec) => (s.blueprint.sectionName = "Verbal"), "unknown_section"],
    ["an unknown trap code", (s: GenerationSpec) => (s.blueprint.trapErrorTaxonomyCode = "made_up_trap"), "unknown_trap"],
    ["an invalid difficulty tier", (s: GenerationSpec) => ((s.blueprint as { difficultyTier: string }).difficultyTier = "impossible"), "invalid_difficulty"],
    ["an invalid novelty level", (s: GenerationSpec) => ((s as { noveltyLevel: string }).noveltyLevel = "brand_new"), "invalid_novelty"],
    ["an invalid exam relevance", (s: GenerationSpec) => ((s as { examRelevance: string }).examRelevance = "vital"), "invalid_exam_relevance"],
    ["an invalid answer format", (s: GenerationSpec) => ((s.blueprint as { answerFormat: string }).answerFormat = "essay"), "invalid_answer_format"],
    ["a non-positive expected time", (s: GenerationSpec) => (s.blueprint.expectedTimeSeconds = 0), "invalid_expected_time"],
    ["a claimed difficulty calibration", (s: GenerationSpec) => ((s.blueprint as { difficultyCalibrationStatus: string }).difficultyCalibrationStatus = "empirically_calibrated"), "calibration_claim_unsupported"],
    ["source-backed generation", (s: GenerationSpec) => ((s as { provenanceSourceType: string }).provenanceSourceType = "licensed"), "source_backed_generation_unsupported"],
    ["a control character in the transformation text", (s: GenerationSpec) => (s.blueprint.transformationDescription = "do this\u0007"), "invalid_transformation_text"],
    ["an over-long transformation text", (s: GenerationSpec) => (s.blueprint.transformationDescription = "x".repeat(301)), "invalid_transformation_text"]
  ])("rejects %s", (_n, mutate, code) => {
    expect(codes(resign(makeSpec(), mutate))).toContain(code);
  });
});

describe("specification: exam isolation and no model call for an invalid spec", () => {
  it("a spec for an exam with no pack, or checked against another exam's pack, is invalid and no model is called", async () => {
    const env = makeEnv([]);
    const unknown = resign(makeSpec(), (s) => (s.blueprint.examCode = "NO_SUCH_EXAM"));
    const r = await env.service.generateOne(unknown);
    expect(r.kind).toBe("spec_invalid");
    expect(r.reasons.map((x) => x.code)).toContain("unknown_exam");
    expect(env.provider.prompts).toHaveLength(0);
    expect(validateGenerationSpec(makeSpec(), { ...ctx, pack: otherExamPack() }).map((i) => i.code)).toContain("exam_mismatch");
  });
  it("a spec for the OTHER exam is validated against that exam's own pack: IPMAT's pattern families do not exist there", async () => {
    const env = makeEnv([]);
    const other = resign(makeSpec(), (s) => (s.blueprint.examCode = "OTHER_EXAM"));
    const r = await env.service.generateOne(other);
    expect(r.kind).toBe("spec_invalid");
    expect(env.provider.prompts).toHaveLength(0);
    expect(await env.repo.listIdentityRefs("OTHER_EXAM")).toEqual([]);
  });
  it("an invalid spec still yields a trace explaining why, and stores nothing", async () => {
    const env = makeEnv([]);
    const bad = resign(makeSpec(), (s) => (s.blueprint.conceptName = "Ratio"));
    const r = await env.service.generateOne(bad);
    expect(r.questionId).toBeNull();
    expect(r.trace.reasons.map((x) => x.code)).toContain("concept_pattern_mismatch");
    expect(env.traces.traces).toHaveLength(1);
    expect(await env.repo.listIdentityRefs(EXAM)).toEqual([]);
  });
});

describe("planning over the existing Question Universe coverage", () => {
  it("plans specs only for cells with NO question, deterministically ordered, and never invents a cell", () => {
    const covered = [{ patternFamilyName: advancedCell.patternFamilyName, validationState: "published" as const, combination: advancedCell.combination, testingMode: advancedCell.testingMode, trapErrorTaxonomyCode: advancedCell.trapErrorTaxonomyCode, difficultyTier: advancedCell.difficultyTier }];
    const plan = planSpecsForUncoveredCells({ cells: percentagesTaxonomyCells, families: percentagesPatternFamilies, existingQuestions: covered, build: { examCode: EXAM, sectionName: "Quant", chapterName: "Percentages", answerFormat: "multiple_choice" } });
    expect(plan.length).toBe(percentagesTaxonomyCells.filter((c) => c !== advancedCell).length);
    expect(plan.some((s) => s.blueprint.difficultyTier === advancedCell.difficultyTier && s.blueprint.patternFamilyName === advancedCell.patternFamilyName && s.blueprint.trapErrorTaxonomyCode === advancedCell.trapErrorTaxonomyCode && s.blueprint.testingModes[0] === advancedCell.testingMode && s.blueprint.combinationConcepts.join() === advancedCell.combination.join())).toBe(false);
    expect([...plan].sort((a, b) => (a.specId < b.specId ? -1 : 1))).toEqual(plan);
    for (const spec of plan) expect(codes(spec)).toEqual([]);
    const again = planSpecsForUncoveredCells({ cells: [...percentagesTaxonomyCells].reverse(), families: percentagesPatternFamilies, existingQuestions: covered, build: { examCode: EXAM, sectionName: "Quant", chapterName: "Percentages", answerFormat: "multiple_choice" } });
    expect(again.map((s) => s.blueprint.patternFamilyName + s.blueprint.difficultyTier).sort()).toEqual(plan.map((s) => s.blueprint.patternFamilyName + s.blueprint.difficultyTier).sort());
  });
  it("buildGenerationSpec defaults are the existing defaults (standard novelty) and GOOD() output matches a spec", () => {
    const spec = buildGenerationSpec(advancedCell, percentagesPatternFamilies.find((f) => f.name === advancedCell.patternFamilyName)!, { examCode: EXAM, sectionName: "Quant", chapterName: "Percentages", answerFormat: "multiple_choice", idSuffix: "x" });
    expect(spec.noveltyLevel).toBe("standard");
    expect(GOOD(makeSpec())).toHaveLength(3);
  });
});
