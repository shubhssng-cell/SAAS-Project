import { describe, expect, it } from "vitest";
import { evaluateSpeedLab } from "../src/applicability.js";
import type { SpeedLabRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, makeFastCorrectBatch, makeSlowCorrectBatch, STUDENT } from "./fixtures.js";

function asSpeedLabRequirement(requirement: unknown): SpeedLabRequirement {
  return requirement as SpeedLabRequirement;
}

describe("evaluateSpeedLab", () => {
  it("not_applicable: insufficient_evidence when no concept in the pool has enough eligible attempts", () => {
    const outcome = evaluateSpeedLab({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: makeSlowCorrectBatch(2),
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("not_applicable: no_speed_inefficiency_detected when evidence is sufficient but the student is fast", () => {
    const outcome = evaluateSpeedLab({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: makeFastCorrectBatch(5),
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("no_speed_inefficiency_detected");
  });

  it("applicable when repeated correct-and-slow evidence exists", () => {
    const outcome = evaluateSpeedLab({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: makeSlowCorrectBatch(5),
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asSpeedLabRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
  });

  it("a purely calculation-friction pattern (high conceptualLoad excluded from evidence, only fast attempts eligible) does not trigger Speed Lab", () => {
    // Simulate a Calculation-Gym-shaped student: struggles on high computationalLoad but the ELIGIBLE (low-conceptualLoad) attempts are all fast.
    const attemptRecords = [
      ...makeFastCorrectBatch(5, { conceptualLoad: 0.1 }),
      makeAttemptRecord({ isCorrect: false, conceptualLoad: 0.1, timeTakenSeconds: 40, expectedTimeSeconds: 90 })
    ];
    const outcome = evaluateSpeedLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [makeCandidate({ conceptName: "Percentages" })] });
    expect(outcome.applicable).toBe(false);
  });

  it("deterministic tie-break: targets the concept with the LARGEST slow fraction when multiple concepts qualify", () => {
    const attemptRecords = [
      ...makeSlowCorrectBatch(3, { conceptName: "Percentages" }),
      ...makeFastCorrectBatch(2, { conceptName: "Percentages" }), // fraction 3/5 = 0.6
      ...makeSlowCorrectBatch(5, { conceptName: "Ratio" }) // fraction 5/5 = 1.0
    ];
    const outcome = evaluateSpeedLab({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords,
      candidates: [makeCandidate({ conceptName: "Percentages" }), makeCandidate({ conceptName: "Ratio" })]
    });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asSpeedLabRequirement(outcome.requirement).targetConceptName).toBe("Ratio");
  });

  it("explanation/notes text never claims a measured 'speed ability' -- only observed timing relative to expected time", () => {
    const outcome = evaluateSpeedLab({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: makeSlowCorrectBatch(5),
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) {
      expect(outcome.explanation.toLowerCase()).not.toContain("speed ability");
    }
  });

  it("time_constrained stage requirement uses requireTimePressured -- the explicit testingModes DNA fact, not an inferred pressure score", () => {
    // Low-load: 6 correct-slow (drives the applicability trigger) + 4 correct-fast (clears the steady_pace COUNT gate).
    // High-load: 3 correct-fast, disjoint from the low-load population, clears the mixed_pace gate independently.
    const attemptRecords = [
      ...makeSlowCorrectBatch(6, { conceptualLoad: 0.1 }),
      ...makeFastCorrectBatch(4, { conceptualLoad: 0.1 }),
      ...makeFastCorrectBatch(3, { conceptualLoad: 0.9 })
    ];
    const outcome = evaluateSpeedLab({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords,
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) {
      const requirement = asSpeedLabRequirement(outcome.requirement);
      expect(requirement.stage).toBe("time_constrained");
      expect(requirement.requireTimePressured).toBe(true);
    }
  });
});
