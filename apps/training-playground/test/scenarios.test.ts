import { describe, expect, it } from "vitest";
import { getTrainingPlaygroundScenario, TRAINING_PLAYGROUND_SCENARIOS } from "../src/domain/scenarios.js";

describe("TRAINING_PLAYGROUND_SCENARIOS -- catalog structure", () => {
  it("has at least the 10 required scenarios", () => {
    expect(TRAINING_PLAYGROUND_SCENARIOS.length).toBeGreaterThanOrEqual(10);
  });

  it("every scenario id is stable and unique", () => {
    const ids = TRAINING_PLAYGROUND_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every scenario has a non-empty displayName, description, and evidenceSummary", () => {
    for (const scenario of TRAINING_PLAYGROUND_SCENARIOS) {
      expect(scenario.displayName.length).toBeGreaterThan(0);
      expect(scenario.description.length).toBeGreaterThan(0);
      expect(scenario.evidenceSummary.length).toBeGreaterThan(0);
    }
  });

  it("every scenario declares at least one system to run, and one expectedOutcome per system", () => {
    for (const scenario of TRAINING_PLAYGROUND_SCENARIOS) {
      expect(scenario.systemsToRun.length).toBeGreaterThan(0);
      expect(scenario.expectedOutcomes.length).toBe(scenario.systemsToRun.length);
      expect(scenario.expectedOutcomes.map((e) => e.systemId)).toEqual(scenario.systemsToRun);
    }
  });

  it("getTrainingPlaygroundScenario resolves a known id and returns undefined for an unknown one", () => {
    expect(getTrainingPlaygroundScenario("calculation-friction")?.id).toBe("calculation-friction");
    expect(getTrainingPlaygroundScenario("does-not-exist")).toBeUndefined();
  });

  it("evidenceSummary text never claims proof or insight into the student's private reasoning -- 'confirmed' is only ever accurate when describing an actual RepairPlan, which genuinely is a confirmed diagnosis (D-006/D-038)", () => {
    const forbidden = [/\bproven\b/i, /student'?s reasoning/i, /confirmed (calculation|speed|trap|friction|recurrence|evidence)/i];
    for (const scenario of TRAINING_PLAYGROUND_SCENARIOS) {
      for (const line of scenario.evidenceSummary) {
        for (const pattern of forbidden) {
          expect(pattern.test(line), `"${line}" must not match ${pattern}`).toBe(false);
        }
      }
    }
  });
});
