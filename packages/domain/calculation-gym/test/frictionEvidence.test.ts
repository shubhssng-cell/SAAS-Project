import { describe, expect, it } from "vitest";
import { computeCalculationFrictionEvidence } from "../src/frictionEvidence.js";
import { makeAttemptRecord, makeGradedBatch, STUDENT } from "./fixtures.js";

describe("computeCalculationFrictionEvidence", () => {
  it("reports null accuracy on a slice below MIN_OBSERVATIONS_FOR_COMPONENT, never a fake ratio from too few attempts", () => {
    const records = [
      ...makeGradedBatch(2, 0, { computationalLoad: 0.9 }), // only 2 high-load attempts -- below threshold
      ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })
    ];
    const evidence = computeCalculationFrictionEvidence("Percentages", STUDENT, records);

    expect(evidence.highLoad.attempts).toBe(2);
    expect(evidence.highLoad.accuracy).toBeNull();
    expect(evidence.lowLoad.accuracy).toBe(1);
    expect(evidence.frictionDetected).toBe(false);
  });

  it("detects friction when high-load accuracy is meaningfully lower than low-load accuracy, both sufficiently observed", () => {
    const records = [...makeGradedBatch(5, 1, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })];
    const evidence = computeCalculationFrictionEvidence("Percentages", STUDENT, records);

    expect(evidence.highLoad.accuracy).toBeCloseTo(0.2);
    expect(evidence.lowLoad.accuracy).toBe(1);
    expect(evidence.frictionDetected).toBe(true);
  });

  it("does NOT detect friction when both slices are sufficiently observed but the gap is below the provisional threshold (looks like general performance, not calculation-specific)", () => {
    const records = [...makeGradedBatch(5, 4, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })];
    const evidence = computeCalculationFrictionEvidence("Percentages", STUDENT, records);

    expect(evidence.highLoad.accuracy).toBeCloseTo(0.8);
    expect(evidence.lowLoad.accuracy).toBe(1);
    expect(evidence.frictionDetected).toBe(false);
  });

  it("does NOT detect friction when BOTH slices are equally low (looks like conceptual weakness, not calculation-specific friction)", () => {
    const records = [...makeGradedBatch(5, 1, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 1, { computationalLoad: 0.1 })];
    const evidence = computeCalculationFrictionEvidence("Percentages", STUDENT, records);

    expect(evidence.highLoad.accuracy).toBeCloseTo(0.2);
    expect(evidence.lowLoad.accuracy).toBeCloseTo(0.2);
    expect(evidence.frictionDetected).toBe(false);
  });

  it("only counts graded (submitted, non-null isCorrect) attempts for THIS student and concept", () => {
    const records = [
      ...makeGradedBatch(5, 1, { computationalLoad: 0.9 }),
      ...makeGradedBatch(5, 5, { computationalLoad: 0.1 }),
      makeAttemptRecord({ computationalLoad: 0.9, isCorrect: true, status: "skipped" }),
      makeAttemptRecord({ computationalLoad: 0.9, isCorrect: true, studentId: "someone-else" }),
      makeAttemptRecord({ computationalLoad: 0.9, isCorrect: true, conceptName: "Ratio" })
    ];
    const evidence = computeCalculationFrictionEvidence("Percentages", STUDENT, records);

    expect(evidence.highLoad.attempts).toBe(5);
    expect(evidence.lowLoad.attempts).toBe(5);
  });
});
