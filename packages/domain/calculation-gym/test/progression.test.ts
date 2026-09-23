import { describe, expect, it } from "vitest";
import { determineCalculationTrainingStage } from "../src/progression.js";
import { makeGradedBatch, STUDENT } from "./fixtures.js";

describe("determineCalculationTrainingStage", () => {
  it("defaults to foundational under zero evidence", () => {
    expect(determineCalculationTrainingStage("Percentages", STUDENT, [])).toBe("foundational");
  });

  it("stays foundational when foundational-shaped accuracy is below the stage-mastery threshold", () => {
    const records = makeGradedBatch(5, 2, { computationalLoad: 0.1, testingModes: ["direct"] });
    expect(determineCalculationTrainingStage("Percentages", STUDENT, records)).toBe("foundational");
  });

  it("advances to mixed once foundational-shaped attempts clear the stage-mastery threshold", () => {
    const records = makeGradedBatch(5, 5, { computationalLoad: 0.1, testingModes: ["direct"] });
    expect(determineCalculationTrainingStage("Percentages", STUDENT, records)).toBe("mixed");
  });

  it("does NOT jump straight to time_pressured merely because foundational is mastered -- mixed requires its OWN high-load evidence (regression for adjustment 3)", () => {
    // Plenty of foundational-shaped attempts, perfect accuracy -- but ZERO high-load attempts at all.
    const records = makeGradedBatch(20, 20, { computationalLoad: 0.1, testingModes: ["direct"] });
    expect(determineCalculationTrainingStage("Percentages", STUDENT, records)).toBe("mixed");
  });

  it("stays at mixed when mixed-shaped (high-load) accuracy is below the stage-mastery threshold, even though foundational is mastered", () => {
    const records = [
      ...makeGradedBatch(5, 5, { computationalLoad: 0.1, testingModes: ["direct"] }),
      ...makeGradedBatch(5, 2, { computationalLoad: 0.9, testingModes: ["direct"] })
    ];
    expect(determineCalculationTrainingStage("Percentages", STUDENT, records)).toBe("mixed");
  });

  it("advances to time_pressured only once BOTH foundational and mixed evidence independently clear the threshold", () => {
    const records = [
      ...makeGradedBatch(5, 5, { computationalLoad: 0.1, testingModes: ["direct"] }),
      ...makeGradedBatch(5, 5, { computationalLoad: 0.9, testingModes: ["direct"] })
    ];
    expect(determineCalculationTrainingStage("Percentages", STUDENT, records)).toBe("time_pressured");
  });

  it("mixed-shaped evidence excludes attempts that were already time_pressured (keeps the mixed slice uncontaminated by the next stage's own condition)", () => {
    const records = [
      ...makeGradedBatch(5, 5, { computationalLoad: 0.1, testingModes: ["direct"] }),
      ...makeGradedBatch(5, 5, { computationalLoad: 0.9, testingModes: ["time_pressured"] }) // excluded from mixed slice
    ];
    expect(determineCalculationTrainingStage("Percentages", STUDENT, records)).toBe("mixed");
  });
});
