import { describe, expect, it } from "vitest";
import { computeMedian, deriveBlockPressureEvidence, splitHalves } from "../src/blockEvidence.js";
import { makeAttemptRecord, makeBlockContext } from "./fixtures.js";

describe("computeMedian", () => {
  it("empty array -> null", () => {
    expect(computeMedian([])).toBeNull();
  });
  it("single value -> that value", () => {
    expect(computeMedian([7])).toBe(7);
  });
  it("odd length -> the middle element after sorting", () => {
    expect(computeMedian([9, 1, 5])).toBe(5);
  });
  it("even length -> arithmetic mean of the two middle elements after sorting", () => {
    expect(computeMedian([3, 4])).toBe(3.5);
    expect(computeMedian([10, 1, 4, 3])).toBe(3.5); // sorted [1,3,4,10] -> (3+4)/2
  });
  it("never mutates the caller's input array", () => {
    const input = [5, 1, 3];
    computeMedian(input);
    expect(input).toEqual([5, 1, 3]);
  });
  it("does not assume the input is pre-sorted", () => {
    expect(computeMedian([100, 1, 2])).toBe(2);
  });
});

describe("splitHalves", () => {
  it("even length: no overlap, no exclusion", () => {
    const { firstHalf, secondHalf } = splitHalves(["a", "b", "c", "d"]);
    expect(firstHalf).toEqual(["a", "b"]);
    expect(secondHalf).toEqual(["c", "d"]);
  });
  it("odd length: the middle item belongs to neither half", () => {
    const { firstHalf, secondHalf } = splitHalves(["a", "b", "c"]);
    expect(firstHalf).toEqual(["a"]);
    expect(secondHalf).toEqual(["c"]);
  });
  it("length 5: two on each side, one excluded middle", () => {
    const { firstHalf, secondHalf } = splitHalves(["a", "b", "c", "d", "e"]);
    expect(firstHalf).toEqual(["a", "b"]);
    expect(secondHalf).toEqual(["d", "e"]);
  });
  it("length 0 or 1: both halves empty", () => {
    expect(splitHalves([])).toEqual({ firstHalf: [], secondHalf: [] });
    expect(splitHalves(["a"])).toEqual({ firstHalf: [], secondHalf: [] });
  });
});

describe("deriveBlockPressureEvidence -- accuracy computation", () => {
  it("hint-assisted attempts DO count toward accuracy", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, hintsUsed: 3, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.firstHalfAccuracy).toBe(1); // a1 alone, hint-assisted, still correct and counted
  });

  it("skipped attempts never count in the accuracy numerator or denominator", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", status: "skipped", isCorrect: null, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: false, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.firstHalfAccuracy).toBeNull(); // a1 (skipped) is the only member of the first half -- zero qualifying attempts
    expect(evidence?.secondHalfAccuracy).toBe(0); // a3 alone, incorrect
  });

  it("abandoned attempts never count in the accuracy numerator or denominator", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", status: "abandoned", isCorrect: null, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.firstHalfAccuracy).toBeNull();
  });

  it("zero qualifying attempts in a half -> that half's accuracy is null (never coerced to 0 or 1)", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", status: "skipped", isCorrect: null, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", status: "abandoned", isCorrect: null, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.firstHalfAccuracy).toBeNull();
    expect(evidence?.triggeredDimensions).not.toContain("within_block_degradation"); // not computable, so it cannot trigger
  });

  it("exact numerator/denominator over multiple qualifying attempts per half", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: false, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" }),
      makeAttemptRecord({ attemptId: "a4", isCorrect: false, finalizedAt: "2026-01-01T00:03:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3", "a4"] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.firstHalfAccuracy).toBe(0.5); // a1 correct, a2 incorrect
    expect(evidence?.secondHalfAccuracy).toBe(0.5); // a3 correct, a4 incorrect
  });
});

describe("deriveBlockPressureEvidence -- Block Evidence Validation (all 9 rules)", () => {
  const baseAttempts = [
    makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:00:00.000Z" }),
    makeAttemptRecord({ attemptId: "a2", finalizedAt: "2026-01-01T00:01:00.000Z" }),
    makeAttemptRecord({ attemptId: "a3", finalizedAt: "2026-01-01T00:02:00.000Z" })
  ];

  it("1. attemptIdsInOrder.length === 0 -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: [] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("2. duplicate attempt IDs -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a1"] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("3. an attempt ID missing from context.attemptRecords -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "does-not-exist"] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("4. resolved non-null finalizedAt timestamps not non-decreasing in order -> invalid", () => {
    const outOfOrder = [
      makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:05:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", finalizedAt: "2026-01-01T00:01:00.000Z" }), // earlier than a1 -- contradicts claimed order
      makeAttemptRecord({ attemptId: "a3", finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    expect(deriveBlockPressureEvidence(block, outOfOrder)).toBeNull();
  });

  it("4b. a null finalizedAt (still in_progress-derived) is skipped by the ordering check, not treated as a violation", () => {
    const withInProgress = [
      makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", finalizedAt: null }),
      makeAttemptRecord({ attemptId: "a3", finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    expect(deriveBlockPressureEvidence(block, withInProgress)).not.toBeNull();
  });

  it("5a. interAttemptGapsSeconds contains a non-finite value -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], interAttemptGapsSeconds: [30, Number.NaN] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("5b. interAttemptGapsSeconds contains a negative value -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], interAttemptGapsSeconds: [30, -5] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("5c. interAttemptGapsSeconds longer than attemptIdsInOrder.length - 1 -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], interAttemptGapsSeconds: [30, 30, 30] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("5d. interAttemptGapsSeconds shorter than the upper bound is valid (an unfinalized pair may omit a gap)", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], interAttemptGapsSeconds: [30] });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).not.toBeNull();
  });

  it("6. activeSolvingTimeSeconds non-finite -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], activeSolvingTimeSeconds: Number.POSITIVE_INFINITY });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("6b. activeSolvingTimeSeconds negative -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], activeSolvingTimeSeconds: -1 });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("7. wallClockDurationSeconds non-null but non-finite -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], wallClockDurationSeconds: Number.NaN });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("7b. wallClockDurationSeconds negative -> invalid", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], wallClockDurationSeconds: -1 });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).toBeNull();
  });

  it("7c. wallClockDurationSeconds === null is always valid (block still active) and never blocks evaluation", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], wallClockDurationSeconds: null });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).not.toBeNull();
  });

  it("8. blockTimeBudgetSeconds zero/negative/NaN disables ONLY the budget dimension, never invalidates the whole block", () => {
    for (const badBudget of [0, -100, Number.NaN]) {
      const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], blockTimeBudgetSeconds: badBudget, activeSolvingTimeSeconds: 999999 });
      const evidence = deriveBlockPressureEvidence(block, baseAttempts);
      expect(evidence).not.toBeNull();
      expect(evidence?.triggeredDimensions).not.toContain("budget_consumption");
    }
  });

  it("9. targetQuestionCount is never validated or used -- an arbitrary value never invalidates the block", () => {
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], targetQuestionCount: -999 });
    expect(deriveBlockPressureEvidence(block, baseAttempts)).not.toBeNull();
  });

  it("an invalid block never throws, and does not affect evaluation of other blocks (proven at the applicability level in applicability.test.ts)", () => {
    const block = makeBlockContext({ attemptIdsInOrder: [] });
    expect(() => deriveBlockPressureEvidence(block, baseAttempts)).not.toThrow();
  });
});

describe("deriveBlockPressureEvidence -- qualifying-block minimum size", () => {
  it("fewer than 3 attempts -> not qualifying, contributes nothing", () => {
    const attempts = [makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:00:00.000Z" }), makeAttemptRecord({ attemptId: "a2", finalizedAt: "2026-01-01T00:01:00.000Z" })];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2"] });
    expect(deriveBlockPressureEvidence(block, attempts)).toBeNull();
  });

  it("exactly 3 attempts -> qualifies", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"] });
    expect(deriveBlockPressureEvidence(block, attempts)).not.toBeNull();
  });
});

describe("deriveBlockPressureEvidence -- concept attribution", () => {
  const idsFor = (attempts: ReturnType<typeof makeAttemptRecord>[]) => attempts.map((a) => a.contribution.attemptId);

  it("strict majority concept is attributed", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", conceptName: "Percentages", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", conceptName: "Percentages", finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", conceptName: "Ratio", finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: idsFor(attempts) });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.conceptName).toBe("Percentages");
  });

  it("no strict majority (an even split) -> block ignored (no evidence produced)", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", conceptName: "Percentages", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", conceptName: "Percentages", finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", conceptName: "Ratio", finalizedAt: "2026-01-01T00:02:00.000Z" }),
      makeAttemptRecord({ attemptId: "a4", conceptName: "Ratio", finalizedAt: "2026-01-01T00:03:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: idsFor(attempts) });
    expect(deriveBlockPressureEvidence(block, attempts)).toBeNull();
  });

  it("100% single-concept block (the current one-chapter MVP's real shape) is attributed trivially", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: idsFor(attempts) });
    expect(deriveBlockPressureEvidence(block, attempts)?.conceptName).toBe("Percentages");
  });
});

describe("deriveBlockPressureEvidence -- the three trigger dimensions (worked examples from D-061)", () => {
  it("Example 1: reduced_recovery triggers, degradation does not", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:00:33.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:01:07.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], interAttemptGapsSeconds: [3, 4] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.medianGapSeconds).toBe(3.5);
    expect(evidence?.triggeredDimensions).toEqual(["reduced_recovery"]);
  });

  it("Example 2: within_block_degradation triggers, reduced_recovery does not", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" }),
      makeAttemptRecord({ attemptId: "a4", isCorrect: false, finalizedAt: "2026-01-01T00:03:00.000Z" }),
      makeAttemptRecord({ attemptId: "a5", isCorrect: false, finalizedAt: "2026-01-01T00:04:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3", "a4", "a5"], interAttemptGapsSeconds: [10, 10, 10, 10] });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.firstHalfAccuracy).toBe(1);
    expect(evidence?.secondHalfAccuracy).toBe(0);
    expect(evidence?.triggeredDimensions).toEqual(["within_block_degradation"]);
  });

  it("Example 3: budget_consumption triggers, independent of gaps/accuracy", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({
      attemptIdsInOrder: ["a1", "a2", "a3"],
      interAttemptGapsSeconds: [30, 30],
      blockTimeBudgetSeconds: 300,
      activeSolvingTimeSeconds: 310
    });
    const evidence = deriveBlockPressureEvidence(block, attempts);
    expect(evidence?.triggeredDimensions).toEqual(["budget_consumption"]);
  });

  it("budget consumption CAN trigger on a still-active block (wallClockDurationSeconds === null)", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({
      attemptIdsInOrder: ["a1", "a2", "a3"],
      wallClockDurationSeconds: null,
      blockTimeBudgetSeconds: 100,
      activeSolvingTimeSeconds: 150
    });
    expect(deriveBlockPressureEvidence(block, attempts)?.triggeredDimensions).toContain("budget_consumption");
  });

  it("activeSolvingTimeSeconds may exceed budget with no cap and still triggers", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], blockTimeBudgetSeconds: 100, activeSolvingTimeSeconds: 100_000 });
    expect(deriveBlockPressureEvidence(block, attempts)?.triggeredDimensions).toContain("budget_consumption");
  });

  it("does NOT qualify: no dimension triggers when gaps are wide, accuracy is stable, and no budget is configured", () => {
    const attempts = [
      makeAttemptRecord({ attemptId: "a1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "a2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "a3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" })
    ];
    const block = makeBlockContext({ attemptIdsInOrder: ["a1", "a2", "a3"], interAttemptGapsSeconds: [30, 30] });
    expect(deriveBlockPressureEvidence(block, attempts)?.triggeredDimensions).toEqual([]);
  });
});
