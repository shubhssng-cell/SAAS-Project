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

  it("[case 1: valid generation combination] confirms combinations the AI proposed that ARE useful-for-generation graph edges", () => {
    expect(report.combinations.validGenerationCombination).toContain("Ratio");
    expect(report.combinations.validGenerationCombination).toContain("Profit and Loss");
    expect(report.combinations.validGenerationCombination).toContain("Data Interpretation");
  });

  it("[case 2: related but non-combinable] does NOT count a related_but_distinct edge as a valid combination just because a graph edge exists (the Phase 3.1 §2 fix)", () => {
    expect(report.combinations.relatedButNonCombinable).toContain("Probability");
    expect(report.combinations.validGenerationCombination).not.toContain("Probability");
    expect(report.combinations.unsupportedByGraph).not.toContain("Probability");
  });

  it("[case 3: unsupported/invented] flags a combination the AI invented with no supporting graph edge at all", () => {
    expect(report.combinations.unsupportedByGraph).toContain("Time and Work");
    expect(report.combinations.validGenerationCombination).not.toContain("Time and Work");
    expect(report.combinations.relatedButNonCombinable).not.toContain("Time and Work");
  });

  it("[case 4: missed valid combination] identifies real, useful combinations the AI never mentioned", () => {
    expect(report.combinations.missedByAi.length).toBeGreaterThan(0);
    expect(report.combinations.missedByAi).toContain("Discount");
  });

  it("the four combination categories are mutually exclusive for every AI-suggested concept", () => {
    for (const concept of report.combinations.aiSuggested) {
      const memberships = [
        report.combinations.validGenerationCombination.includes(concept),
        report.combinations.relatedButNonCombinable.includes(concept),
        report.combinations.unsupportedByGraph.includes(concept)
      ].filter(Boolean).length;
      expect(memberships).toBe(1);
    }
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
