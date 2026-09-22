import type { RepairPlan } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { classifyMatchTier } from "../src/matchTier.js";
import { makeCandidate } from "./fixtures.js";

const basePlan: RepairPlan = {
  targetConceptName: "Percentages",
  targetPatternFamilyName: "Reverse Percentage",
  targetTaxonomyCellId: "cell-target-1",
  targetErrorCategory: "misconception",
  targetErrorTaxonomyCode: "base_confusion",
  recommendedTrainingMode: "standard_practice",
  priority: "medium",
  rationale: [],
  prerequisites: [],
  confirmationSource: { attemptId: "attempt-1", hypothesisConfirmedAt: "2026-09-22T11:00:00.000Z" }
};

describe("classifyMatchTier — explicit, ordered tiers (Phase 5C-2 §5)", () => {
  it("direct_cell_and_trap: exact cell + matching trap", () => {
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-target-1", patternFamilyName: "Reverse Percentage", trapErrorTaxonomyCode: "base_confusion" });
    expect(classifyMatchTier(candidate.question, basePlan)).toBe("direct_cell_and_trap");
  });

  it("direct_cell_and_trap: exact cell match is sufficient when the plan targets no trap at all", () => {
    const noTrapPlan: RepairPlan = { ...basePlan, targetErrorTaxonomyCode: null };
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-target-1", trapErrorTaxonomyCode: null });
    expect(classifyMatchTier(candidate.question, noTrapPlan)).toBe("direct_cell_and_trap");
  });

  it("direct_cell: exact cell match but a different (or missing) trap than the one targeted", () => {
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-target-1", trapErrorTaxonomyCode: "percentage_point_confusion" });
    expect(classifyMatchTier(candidate.question, basePlan)).toBe("direct_cell");
  });

  it("pattern_family_and_trap: same family, different cell, same trap — repeated-error-category repair one level broader than a cell match", () => {
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-other", patternFamilyName: "Reverse Percentage", trapErrorTaxonomyCode: "base_confusion" });
    expect(classifyMatchTier(candidate.question, basePlan)).toBe("pattern_family_and_trap");
  });

  it("trap_only: same confirmed error category, but a DIFFERENT pattern family entirely", () => {
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-other", patternFamilyName: "Percentage Share in Data Interpretation", trapErrorTaxonomyCode: "base_confusion" });
    expect(classifyMatchTier(candidate.question, basePlan)).toBe("trap_only");
  });

  it("pattern_family: same family, neither cell nor trap match", () => {
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-other", patternFamilyName: "Reverse Percentage", trapErrorTaxonomyCode: "percentage_point_confusion" });
    expect(classifyMatchTier(candidate.question, basePlan)).toBe("pattern_family");
  });

  it("concept_fallback: same concept only — no family, cell, or trap match", () => {
    const candidate = makeCandidate({
      patternTaxonomyCellId: "cell-other",
      patternFamilyName: "Successive Percentage Change",
      trapErrorTaxonomyCode: "successive_change_error"
    });
    expect(classifyMatchTier(candidate.question, basePlan)).toBe("concept_fallback");
  });
});
