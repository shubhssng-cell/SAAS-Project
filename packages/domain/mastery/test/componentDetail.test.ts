import { describe, expect, it } from "vitest";
import { buildComponentDetail } from "../src/componentDetail.js";
import {
  hardNovelQuestion,
  otherPatternFamilyQuestion,
  pressureQuestion,
  record,
  standardQuestion
} from "../fixtures/attemptRecord.js";

describe("buildComponentDetail — the shared counting/statistics builder (Phase 5B §8)", () => {
  it("zero attempts: every count is 0, every statistic is null, nothing throws", () => {
    const detail = buildComponentDetail([]);
    expect(detail.totalAttempts).toBe(0);
    expect(detail.correctCount).toBe(0);
    expect(detail.speedStatistics.meanSpeedRatio).toBeNull();
    expect(detail.accuracyStability.meanAccuracy).toBeNull();
    expect(detail.accuracyStability.stdDevAccuracy).toBeNull();
    expect(detail.earliestAttemptAt).toBeNull();
    expect(detail.latestAttemptAt).toBeNull();
  });

  it("one attempt: counts reflect it, but stdDev (needs >=2) stays null", () => {
    const detail = buildComponentDetail([record(0, { isCorrect: true, timeTakenSeconds: 45, expectedTimeSeconds: 90 })]);
    expect(detail.totalAttempts).toBe(1);
    expect(detail.correctCount).toBe(1);
    expect(detail.accuracyStability.meanAccuracy).toBe(1);
    expect(detail.accuracyStability.stdDevAccuracy).toBeNull();
    expect(detail.speedStatistics.observationCount).toBe(1);
    expect(detail.speedStatistics.stdDevSpeedRatio).toBeNull();
  });

  it("distinguishes STABLE (67/67/67/67-shaped) from UNSTABLE (100/40/100/30-shaped) via stdDevAccuracy, even when means coincide", () => {
    // 4 attempts, 2 correct 2 incorrect either way -> same mean (0.5) but very different patterns
    const stable = buildComponentDetail([
      record(0, { isCorrect: true }),
      record(1, { isCorrect: false }),
      record(2, { isCorrect: true }),
      record(3, { isCorrect: false })
    ]);
    const unstable = buildComponentDetail([
      record(0, { isCorrect: true }),
      record(1, { isCorrect: true }),
      record(2, { isCorrect: false }),
      record(3, { isCorrect: false })
    ]);
    expect(stable.accuracyStability.meanAccuracy).toBe(0.5);
    expect(unstable.accuracyStability.meanAccuracy).toBe(0.5);
    // both have stdDev 0.5 for strict alternation vs block pattern at n=4, p=0.5 — same stdDev in THIS
    // specific case (population stdDev only depends on the multiset of 0/1 values, not their order) —
    // what differs and IS preserved is the exact ordered sequence and the longest incorrect streak:
    expect(stable.errorRecurrence.longestIncorrectStreak).toBe(1);
    expect(unstable.errorRecurrence.longestIncorrectStreak).toBe(2);
    expect(stable.accuracyStability.sequence).toEqual([true, false, true, false]);
    expect(unstable.accuracyStability.sequence).toEqual([true, true, false, false]);
  });

  it("a genuinely more erratic sequence (100,40,100,30-shaped: 3 correct, 1 incorrect vs 2/2) has a different stdDev than an even split", () => {
    const threeOne = buildComponentDetail([
      record(0, { isCorrect: true }),
      record(1, { isCorrect: false }),
      record(2, { isCorrect: true }),
      record(3, { isCorrect: true })
    ]);
    const twoTwo = buildComponentDetail([
      record(0, { isCorrect: true }),
      record(1, { isCorrect: false }),
      record(2, { isCorrect: true }),
      record(3, { isCorrect: false })
    ]);
    expect(threeOne.accuracyStability.meanAccuracy).not.toBe(twoTwo.accuracyStability.meanAccuracy);
    expect(threeOne.accuracyStability.stdDevAccuracy).not.toBe(twoTwo.accuracyStability.stdDevAccuracy);
  });

  it("speed statistics: fast and slow attempts both contribute to mean/min/max", () => {
    const detail = buildComponentDetail([
      record(0, { timeTakenSeconds: 30, expectedTimeSeconds: 90 }), // 0.33
      record(1, { timeTakenSeconds: 180, expectedTimeSeconds: 90 }) // 2.0
    ]);
    expect(detail.speedStatistics.observationCount).toBe(2);
    expect(detail.speedStatistics.minSpeedRatio).toBeCloseTo(0.333, 2);
    expect(detail.speedStatistics.maxSpeedRatio).toBe(2);
    expect(detail.speedStatistics.meanSpeedRatio).toBeCloseTo((0.333 + 2) / 2, 2);
  });

  it("missing/invalid time data is excluded from speed statistics, not coerced to a fake ratio", () => {
    const detail = buildComponentDetail([
      record(0, { timeTakenSeconds: null, expectedTimeSeconds: 90 }),
      record(1, { timeTakenSeconds: 60, expectedTimeSeconds: 0 }),
      record(2, { timeTakenSeconds: 60, expectedTimeSeconds: 90 })
    ]);
    expect(detail.speedStatistics.observationCount).toBe(1);
  });

  it("difficulty breakdown: only tiers actually attempted appear as keys", () => {
    const detail = buildComponentDetail([record(0, { isCorrect: true }, standardQuestion), record(1, { isCorrect: false }, hardNovelQuestion)]);
    expect(detail.difficultyBreakdown.byTier.standard).toEqual({ attempts: 1, correct: 1 });
    expect(detail.difficultyBreakdown.byTier.hard).toEqual({ attempts: 1, correct: 0 });
    expect(detail.difficultyBreakdown.byTier.extreme).toBeUndefined();
  });

  it("novelty breakdown separates standard from novel_representation", () => {
    const detail = buildComponentDetail([record(0, { isCorrect: true }, standardQuestion), record(1, { isCorrect: true }, hardNovelQuestion)]);
    expect(detail.noveltyBreakdown.byNoveltyLevel.standard?.attempts).toBe(1);
    expect(detail.noveltyBreakdown.byNoveltyLevel.novel_representation?.attempts).toBe(1);
  });

  it("pressure breakdown is read from testingModes, not inferred from timing", () => {
    const detail = buildComponentDetail([
      record(0, { isCorrect: true, timeTakenSeconds: 200, expectedTimeSeconds: 90 }, standardQuestion), // slow, but NOT a pressure question
      record(1, { isCorrect: true, timeTakenSeconds: 30, expectedTimeSeconds: 90 }, pressureQuestion) // fast, but IS a pressure question
    ]);
    expect(detail.pressureBreakdown.ordinaryAttempts).toBe(1);
    expect(detail.pressureBreakdown.pressureAttempts).toBe(1);
    expect(detail.pressureBreakdown.pressureCorrect).toBe(1);
  });

  it("error recurrence: longest incorrect streak across a mixed sequence", () => {
    const detail = buildComponentDetail([
      record(0, { isCorrect: false }),
      record(1, { isCorrect: false }),
      record(2, { isCorrect: false }),
      record(3, { isCorrect: true }),
      record(4, { isCorrect: false })
    ]);
    expect(detail.errorRecurrence.incorrectCount).toBe(4);
    expect(detail.errorRecurrence.longestIncorrectStreak).toBe(3);
  });

  it("multiple pattern families and taxonomy cells are all captured in coverage.encountered lists", () => {
    const detail = buildComponentDetail([
      record(0, {}, standardQuestion),
      record(1, {}, hardNovelQuestion),
      record(2, {}, otherPatternFamilyQuestion)
    ]);
    expect(detail.coverage.patternFamiliesEncountered.sort()).toEqual(["Reverse Percentage", "Successive Percentage Change"].sort());
    expect(detail.coverage.taxonomyCellsEncountered).toHaveLength(3);
  });

  it("skipped and abandoned attempts are counted separately from submitted, and excluded from accuracy", () => {
    const detail = buildComponentDetail([
      record(0, { status: "submitted", isCorrect: true }),
      record(1, { status: "skipped", isCorrect: null }),
      record(2, { status: "abandoned", isCorrect: null })
    ]);
    expect(detail.totalAttempts).toBe(3);
    expect(detail.submittedAttempts).toBe(1);
    expect(detail.skippedAttempts).toBe(1);
    expect(detail.abandonedAttempts).toBe(1);
    expect(detail.accuracyStability.sequence).toEqual([true]);
  });

  it("preserves earliest/latest attempt timestamps and the full ordered attempt-id sequence for a future recency-aware pass", () => {
    const detail = buildComponentDetail([record(5), record(0), record(10)]);
    expect(detail.earliestAttemptAt).toBe(new Date(Date.parse("2026-09-22T10:00:00.000Z")).toISOString());
    expect(detail.latestAttemptAt).toBe(new Date(Date.parse("2026-09-22T10:10:00.000Z")).toISOString());
    expect(detail.contributingAttemptIds).toHaveLength(3);
  });
});
