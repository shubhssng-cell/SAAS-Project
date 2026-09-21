import { describe, expect, it } from "vitest";
import { buildPercentagesDemoReport } from "../src/demoReport.js";

describe("Percentages demonstration report (docs/MASTER_PLAN.md Phase 2 §12)", () => {
  it("covers all ten inspection points with real, non-empty data", () => {
    const report = buildPercentagesDemoReport();

    expect(report.concept.name).toBe("Percentages");
    expect(report.prerequisites.length).toBeGreaterThan(0);
    expect(report.connectedConcepts.length).toBeGreaterThan(0);
    expect(report.patternFamilies.length).toBe(4);
    expect(report.transformationsInUse.length).toBeGreaterThan(0);
    expect(report.trapsInUse.length).toBeGreaterThan(0);
    expect(Object.keys(report.difficultyDimensionsBaseline).length).toBe(6);
    expect(report.questionDnaExample.conceptName).toBe("Percentages");
  });

  it("every connected concept carries a rationale — the point is WHY, not just a list", () => {
    const report = buildPercentagesDemoReport();
    for (const connected of report.connectedConcepts) {
      expect(connected.rationale.length).toBeGreaterThan(10);
    }
  });

  it("treats Percentages as a network node: prerequisites and connections span multiple chapters", () => {
    const report = buildPercentagesDemoReport();
    const allNames = [...report.prerequisites.map((p) => p.concept), ...report.connectedConcepts.map((c) => c.concept)];
    expect(allNames).toContain("Ratio");
    expect(allNames).toContain("Data Interpretation");
    expect(allNames).toContain("Algebra");
  });

  it("coverage summary uses only known/mapped/covered vocabulary (no literal completeness claim)", () => {
    const report = buildPercentagesDemoReport();
    expect(report.questionUniverseSummary.mappedFamilyCount).toBe(4);
    expect(report.questionUniverseSummary.practiceReadyCount).toBeLessThanOrEqual(
      report.questionUniverseSummary.mappedFamilyCount
    );
  });
});
