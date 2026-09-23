import { describe, expect, it } from "vitest";
import { determineSpeedLabStage } from "../src/progression.js";
import { makeFastCorrectBatch, makeSlowCorrectBatch, STUDENT } from "./fixtures.js";

describe("determineSpeedLabStage", () => {
  it("defaults to steady_pace under zero evidence", () => {
    expect(determineSpeedLabStage("Percentages", STUDENT, [])).toBe("steady_pace");
  });

  it("stays steady_pace when the low-load good-pace COUNT is below MIN_OBSERVATIONS_FOR_COMPONENT", () => {
    const records = makeFastCorrectBatch(2, { conceptualLoad: 0.1 });
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("steady_pace");
  });

  it("advances to mixed_pace once the low-load good-pace count clears the threshold", () => {
    const records = makeFastCorrectBatch(3, { conceptualLoad: 0.1 });
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("mixed_pace");
  });

  it("does NOT skip straight to time_constrained merely because steady_pace is mastered -- mixed_pace requires its OWN, DISJOINT evidence slice (mirrors D-054's foundational/mixed discipline)", () => {
    // Plenty of low-load good-pace attempts -- but ZERO higher-load attempts to independently evidence mixed_pace.
    const records = makeFastCorrectBatch(20, { conceptualLoad: 0.1 });
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("mixed_pace");
  });

  it("stays at mixed_pace when the broader (moderate/high-load) good-pace count is below threshold, even though steady_pace is mastered", () => {
    const records = [...makeFastCorrectBatch(3, { conceptualLoad: 0.1 }), ...makeFastCorrectBatch(2, { conceptualLoad: 0.9 })];
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("mixed_pace");
  });

  it("advances to time_constrained only once BOTH steady_pace and mixed_pace evidence independently clear their own thresholds", () => {
    const records = [...makeFastCorrectBatch(3, { conceptualLoad: 0.1 }), ...makeFastCorrectBatch(3, { conceptualLoad: 0.9 })];
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("time_constrained");
  });

  it("the broader-slice evidence excludes time_pressured attempts, keeping it uncontaminated by the next stage's own condition", () => {
    const records = [
      ...makeFastCorrectBatch(3, { conceptualLoad: 0.1 }),
      ...makeFastCorrectBatch(3, { conceptualLoad: 0.9, testingModes: ["time_pressured"] }) // excluded from the progression pool entirely
    ];
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("mixed_pace");
  });

  it("hint-assisted good-pace attempts do not count toward any progression gate", () => {
    const records = makeFastCorrectBatch(5, { conceptualLoad: 0.1, hintsUsed: 1 });
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("steady_pace");
  });

  it("a slow (not good-paced) attempt at low load does not count toward the steady_pace gate", () => {
    const records = [...makeFastCorrectBatch(2, { conceptualLoad: 0.1 }), ...makeSlowCorrectBatch(5, { conceptualLoad: 0.1 })];
    expect(determineSpeedLabStage("Percentages", STUDENT, records)).toBe("steady_pace");
  });
});
