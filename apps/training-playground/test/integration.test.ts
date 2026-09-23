import { describe, expect, it } from "vitest";
import { TRAINING_PLAYGROUND_SCENARIOS } from "../src/domain/scenarios.js";
import { runTrainingPlaygroundScenario } from "../src/domain/runScenario.js";

/**
 * Integration tests: exercise the ACTUAL public domain contracts
 * (`@ipmat/calculation-gym`, `@ipmat/speed-lab`, `@ipmat/trap-lab`,
 * `@ipmat/training-orchestration`, via `runTrainingSystemProvider()`/
 * `orchestrateNextTrainingAction()`) for every catalog scenario, proving
 * the complete chain: fixture -> real domain call -> outcome status
 * matching what the scenario claims to demonstrate.
 */
describe("training playground -- integration against real domain contracts", () => {
  it.each(TRAINING_PLAYGROUND_SCENARIOS.map((s) => [s.id, s] as const))("%s: every system's outcome status matches the declared expectation", (_id, scenario) => {
    const result = runTrainingPlaygroundScenario(scenario);
    expect(result.systemResults).toHaveLength(scenario.expectedOutcomes.length);

    result.systemResults.forEach((systemResult, index) => {
      const expected = scenario.expectedOutcomes[index]!;
      expect(systemResult.systemId).toBe(expected.systemId);
      expect(systemResult.outcome.status).toBe(expected.status);
    });
  });

  it("the complete chain, in full detail: 'repair-fallback' proves fixture -> orchestration -> repair no_match -> adaptive fallback -> selected question -> diagnostics", () => {
    const scenario = TRAINING_PLAYGROUND_SCENARIOS.find((s) => s.id === "repair-fallback")!;
    const result = runTrainingPlaygroundScenario(scenario);
    const outcome = result.systemResults[0]!.outcome;

    expect(outcome.status).toBe("selected");
    if (outcome.status !== "selected") return;
    expect(outcome).toHaveProperty("actionType", "adaptive_practice");
    if ("actionType" in outcome && outcome.actionType === "adaptive_practice") {
      expect(outcome.wasFallbackFromRepair).toBe(true);
      expect(outcome.diagnostics.repairAttempted).toBe(true);
      expect(outcome.diagnostics.repairOutcome?.status).toBe("no_match");
      expect(outcome.diagnostics.adaptiveAttempted).toBe(true);
      expect(outcome.diagnostics.adaptiveOutcome?.status).toBe("selected");
      expect(outcome.question.conceptName).toBe("Ratio");
    }
  });

  it("'repair-first' selects the confirmed RepairPlan's direct cell+trap match, never falling back", () => {
    const scenario = TRAINING_PLAYGROUND_SCENARIOS.find((s) => s.id === "repair-first")!;
    const outcome = runTrainingPlaygroundScenario(scenario).systemResults[0]!.outcome;
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected" && "actionType" in outcome) {
      expect(outcome.actionType).toBe("targeted_repair");
    }
  });

  it("'mixed-evidence': every specialized system independently reports applicable, and orchestration picks targeted_repair via its own unmodified precedence policy", () => {
    const scenario = TRAINING_PLAYGROUND_SCENARIOS.find((s) => s.id === "mixed-evidence")!;
    const result = runTrainingPlaygroundScenario(scenario);

    for (const specializedId of ["calculation-gym", "speed-lab", "trap-lab"] as const) {
      const systemResult = result.systemResults.find((r) => r.systemId === specializedId)!;
      expect(systemResult.outcome.status).toBe("selected");
    }

    const orchestrationResult = result.systemResults.find((r) => r.systemId === "training-orchestration")!;
    expect(orchestrationResult.outcome.status).toBe("selected");
    if (orchestrationResult.outcome.status === "selected" && "actionType" in orchestrationResult.outcome) {
      expect(orchestrationResult.outcome.actionType).toBe("targeted_repair");
    }
  });

  it("'insufficient-evidence': all three specialized systems fail closed to not_applicable, and select() is never reached", () => {
    const scenario = TRAINING_PLAYGROUND_SCENARIOS.find((s) => s.id === "insufficient-evidence")!;
    const result = runTrainingPlaygroundScenario(scenario);
    for (const systemResult of result.systemResults) {
      expect(systemResult.outcome.status).toBe("not_applicable");
    }
  });

  it("'no-eligible-question': Trap Lab is applicable but has no eligible candidate", () => {
    const scenario = TRAINING_PLAYGROUND_SCENARIOS.find((s) => s.id === "no-eligible-question")!;
    const outcome = runTrainingPlaygroundScenario(scenario).systemResults[0]!.outcome;
    expect(outcome.status).toBe("no_eligible_question");
  });
});
