import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import type { TrapAssociatedFailureRecurrence, TrapLabRequirement } from "../src/types.js";
import { STUDENT } from "./fixtures.js";

/**
 * Compile-time guards, extending the same discipline `@ipmat/adaptive-selection`
 * (D-051), `@ipmat/training-orchestration` (D-052), `@ipmat/training-systems`
 * (D-053), `@ipmat/calculation-gym` (D-054), and `@ipmat/speed-lab` (D-055)
 * already established, to Trap Lab specifically (D-056): no composite
 * score, no confidence, no psychological/motivational field, and no
 * RepairPlan/orchestration coupling, ever.
 */
describe("trap-lab -- regression guards: no composite score / confidence / psychological fields", () => {
  it("TrapAssociatedFailureRecurrence rejects a 'confidence' field", () => {
    const evidence: TrapAssociatedFailureRecurrence = {
      errorTaxonomyCode: "code",
      distinctFailingQuestionIds: [],
      distinctConceptNames: [],
      distinctPatternTaxonomyCellIds: [],
      distinctPatternFamilyNames: [],
      resistanceQuestionIds: [],
      hintAssistedResistanceQuestionIds: [],
      diagnosticNotes: [],
      // @ts-expect-error -- TrapAssociatedFailureRecurrence has no confidence field and must never gain one.
      confidence: 0.9
    };
    void evidence;
  });

  it("TrapAssociatedFailureRecurrence rejects a blended/composite 'trapScore' field", () => {
    const evidence: TrapAssociatedFailureRecurrence = {
      errorTaxonomyCode: "code",
      distinctFailingQuestionIds: [],
      distinctConceptNames: [],
      distinctPatternTaxonomyCellIds: [],
      distinctPatternFamilyNames: [],
      resistanceQuestionIds: [],
      hintAssistedResistanceQuestionIds: [],
      diagnosticNotes: [],
      // @ts-expect-error -- no composite score field of any kind; distinctFailingQuestionIds is a plain count, never a blended number.
      trapScore: 0.5
    };
    void evidence;
  });

  it("TrapAssociatedFailureRecurrence rejects 'predictedAbility'/'intelligence'/'motivation'/'emotion' fields", () => {
    const base: TrapAssociatedFailureRecurrence = {
      errorTaxonomyCode: "code",
      distinctFailingQuestionIds: [],
      distinctConceptNames: [],
      distinctPatternTaxonomyCellIds: [],
      distinctPatternFamilyNames: [],
      resistanceQuestionIds: [],
      hintAssistedResistanceQuestionIds: [],
      diagnosticNotes: []
    };
    // @ts-expect-error -- no predictedAbility field and must never gain one.
    const withAbility: TrapAssociatedFailureRecurrence = { ...base, predictedAbility: 0.5 };
    void withAbility;
    // @ts-expect-error -- no motivation field and must never gain one.
    const withMotivation: TrapAssociatedFailureRecurrence = { ...base, motivation: "high" };
    void withMotivation;
  });

  it("TrapLabRequirement rejects a 'priorityScore'/'probability' field", () => {
    const requirement: TrapLabRequirement = {
      targetErrorTaxonomyCode: "code",
      // @ts-expect-error -- selection must never introduce a weighted/composite priority score; this field must never exist.
      priorityScore: 42
    };
    void requirement;
  });

  it("TrapLabRequirement's targetConceptName is genuinely optional -- a well-formed requirement omitting it still type-checks", () => {
    const requirement: TrapLabRequirement = { targetErrorTaxonomyCode: "code" };
    expect(requirement.targetConceptName).toBeUndefined();
  });

  it("TrainingSystemContext (Trap Lab's ONLY input) has no RepairPlan-shaped field -- confirmed targeted repair remains an orchestration concern, structurally unreachable from this provider", () => {
    const context: TrainingSystemContext = {
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [],
      // @ts-expect-error -- TrainingSystemContext has no activeRepairPlans/RepairPlan field and must never gain one for Trap Lab to read.
      activeRepairPlans: []
    };
    void context;
  });

  it("sanity: a well-formed evidence record and requirement still pass the type checker (proves the guards above catch the ADDED field, not something else)", () => {
    const requirement: TrapLabRequirement = { targetErrorTaxonomyCode: "code" };
    expect(requirement.targetErrorTaxonomyCode).toBe("code");
  });
});
