import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { percentagesLens } from "@ipmat/examiner-lens";
import { describe, expect, it } from "vitest";
import { buildLensComparisonReport } from "../src/comparisonReport.js";
import { aiLensRegenerationOutput, aiLensRegenerationOutputWithCompletenessClaim } from "../fixtures/aiLensOutputs.js";

describe("Human baseline vs AI Examiner Lens — do not assume AI is correct", () => {
  const report = buildLensComparisonReport(percentagesLens, aiLensRegenerationOutput, percentagesConceptGraph);

  it("identifies where AI and human agree on the prerequisite", () => {
    expect(report.prerequisite.human).toBe("Ratio");
    expect(report.prerequisite.ai).toBe("Ratio");
    expect(report.prerequisite.agree).toBe(true);
  });

  it("identifies testing modes the AI under-discovered relative to the human baseline", () => {
    expect(report.testingModes.humanOnly.length).toBeGreaterThan(0);
    expect(report.testingModes.humanOnly).toContain("multi_step");
    expect(report.testingModes.agreedOn).toContain("direct");
  });

  it("flags a combination the AI invented with no supporting graph edge", () => {
    expect(report.combinations.unsupportedByGraph).toContain("Time and Work");
  });

  it("confirms combinations the AI proposed that DO correspond to real graph edges", () => {
    expect(report.combinations.supportedByGraph).toContain("Ratio");
    expect(report.combinations.supportedByGraph).toContain("Profit and Loss");
  });

  it("identifies real, useful combinations the AI missed", () => {
    expect(report.combinations.missedByAi.length).toBeGreaterThan(0);
    expect(report.combinations.missedByAi).toContain("Discount");
  });

  it("measures difficulty dimension disagreement numerically, not just pass/fail", () => {
    expect(report.difficultyDimensions.maxAbsoluteDelta).toBeGreaterThan(0);
    expect(report.difficultyDimensions.maxAbsoluteDelta).toBeLessThan(1);
  });

  it("never overwrites or mutates the human baseline", () => {
    expect(percentagesLens.testingModes).toContain("multi_step");
  });

  it("does not flag a completeness claim in the well-behaved AI output", () => {
    expect(report.completenessClaims.hasUnsupportedClaim).toBe(false);
  });

  it("DOES flag a completeness claim when the AI output makes one", () => {
    const withClaim = buildLensComparisonReport(percentagesLens, aiLensRegenerationOutputWithCompletenessClaim, percentagesConceptGraph);
    expect(withClaim.completenessClaims.hasUnsupportedClaim).toBe(true);
    expect(withClaim.completenessClaims.found.length).toBeGreaterThan(0);
  });
});
