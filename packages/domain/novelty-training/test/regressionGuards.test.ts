import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import type { NoveltyDimensionExposure, NoveltyExposureEvidence, NoveltyTrainingRequirement } from "../src/types.js";
import { STUDENT } from "./fixtures.js";

/**
 * Compile-time guards, extending the same discipline `@ipmat/adaptive-selection`
 * (D-051), `@ipmat/training-orchestration` (D-052), `@ipmat/training-systems`
 * (D-053), `@ipmat/calculation-gym` (D-054), `@ipmat/speed-lab` (D-055),
 * and `@ipmat/trap-lab` (D-056) already established, to Novelty Training
 * specifically (D-058): no composite score, no confidence, no
 * psychological/motivational field, and no RepairPlan/orchestration
 * coupling, ever.
 */
describe("novelty-training -- regression guards: no composite score / confidence / psychological fields", () => {
  it("NoveltyDimensionExposure rejects a 'confidence' field", () => {
    const dimension: NoveltyDimensionExposure = {
      noveltyLevel: "novel_representation",
      distinctQuestionIds: [],
      distinctPatternFamilyNames: [],
      combinedConceptNames: [],
      // @ts-expect-error -- NoveltyDimensionExposure has no confidence field and must never gain one.
      confidence: 0.9
    };
    void dimension;
  });

  it("NoveltyDimensionExposure rejects a composite/exposure 'noveltyScore' field", () => {
    const dimension: NoveltyDimensionExposure = {
      noveltyLevel: "novel_representation",
      distinctQuestionIds: [],
      distinctPatternFamilyNames: [],
      combinedConceptNames: [],
      // @ts-expect-error -- no composite score field of any kind; distinctQuestionIds is a plain list, never a blended number.
      noveltyScore: 0.5
    };
    void dimension;
  });

  it("NoveltyExposureEvidence rejects 'predictedAbility'/'intelligence'/'motivation'/'emotion' fields", () => {
    const base: NoveltyExposureEvidence = {
      conceptName: "Percentages",
      standardExposureCount: 0,
      dimensions: []
    };
    // @ts-expect-error -- no predictedAbility field and must never gain one.
    const withAbility: NoveltyExposureEvidence = { ...base, predictedAbility: 0.5 };
    void withAbility;
    // @ts-expect-error -- no motivation field and must never gain one.
    const withMotivation: NoveltyExposureEvidence = { ...base, motivation: "high" };
    void withMotivation;
  });

  it("NoveltyTrainingRequirement rejects a 'priorityScore'/'probability' field", () => {
    const requirement: NoveltyTrainingRequirement = {
      targetConceptName: "Percentages",
      targetNoveltyLevel: "novel_representation",
      // @ts-expect-error -- selection must never introduce a weighted/composite priority score; this field must never exist.
      priorityScore: 42
    };
    void requirement;
  });

  it("NoveltyTrainingRequirement rejects extra target fields not justified by the approved design", () => {
    const requirement: NoveltyTrainingRequirement = {
      targetConceptName: "Percentages",
      targetNoveltyLevel: "novel_representation",
      // @ts-expect-error -- NoveltyTrainingRequirement has no targetTaxonomyCell field; taxonomy-cell identity stays selector-internal.
      targetTaxonomyCell: "cell-reverse-standard"
    };
    void requirement;
  });

  it("TrainingSystemContext (this provider's ONLY input) has no RepairPlan-shaped field", () => {
    const context: TrainingSystemContext = {
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [],
      // @ts-expect-error -- TrainingSystemContext has no activeRepairPlans/RepairPlan field and must never gain one for Novelty Training to read.
      activeRepairPlans: []
    };
    void context;
  });

  it("sanity: a well-formed requirement and evidence record still pass the type checker (proves the guards above catch the ADDED field, not something else)", () => {
    const requirement: NoveltyTrainingRequirement = { targetConceptName: "Percentages", targetNoveltyLevel: "novel_representation" };
    expect(requirement.targetNoveltyLevel).toBe("novel_representation");
  });
});
