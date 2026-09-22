import { describe, expect, it } from "vitest";
import { computeTaxonomyCellCoverage } from "../src/coverage.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";
import type { QuestionRefForCellCoverage } from "../src/types.js";

const reverseCell = percentagesTaxonomyCells.find((c) => c.testingMode === "reverse" && c.combination.includes("Ratio"))!;

function refFor(overrides: Partial<QuestionRefForCellCoverage> = {}): QuestionRefForCellCoverage {
  return {
    patternFamilyName: reverseCell.patternFamilyName,
    combination: reverseCell.combination,
    testingMode: reverseCell.testingMode,
    trapErrorTaxonomyCode: reverseCell.trapErrorTaxonomyCode,
    difficultyTier: reverseCell.difficultyTier,
    validationState: "published",
    ...overrides
  };
}

describe("computeTaxonomyCellCoverage — per-cell coverage, derived fresh every time (Phase 3.5)", () => {
  it("a cell with no matching questions at all is uncovered", () => {
    const result = computeTaxonomyCellCoverage(percentagesTaxonomyCells, []);
    for (const cell of result) {
      expect(cell.existingQuestionCount).toBe(0);
      expect(cell.publishedQuestionCount).toBe(0);
      expect(cell.status).toBe("uncovered");
    }
  });

  it("a cell with a published question is covered", () => {
    const result = computeTaxonomyCellCoverage(percentagesTaxonomyCells, [refFor({ validationState: "published" })]);
    const cell = result.find((c) => c.patternFamilyName === reverseCell.patternFamilyName && c.difficultyTier === reverseCell.difficultyTier)!;
    expect(cell.existingQuestionCount).toBe(1);
    expect(cell.publishedQuestionCount).toBe(1);
    expect(cell.status).toBe("covered");
  });

  it("a cell with only a validated (not published) question is underrepresented, never covered", () => {
    const result = computeTaxonomyCellCoverage(percentagesTaxonomyCells, [refFor({ validationState: "ai_validated" })]);
    const cell = result.find((c) => c.patternFamilyName === reverseCell.patternFamilyName && c.difficultyTier === reverseCell.difficultyTier)!;
    expect(cell.existingQuestionCount).toBe(1);
    expect(cell.publishedQuestionCount).toBe(0);
    expect(cell.status).toBe("underrepresented");
  });

  it("a question for the wrong testingMode does not count toward this cell", () => {
    const result = computeTaxonomyCellCoverage(percentagesTaxonomyCells, [refFor({ testingMode: "transformed", validationState: "published" })]);
    const cell = result.find((c) => c.patternFamilyName === reverseCell.patternFamilyName && c.testingMode === "reverse" && c.difficultyTier === reverseCell.difficultyTier)!;
    expect(cell.existingQuestionCount).toBe(0);
    expect(cell.status).toBe("uncovered");
  });

  it("combination is compared as a SET — order does not matter, but membership does", () => {
    const combinedCell = percentagesTaxonomyCells.find((c) => c.combination.length > 1);
    if (combinedCell) {
      const reordered = [...combinedCell.combination].reverse();
      const result = computeTaxonomyCellCoverage(percentagesTaxonomyCells, [
        {
          patternFamilyName: combinedCell.patternFamilyName,
          combination: reordered,
          testingMode: combinedCell.testingMode,
          trapErrorTaxonomyCode: combinedCell.trapErrorTaxonomyCode,
          difficultyTier: combinedCell.difficultyTier,
          validationState: "published"
        }
      ]);
      const cell = result.find(
        (c) => c.patternFamilyName === combinedCell.patternFamilyName && c.difficultyTier === combinedCell.difficultyTier && c.testingMode === combinedCell.testingMode
      )!;
      expect(cell.status).toBe("covered");
    }

    // A DIFFERENT combination (even same length) must not match.
    const result2 = computeTaxonomyCellCoverage(percentagesTaxonomyCells, [refFor({ combination: ["Not A Real Combination"], validationState: "published" })]);
    const cell2 = result2.find((c) => c.patternFamilyName === reverseCell.patternFamilyName && c.difficultyTier === reverseCell.difficultyTier)!;
    expect(cell2.status).toBe("uncovered");
  });

  it("returns exactly one entry per input cell, preserving the cell's own identifying fields", () => {
    const result = computeTaxonomyCellCoverage(percentagesTaxonomyCells, []);
    expect(result.length).toBe(percentagesTaxonomyCells.length);
    const [firstResult] = result;
    const [firstCell] = percentagesTaxonomyCells;
    expect(firstResult?.conceptName).toBe(firstCell?.conceptName);
  });

  it("never mutates the input cells or questions arrays", () => {
    const cellsCopy = JSON.parse(JSON.stringify(percentagesTaxonomyCells));
    const questions = [refFor()];
    const questionsCopy = JSON.parse(JSON.stringify(questions));
    computeTaxonomyCellCoverage(percentagesTaxonomyCells, questions);
    expect(percentagesTaxonomyCells).toEqual(cellsCopy);
    expect(questions).toEqual(questionsCopy);
  });
});
