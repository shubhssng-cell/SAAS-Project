import { describe, expect, it } from "vitest";
import { evaluateCalculationGym } from "../src/applicability.js";
import type { CalculationGymRequirement } from "../src/types.js";
import { makeCandidate, makeGradedBatch, STUDENT } from "./fixtures.js";

function asCalculationGymRequirement(requirement: unknown): CalculationGymRequirement {
  return requirement as CalculationGymRequirement;
}

describe("evaluateCalculationGym", () => {
  it("not_applicable: insufficient_evidence when no concept in the pool has both slices sufficiently observed", () => {
    const outcome = evaluateCalculationGym({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: makeGradedBatch(2, 0, { computationalLoad: 0.9 }),
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });

    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("not_applicable: no_calculation_friction_detected when evidence is sufficient but shows no meaningful gap", () => {
    const outcome = evaluateCalculationGym({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [...makeGradedBatch(5, 5, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })],
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });

    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("no_calculation_friction_detected");
  });

  it("applicable: targets the concept with the LARGEST accuracy gap when multiple concepts show friction", () => {
    const attemptRecords = [
      ...makeGradedBatch(5, 4, { conceptName: "Percentages", computationalLoad: 0.9 }),
      ...makeGradedBatch(5, 5, { conceptName: "Percentages", computationalLoad: 0.1 }), // gap 0.2
      ...makeGradedBatch(5, 0, { conceptName: "Ratio", computationalLoad: 0.9 }),
      ...makeGradedBatch(5, 5, { conceptName: "Ratio", computationalLoad: 0.1 }) // gap 1.0
    ];
    const outcome = evaluateCalculationGym({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords,
      candidates: [makeCandidate({ conceptName: "Percentages" }), makeCandidate({ conceptName: "Ratio" })]
    });

    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asCalculationGymRequirement(outcome.requirement).targetConceptName).toBe("Ratio");
  });

  it("applicable: deterministic tie-break by concept name when gaps are equal", () => {
    const attemptRecords = [
      ...makeGradedBatch(5, 3, { conceptName: "Zebra", computationalLoad: 0.9 }),
      ...makeGradedBatch(5, 5, { conceptName: "Zebra", computationalLoad: 0.1 }),
      ...makeGradedBatch(5, 3, { conceptName: "Alpha", computationalLoad: 0.9 }),
      ...makeGradedBatch(5, 5, { conceptName: "Alpha", computationalLoad: 0.1 })
    ];
    const outcome = evaluateCalculationGym({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords,
      candidates: [makeCandidate({ conceptName: "Zebra" }), makeCandidate({ conceptName: "Alpha" })]
    });

    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asCalculationGymRequirement(outcome.requirement).targetConceptName).toBe("Alpha");
  });

  it("applicable: requirement carries the stage recommended by progression evidence, not a fixed default", () => {
    const attemptRecords = [
      ...makeGradedBatch(20, 20, { conceptName: "Percentages", computationalLoad: 0.1 }), // mastered foundational
      ...makeGradedBatch(5, 1, { conceptName: "Percentages", computationalLoad: 0.9 }) // friction + insufficient mixed mastery
    ];
    const outcome = evaluateCalculationGym({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords,
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });

    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) {
      const requirement = asCalculationGymRequirement(outcome.requirement);
      expect(requirement.stage).toBe("mixed");
      expect(requirement.minComputationalLoad).toBeGreaterThan(0);
    }
  });

  it("explanation/notes text never claims a measured 'calculation ability' -- only observed performance conditioned on provisional metadata", () => {
    const attemptRecords = [...makeGradedBatch(5, 1, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })];
    const outcome = evaluateCalculationGym({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords,
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });

    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) {
      expect(outcome.explanation.toLowerCase()).not.toContain("calculation ability");
      expect(outcome.explanation.toLowerCase()).toContain("provisional");
    }
  });
});
