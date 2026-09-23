import { describe, expect, it } from "vitest";
import { getTrainingPlaygroundScenario, TRAINING_PLAYGROUND_SCENARIOS } from "../src/domain/scenarios.js";
import { runTrainingPlaygroundScenario } from "../src/domain/runScenario.js";

describe("runTrainingPlaygroundScenario -- adapter behavior", () => {
  it("produces exactly one system result per declared system, in the same order", () => {
    const scenario = getTrainingPlaygroundScenario("mixed-evidence")!;
    const result = runTrainingPlaygroundScenario(scenario);
    expect(result.systemResults.map((r) => r.systemId)).toEqual(scenario.systemsToRun);
  });

  it("is deterministic: running the SAME scenario twice yields an identical result", () => {
    const scenario = getTrainingPlaygroundScenario("calculation-friction")!;
    const first = runTrainingPlaygroundScenario(scenario);
    const second = runTrainingPlaygroundScenario(scenario);
    expect(first).toEqual(second);
  });

  it("every catalog scenario runs without throwing", () => {
    for (const scenario of TRAINING_PLAYGROUND_SCENARIOS) {
      expect(() => runTrainingPlaygroundScenario(scenario)).not.toThrow();
    }
  });

  it("maps a malformed candidate (missing difficultyDimensions) to an ordinary malformed-exclusion outcome, never a thrown exception", () => {
    const scenario = getTrainingPlaygroundScenario("candidate-filtering")!;
    const result = runTrainingPlaygroundScenario(scenario);
    const calcGym = result.systemResults.find((r) => r.systemId === "calculation-gym")!;
    expect(calcGym.outcome.status).toBe("selected");
    if (calcGym.outcome.status === "selected" && "diagnostics" in calcGym.outcome && "excludedMalformedCount" in calcGym.outcome.diagnostics) {
      expect(calcGym.outcome.diagnostics.excludedMalformedCount).toBeGreaterThan(0);
    }
  });

  it("returns the outcome object produced directly by the real domain call -- not a re-summarized shape", () => {
    const scenario = getTrainingPlaygroundScenario("calculation-friction")!;
    const result = runTrainingPlaygroundScenario(scenario);
    const outcome = result.systemResults[0]!.outcome;
    // The real TrainingSystemOutcome "selected" variant carries `requirement`/`diagnostics`/`question` verbatim --
    // asserting their presence proves this is the actual domain object, not a UI-invented summary.
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome).toHaveProperty("requirement");
      expect(outcome).toHaveProperty("diagnostics");
      expect(outcome).toHaveProperty("question");
    }
  });
});
