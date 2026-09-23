import { describe, expect, it } from "vitest";
import { computeSpeedEvidence } from "../src/speedEvidence.js";
import { makeAttemptRecord, makeFastCorrectBatch, makeSlowCorrectBatch, STUDENT } from "./fixtures.js";

describe("computeSpeedEvidence -- the exact, immutable denominator (docs/DECISIONS.md D-055 adjustment 3)", () => {
  it("reports null slowFraction below MIN_OBSERVATIONS_FOR_COMPONENT eligible attempts -- a single slow attempt never triggers", () => {
    const records = makeSlowCorrectBatch(2);
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(2);
    expect(evidence.slowFraction).toBeNull();
  });

  it("repeated correct-and-slow evidence produces a high slow fraction", () => {
    const records = makeSlowCorrectBatch(5);
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
    expect(evidence.correctSlowCount).toBe(5);
    expect(evidence.slowFraction).toBe(1);
  });

  it("correct+fast attempts are eligible (denominator) but never counted as correctSlow", () => {
    const records = makeFastCorrectBatch(5);
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
    expect(evidence.correctSlowCount).toBe(0);
    expect(evidence.slowFraction).toBe(0);
  });

  it("incorrect+fast attempts dilute the denominator but never appear in either slow count", () => {
    const records = [...makeSlowCorrectBatch(3), ...Array.from({ length: 3 }, () => makeAttemptRecord({ isCorrect: false, timeTakenSeconds: 54, expectedTimeSeconds: 90 }))];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(6);
    expect(evidence.correctSlowCount).toBe(3);
    expect(evidence.incorrectSlowCount).toBe(0);
    expect(evidence.slowFraction).toBeCloseTo(0.5);
  });

  it("incorrect+slow attempts dilute the denominator, are tracked separately, and never count toward correctSlow", () => {
    const records = [...makeSlowCorrectBatch(3), ...Array.from({ length: 3 }, () => makeAttemptRecord({ isCorrect: false, timeTakenSeconds: 135, expectedTimeSeconds: 90 }))];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(6);
    expect(evidence.correctSlowCount).toBe(3);
    expect(evidence.incorrectSlowCount).toBe(3);
    expect(evidence.slowFraction).toBeCloseTo(0.5);
  });

  it("a high-conceptualLoad slow attempt is excluded from the denominator entirely", () => {
    const records = [...makeSlowCorrectBatch(5), ...makeSlowCorrectBatch(5, { conceptualLoad: 0.9 })];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
  });

  it("a hint-assisted attempt is excluded from the denominator entirely", () => {
    const records = [...makeSlowCorrectBatch(5), ...makeSlowCorrectBatch(5, { hintsUsed: 1 })];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
  });

  it("a time_pressured attempt is excluded from the denominator entirely", () => {
    const records = [...makeSlowCorrectBatch(5), ...makeSlowCorrectBatch(5, { testingModes: ["time_pressured"] })];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
  });

  it("skipped/abandoned attempts are excluded from the denominator entirely", () => {
    const records = [...makeSlowCorrectBatch(5), makeAttemptRecord({ status: "skipped", isCorrect: null }), makeAttemptRecord({ status: "abandoned", isCorrect: null })];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
  });

  it("attempts with missing or invalid timing are excluded from the denominator entirely", () => {
    const records = [
      ...makeSlowCorrectBatch(5),
      makeAttemptRecord({ timeTakenSeconds: null }),
      makeAttemptRecord({ expectedTimeSeconds: null }),
      makeAttemptRecord({ expectedTimeSeconds: 0 }),
      makeAttemptRecord({ expectedTimeSeconds: -10 })
    ];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
  });

  it("only counts attempts for THIS student and concept", () => {
    const records = [...makeSlowCorrectBatch(5), makeAttemptRecord({ studentId: "someone-else", timeTakenSeconds: 135, expectedTimeSeconds: 90 }), makeAttemptRecord({ conceptName: "Ratio", timeTakenSeconds: 135, expectedTimeSeconds: 90 })];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.eligibleGradedCount).toBe(5);
  });
});
