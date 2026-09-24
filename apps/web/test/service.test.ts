import { describe, expect, it } from "vitest";
import { createFixtureTrainingAdapter } from "../src/adapter/service.js";

/**
 * Proves the adapter is a thin wiring layer over the REAL domain packages,
 * not a second decision engine: a wrong answer on the trap-coded question
 * produces a real hypothesis, confirming it produces a real RepairPlan via
 * `buildRepairPlan()`, and the resulting recommendation is whatever
 * `orchestrateNextTrainingAction()` actually decided -- never a value this
 * test (or the adapter) invented.
 */
describe("createFixtureTrainingAdapter -- end-to-end wiring over real domain packages", () => {
  it("dashboard has a recommendation before any attempts exist", async () => {
    const adapter = createFixtureTrainingAdapter();
    const dashboard = await adapter.getDashboard();
    expect(dashboard.questionsPracticedSoFar).toBe(0);
    expect(dashboard.recommendation.questionId).not.toBeNull();
  });

  it("an incorrect answer on the trap question produces a real, confirmable hypothesis", async () => {
    const adapter = createFixtureTrainingAdapter();
    await adapter.loadQuestion("q-reverse-1");
    const result = await adapter.submitAnswer({ questionId: "q-reverse-1", chosenAnswer: "₹480", timeTakenSeconds: 60 });

    expect(result.isCorrect).toBe(false);
    expect(result.hasAutopsy).toBe(true);

    const autopsy = await adapter.getAutopsy(result.attemptId);
    expect(autopsy.hypothesis).not.toBeNull();
    expect(autopsy.hypothesis?.summary.length).toBeGreaterThan(0);
    expect(autopsy.observed.length).toBeGreaterThan(0);
  });

  it("a correct answer never produces an autopsy", async () => {
    const adapter = createFixtureTrainingAdapter();
    await adapter.loadQuestion("q-reverse-1");
    const result = await adapter.submitAnswer({ questionId: "q-reverse-1", chosenAnswer: "₹500", timeTakenSeconds: 40 });

    expect(result.isCorrect).toBe(true);
    expect(result.hasAutopsy).toBe(false);
  });

  it("confirming the hypothesis produces a real RepairPlan that orchestration picks up as targeted repair", async () => {
    const adapter = createFixtureTrainingAdapter();
    await adapter.loadQuestion("q-reverse-1");
    const result = await adapter.submitAnswer({ questionId: "q-reverse-1", chosenAnswer: "₹480", timeTakenSeconds: 60 });
    expect(result.hasAutopsy).toBe(true);

    const recommendation = await adapter.respondToAutopsy({ attemptId: result.attemptId, response: "confirmed" });

    expect(recommendation.modeLabel).toBe("Confirmed pattern");
    // q-percentage-repair-1 shares q-reverse-1's exact taxonomy cell + trap code -- the
    // only question that can be a tier-1 repair-selection match.
    expect(recommendation.questionId).toBe("q-percentage-repair-1");
  });

  it("rejecting the hypothesis produces no RepairPlan -- the next recommendation is never targeted repair", async () => {
    const adapter = createFixtureTrainingAdapter();
    await adapter.loadQuestion("q-reverse-1");
    const result = await adapter.submitAnswer({ questionId: "q-reverse-1", chosenAnswer: "₹480", timeTakenSeconds: 60 });

    const recommendation = await adapter.respondToAutopsy({ attemptId: result.attemptId, response: "rejected" });

    expect(recommendation.modeLabel).not.toBe("Confirmed pattern");
  });

  it("a non-trap question never surfaces an autopsy even when answered incorrectly", async () => {
    const adapter = createFixtureTrainingAdapter();
    await adapter.loadQuestion("q-direct-1");
    const result = await adapter.submitAnswer({ questionId: "q-direct-1", chosenAnswer: "70%", timeTakenSeconds: 50 });

    expect(result.isCorrect).toBe(false);
    expect(result.hasAutopsy).toBe(false);
  });
});
