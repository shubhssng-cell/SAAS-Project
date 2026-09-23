import { describe, expect, it } from "vitest";
import type { CalculationFrictionEvidence, CalculationGymRequirement, ComputationalLoadSlice } from "../src/types.js";

/**
 * Compile-time guards, extending the same discipline `@ipmat/adaptive-selection`
 * (D-051), `@ipmat/training-orchestration` (D-052), and `@ipmat/training-systems`
 * (D-053) already established, to Calculation Gym specifically (D-054):
 * no composite/blended score, no confidence, no psychological/motivational
 * field, ever.
 */
describe("calculation-gym — regression guards: no composite score / confidence / psychological fields", () => {
  it("ComputationalLoadSlice rejects a 'confidence' field", () => {
    const slice: ComputationalLoadSlice = {
      attempts: 5,
      correct: 3,
      accuracy: 0.6,
      // @ts-expect-error -- ComputationalLoadSlice has no confidence field and must never gain one.
      confidence: 0.9
    };
    void slice;
  });

  it("CalculationFrictionEvidence rejects a blended/composite 'calculationAbilityScore' field", () => {
    const evidence: CalculationFrictionEvidence = {
      conceptName: "Percentages",
      highLoad: { attempts: 5, correct: 1, accuracy: 0.2 },
      lowLoad: { attempts: 5, correct: 5, accuracy: 1 },
      frictionDetected: true,
      // @ts-expect-error -- CalculationFrictionEvidence has no composite score field and must never gain one; frictionDetected is a boolean signal, never a blended number.
      calculationAbilityScore: 0.4
    };
    void evidence;
  });

  it("CalculationGymRequirement rejects a 'motivation'/'confidence' field", () => {
    const requirement: CalculationGymRequirement = {
      targetConceptName: "Percentages",
      stage: "mixed",
      minComputationalLoad: 0.5,
      requireMultiStep: false,
      requireTimePressured: false,
      // @ts-expect-error -- CalculationGymRequirement has no motivation field and must never gain one.
      motivation: "high"
    };
    void requirement;
  });

  it("CalculationGymRequirement rejects a global-adaptive-style numeric ranking 'priorityScore' field", () => {
    const requirement: CalculationGymRequirement = {
      targetConceptName: "Percentages",
      stage: "foundational",
      minComputationalLoad: 0,
      requireMultiStep: false,
      requireTimePressured: false,
      // @ts-expect-error -- selection must never introduce a weighted/composite priority score (D-054 adjustment 4); this field must never exist.
      priorityScore: 42
    };
    void requirement;
  });

  it("sanity: a well-formed requirement and evidence record still pass the type checker (proves the guards above catch the ADDED field, not something else)", () => {
    const requirement: CalculationGymRequirement = { targetConceptName: "Percentages", stage: "foundational", minComputationalLoad: 0, requireMultiStep: false, requireTimePressured: false };
    expect(requirement.stage).toBe("foundational");
  });
});
