import { percentagesConceptGraph } from "@ipmat/concept-graph";
import { describe, expect, it } from "vitest";
import { buildQuestionUniverseSnapshot, computePatternFamilyReadiness } from "../src/coverage.js";
import { percentagesPatternFamilies } from "../fixtures/percentagesPatternFamilies.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";
import type { QuestionRefForCoverage } from "../src/types.js";

const noQuestions: QuestionRefForCoverage[] = [];
const oneQuestion: QuestionRefForCoverage[] = [
  { patternFamilyName: "Reverse Percentage", validationState: "published" }
];

describe("Question Universe — supports coverage with known/mapped/covered/uncovered language", () => {
  it("a family with zero questions is 'mapped' but not further along the ladder", () => {
    const coverage = computePatternFamilyReadiness("Successive Percentage Change", percentagesTaxonomyCells, noQuestions);
    expect(coverage.stage).toBe("mapped");
    expect(coverage.cellCount).toBe(2);
    expect(coverage.questionCount).toBe(0);
  });

  it("a family with a published question is 'practice_ready'", () => {
    const coverage = computePatternFamilyReadiness("Reverse Percentage", percentagesTaxonomyCells, oneQuestion);
    expect(coverage.stage).toBe("practice_ready");
    expect(coverage.publishedQuestionCount).toBe(1);
  });

  it("a family with only a draft question is neither validated nor practice_ready", () => {
    const draftOnly: QuestionRefForCoverage[] = [{ patternFamilyName: "Reverse Percentage", validationState: "draft" }];
    const coverage = computePatternFamilyReadiness("Reverse Percentage", percentagesTaxonomyCells, draftOnly);
    expect(coverage.stage).toBe("has_questions");
  });

  it("builds a full snapshot for Percentages using only mapped/covered vocabulary", () => {
    const snapshot = buildQuestionUniverseSnapshot(
      "Percentages",
      percentagesConceptGraph,
      percentagesPatternFamilies,
      percentagesTaxonomyCells,
      oneQuestion
    );
    expect(snapshot.corePatternFamilies.length).toBe(4);
    expect(snapshot.relatedConcepts.length).toBeGreaterThan(0);
    expect(snapshot.summary.mappedFamilyCount).toBe(4);
    expect(snapshot.summary.practiceReadyCount).toBe(1);
    // "18/27 mapped pattern families" style reporting is exactly
    // summary.practiceReadyCount / summary.mappedFamilyCount once student
    // mastery exists (Phase 5) — this snapshot supplies the denominator now.
    expect(snapshot.summary.withQuestionsCount).toBeLessThanOrEqual(snapshot.summary.mappedFamilyCount);
  });

  it("never produces a stage value outside the sanctioned coverage vocabulary", () => {
    const sanctioned = new Set(["mapped", "has_questions", "validated", "practice_ready"]);
    const snapshot = buildQuestionUniverseSnapshot(
      "Percentages",
      percentagesConceptGraph,
      percentagesPatternFamilies,
      percentagesTaxonomyCells,
      oneQuestion
    );
    for (const coverage of snapshot.patternFamilyCoverage) {
      expect(sanctioned.has(coverage.stage)).toBe(true);
    }
  });
});
