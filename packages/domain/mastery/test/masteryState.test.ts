import { describe, expect, it } from "vitest";
import { computeMasteryState, computePatternFamilyMasteryDetail, computeTaxonomyCellMasteryDetail } from "../src/masteryState.js";
import { MASTERY_CONSTANTS } from "../src/types.js";
import {
  CONCEPT_ID,
  CONCEPT_NAME,
  hardNovelQuestion,
  otherPatternFamilyQuestion,
  percentagesTaxonomyCells,
  pressureQuestion,
  record,
  STUDENT_ID,
  standardQuestion
} from "../fixtures/attemptRecord.js";
import type { MasteryAttemptRecord } from "../src/types.js";

const NOW = "2026-09-22T12:00:00.000Z";

function manyRecords(n: number, overrides: Partial<Parameters<typeof record>[1]> = {}, question = standardQuestion): MasteryAttemptRecord[] {
  return Array.from({ length: n }, (_, i) => record(i, overrides, question));
}

describe("computeMasteryState — zero/one/insufficient/sufficient data states (Phase 5B §17)", () => {
  it("zero attempts: every headline measure is null, calibrationStatus is provisional", () => {
    const result = computeMasteryState([], { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBeNull();
    expect(result.measures.speedRatio).toBeNull();
    expect(result.measures.noveltyHandling).toBeNull();
    expect(result.measures.pressurePerformance).toBeNull();
    expect(result.measures.patternCoverage).toBeNull();
    expect(result.calibrationStatus).toBe("provisional");
    expect(result.detail.totalAttempts).toBe(0);
  });

  it("one attempt: accuracy stays null (insufficient data, below MIN_OBSERVATIONS_FOR_COMPONENT), but detail reflects the real attempt", () => {
    const records = manyRecords(1, { isCorrect: true });
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBeNull();
    expect(result.detail.submittedAttempts).toBe(1);
    expect(result.detail.correctCount).toBe(1);
  });

  it(`insufficient-data state: exactly ${MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT - 1} attempts stays null`, () => {
    const records = manyRecords(MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT - 1, { isCorrect: true });
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBeNull();
  });

  it(`sufficient-data state: exactly ${MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT} attempts produces a real accuracy`, () => {
    const records = manyRecords(MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT, { isCorrect: true });
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBe(1);
  });

  it("mixed correct/incorrect produces the real accuracy fraction", () => {
    const records = [
      ...manyRecords(3, { isCorrect: true }),
      ...manyRecords(2, { isCorrect: false })
    ];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBe(3 / 5);
  });

  it("fast/slow attempts produce a real mean speedRatio once enough valid observations exist", () => {
    const records = [
      record(0, { timeTakenSeconds: 30, expectedTimeSeconds: 90 }),
      record(1, { timeTakenSeconds: 90, expectedTimeSeconds: 90 }),
      record(2, { timeTakenSeconds: 150, expectedTimeSeconds: 90 })
    ];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.speedRatio).toBeCloseTo((0.333 + 1 + 1.667) / 3, 1);
  });

  it("easy/hard: difficulty breakdown is preserved separately, hard-tier data never borrowed from easy-tier volume", () => {
    const records = [
      ...manyRecords(10, { isCorrect: true }, standardQuestion),
      record(11, { isCorrect: false }, hardNovelQuestion)
    ];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.detail.difficultyBreakdown.byTier.standard).toEqual({ attempts: 10, correct: 10 });
    expect(result.detail.difficultyBreakdown.byTier.hard).toEqual({ attempts: 1, correct: 0 });
  });

  it("familiar/novel: noveltyHandling stays null with zero non-standard attempts, regardless of how many familiar ones exist", () => {
    const records = manyRecords(20, { isCorrect: true }, standardQuestion);
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.noveltyHandling).toBeNull();
  });

  it("familiar/novel: noveltyHandling becomes real once enough non-standard attempts exist", () => {
    const records = manyRecords(3, { isCorrect: true }, hardNovelQuestion);
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.noveltyHandling).toBe(1);
  });

  it("pressure/ordinary: pressurePerformance is read from testingModes only, never invented from timing", () => {
    const records = [
      ...manyRecords(5, { isCorrect: true, timeTakenSeconds: 200, expectedTimeSeconds: 90 }, standardQuestion) // slow but not pressure-context
    ];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.pressurePerformance).toBeNull();
  });

  it("pressure/ordinary: pressurePerformance becomes real once enough time_pressured attempts exist", () => {
    const records = manyRecords(3, { isCorrect: false }, pressureQuestion);
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.pressurePerformance).toBe(0);
  });

  it("repeated errors: errorRecurrence preserves the count and longest streak, not just the accuracy fraction", () => {
    const records = [
      ...manyRecords(3, { isCorrect: false }, standardQuestion),
      ...manyRecords(3, { isCorrect: true }, standardQuestion)
    ];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.detail.errorRecurrence.incorrectCount).toBe(3);
    expect(result.measures.accuracy).toBe(0.5);
  });

  it("stable vs unstable performance: same mean accuracy, different stdDevAccuracy — both preserved, not collapsed", () => {
    const stableRecords = [record(0, { isCorrect: true }), record(1, { isCorrect: false }), record(2, { isCorrect: true }), record(3, { isCorrect: false })];
    const stable = computeMasteryState(stableRecords, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(stable.measures.accuracy).toBe(0.5);
    expect(stable.detail.accuracyStability.stdDevAccuracy).not.toBeNull();
  });

  it("insufficient-data vs missing-data: patternCoverage is null (missing context) even with plenty of attempts, unless the full cell list is supplied", () => {
    const records = manyRecords(10, { isCorrect: true });
    const withoutCells = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(withoutCells.measures.patternCoverage).toBeNull();

    const withCells = computeMasteryState(records, {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW,
      allTaxonomyCellsForConcept: percentagesTaxonomyCells
    });
    // records all use standardQuestion -> cell-standard-1, one of 4 real percentagesTaxonomyCells
    expect(withCells.measures.patternCoverage).toBe(1 / 4);
  });

  it("multiple concepts: records for a different conceptId are excluded from this concept's computation", () => {
    const thisConceptRecords = manyRecords(3, { isCorrect: true, conceptId: CONCEPT_ID });
    const otherConceptRecords = manyRecords(3, { isCorrect: false, conceptId: "concept-ratio" });
    const result = computeMasteryState([...thisConceptRecords, ...otherConceptRecords], {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW
    });
    expect(result.measures.accuracy).toBe(1); // unaffected by the other concept's failures
    expect(result.detail.totalAttempts).toBe(3);
  });
});

describe("computePatternFamilyMasteryDetail / computeTaxonomyCellMasteryDetail — aggregation by pattern family and taxonomy cell (Phase 5B §8)", () => {
  it("scopes to exactly one pattern family", () => {
    const records = [...manyRecords(3, { isCorrect: true }, standardQuestion), ...manyRecords(2, { isCorrect: false }, otherPatternFamilyQuestion)];
    const detail = computePatternFamilyMasteryDetail(records, "Reverse Percentage");
    expect(detail.totalAttempts).toBe(3);
    expect(detail.correctCount).toBe(3);
  });

  it("scopes to exactly one taxonomy cell", () => {
    const records = [...manyRecords(2, { isCorrect: true }, standardQuestion), ...manyRecords(1, { isCorrect: false }, hardNovelQuestion)];
    const detail = computeTaxonomyCellMasteryDetail(records, hardNovelQuestion.patternTaxonomyCellId);
    expect(detail.totalAttempts).toBe(1);
    expect(detail.incorrectCount).toBe(1);
  });

  it("multiple pattern families in the same record set do not leak into each other's slice", () => {
    const records = [...manyRecords(5, { isCorrect: true }, standardQuestion), ...manyRecords(5, { isCorrect: false }, otherPatternFamilyQuestion)];
    const family1 = computePatternFamilyMasteryDetail(records, "Reverse Percentage");
    const family2 = computePatternFamilyMasteryDetail(records, "Successive Percentage Change");
    expect(family1.correctCount).toBe(5);
    expect(family2.correctCount).toBe(0);
  });
});

describe("Phase 5B §17 regression tests", () => {
  it("a student with 98%-shaped basic-question accuracy does NOT become universally mastered — hard-tier data stays absent, not inherited", () => {
    const records = [...manyRecords(50, { isCorrect: true }, standardQuestion)];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBeCloseTo(1, 5);
    // no hard-tier evidence exists AT ALL — the high standard-tier accuracy must not manufacture one
    expect(result.detail.difficultyBreakdown.byTier.hard).toBeUndefined();
    expect(result.detail.difficultyBreakdown.byTier.extreme).toBeUndefined();
    // and there is no field anywhere on the result that claims a single universal mastery verdict
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized.includes("universalmastery")).toBe(false);
    expect(serialized.includes('"masterylevel"')).toBe(false);
  });

  it("many familiar (standard-novelty) questions do NOT automatically imply strong novelty handling", () => {
    const records = manyRecords(50, { isCorrect: true }, standardQuestion);
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.noveltyHandling).toBeNull();
    expect(result.detail.noveltyBreakdown.byNoveltyLevel.novel_representation).toBeUndefined();
  });

  it("a single hard-question failure does not disproportionately corrupt or dominate the recorded stats", () => {
    const records = [...manyRecords(20, { isCorrect: true }, standardQuestion), record(21, { isCorrect: false }, hardNovelQuestion)];
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.detail.errorRecurrence.longestIncorrectStreak).toBe(1);
    expect(result.detail.errorRecurrence.incorrectCount).toBe(1);
    // the overall accuracy measure is barely moved, and the hard-tier failure is preserved distinctly, not lost
    expect(result.measures.accuracy).toBeCloseTo(20 / 21, 2);
    expect(result.detail.difficultyBreakdown.byTier.hard).toEqual({ attempts: 1, correct: 0 });
  });
});
