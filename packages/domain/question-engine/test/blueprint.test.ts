import { describe, expect, it } from "vitest";
import { buildBlueprintFromCell } from "../src/blueprint.js";
import { percentagesPatternFamilies } from "../fixtures/percentagesPatternFamilies.js";
import { percentagesTaxonomyCells } from "../fixtures/percentagesTaxonomyCells.js";

describe("QuestionBlueprint — a specification, not a question", () => {
  it("builds deterministically from one taxonomy cell and its pattern family", () => {
    const cell = percentagesTaxonomyCells[0]!;
    const family = percentagesPatternFamilies.find((f) => f.name === cell.patternFamilyName)!;
    const blueprint = buildBlueprintFromCell(cell, family, {
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      answerFormat: "multiple_choice",
      idSuffix: "1"
    });

    expect(blueprint.conceptName).toBe(cell.conceptName);
    expect(blueprint.patternFamilyName).toBe(family.name);
    expect(blueprint.targetSkill).toBe(family.skill);
    expect(blueprint.combinationConcepts).toEqual(cell.combination);
    expect(blueprint.trapErrorTaxonomyCode).toBe(cell.trapErrorTaxonomyCode);
    expect(blueprint.testingModes).toEqual(cell.testingMode ? [cell.testingMode] : []);
  });

  it("marks its difficulty dimensions as provisional, never as calibrated (Phase 3.1 §4)", () => {
    const cell = percentagesTaxonomyCells[0]!;
    const family = percentagesPatternFamilies.find((f) => f.name === cell.patternFamilyName)!;
    const blueprint = buildBlueprintFromCell(cell, family, {
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      answerFormat: "multiple_choice",
      idSuffix: "calibration-check"
    });
    expect(blueprint.difficultyCalibrationStatus).toBe("provisional");
  });

  it("has no body/options/answer fields — it is a specification, not question content", () => {
    const cell = percentagesTaxonomyCells[0]!;
    const family = percentagesPatternFamilies.find((f) => f.name === cell.patternFamilyName)!;
    const blueprint = buildBlueprintFromCell(cell, family, {
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      answerFormat: "numeric_entry",
      idSuffix: "2"
    });
    expect(blueprint).not.toHaveProperty("body");
    expect(blueprint).not.toHaveProperty("correctAnswer");
    expect(blueprint).not.toHaveProperty("options");
  });

  it("produces the same id for the same cell + suffix, deterministically", () => {
    const cell = percentagesTaxonomyCells[0]!;
    const family = percentagesPatternFamilies.find((f) => f.name === cell.patternFamilyName)!;
    const options = {
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      answerFormat: "multiple_choice" as const,
      idSuffix: "same"
    };
    const a = buildBlueprintFromCell(cell, family, options);
    const b = buildBlueprintFromCell(cell, family, options);
    expect(a.id).toBe(b.id);
  });

  it("scales difficulty dimensions upward for harder tiers", () => {
    const standardCell = percentagesTaxonomyCells.find((c) => c.difficultyTier === "standard")!;
    const extremeCell = percentagesTaxonomyCells.find((c) => c.difficultyTier === "extreme")!;
    const standardFamily = percentagesPatternFamilies.find((f) => f.name === standardCell.patternFamilyName)!;
    const extremeFamily = percentagesPatternFamilies.find((f) => f.name === extremeCell.patternFamilyName)!;
    const options = {
      examCode: "IPMAT_INDORE",
      sectionName: "Quant",
      chapterName: "Percentages",
      answerFormat: "multiple_choice" as const,
      idSuffix: "x"
    };
    const standardBlueprint = buildBlueprintFromCell(standardCell, standardFamily, options);
    const extremeBlueprint = buildBlueprintFromCell(extremeCell, extremeFamily, options);
    expect(extremeBlueprint.difficultyDimensions.conceptualLoad).toBeGreaterThan(
      standardBlueprint.difficultyDimensions.conceptualLoad
    );
  });
});
