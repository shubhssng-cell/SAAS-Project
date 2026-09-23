import { describe, expect, it } from "vitest";
import type { SpeedEvidenceSlice, SpeedLabRequirement } from "../src/types.js";

/**
 * Compile-time guards, extending the same discipline `@ipmat/adaptive-selection`
 * (D-051), `@ipmat/training-orchestration` (D-052), `@ipmat/training-systems`
 * (D-053), and `@ipmat/calculation-gym` (D-054) already established, to
 * Speed Lab specifically (D-055): no composite/blended score, no
 * confidence, no psychological/motivational field, ever.
 */
describe("speed-lab -- regression guards: no composite score / confidence / psychological fields", () => {
  it("SpeedEvidenceSlice rejects a 'confidence' field", () => {
    const evidence: SpeedEvidenceSlice = {
      eligibleGradedCount: 5,
      correctSlowCount: 3,
      incorrectSlowCount: 0,
      slowFraction: 0.6,
      // @ts-expect-error -- SpeedEvidenceSlice has no confidence field and must never gain one.
      confidence: 0.9
    };
    void evidence;
  });

  it("SpeedEvidenceSlice rejects a blended/composite 'speedAbilityScore' field", () => {
    const evidence: SpeedEvidenceSlice = {
      eligibleGradedCount: 5,
      correctSlowCount: 3,
      incorrectSlowCount: 0,
      slowFraction: 0.6,
      // @ts-expect-error -- SpeedEvidenceSlice has no composite score field and must never gain one; slowFraction is one directly-observed ratio, never a blended number.
      speedAbilityScore: 0.4
    };
    void evidence;
  });

  it("SpeedLabRequirement rejects a 'motivation'/'confidence' field", () => {
    const requirement: SpeedLabRequirement = {
      targetConceptName: "Percentages",
      stage: "mixed_pace",
      maxConceptualLoad: null,
      requireTimePressured: false,
      // @ts-expect-error -- SpeedLabRequirement has no motivation field and must never gain one.
      motivation: "high"
    };
    void requirement;
  });

  it("SpeedLabRequirement rejects a global-adaptive-style numeric ranking 'priorityScore' field", () => {
    const requirement: SpeedLabRequirement = {
      targetConceptName: "Percentages",
      stage: "steady_pace",
      maxConceptualLoad: 0.5,
      requireTimePressured: false,
      // @ts-expect-error -- selection must never introduce a weighted/composite priority score; this field must never exist.
      priorityScore: 42
    };
    void requirement;
  });

  it("SpeedLabRequirement rejects a caller-supplied 'targetSpeedRatio' field -- speed ratio is an attempt OUTCOME, never a static candidate-selection filter", () => {
    const requirement: SpeedLabRequirement = {
      targetConceptName: "Percentages",
      stage: "steady_pace",
      maxConceptualLoad: 0.5,
      requireTimePressured: false,
      // @ts-expect-error -- SpeedLabRequirement deliberately has no targetSpeedRatio field.
      targetSpeedRatio: 0.9
    };
    void requirement;
  });

  it("sanity: a well-formed requirement and evidence record still pass the type checker (proves the guards above catch the ADDED field, not something else)", () => {
    const requirement: SpeedLabRequirement = { targetConceptName: "Percentages", stage: "steady_pace", maxConceptualLoad: 0.5, requireTimePressured: false };
    expect(requirement.stage).toBe("steady_pace");
  });
});
