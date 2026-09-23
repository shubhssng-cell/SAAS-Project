import { describe, expect, it } from "vitest";
import { deriveBlockActiveSolvingTimeSeconds, deriveBlockWallClockDurationSeconds, deriveInterAttemptGapsSeconds } from "../src/time.js";
import type { PracticeBlockState } from "../src/types.js";

function makeBlock(overrides: Partial<PracticeBlockState> = {}): PracticeBlockState {
  return {
    id: "b1",
    practiceSessionId: "s1",
    sequenceNumber: 1,
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    targetQuestionCount: null,
    blockTimeBudgetSeconds: null,
    ...overrides
  };
}

describe("deriveBlockWallClockDurationSeconds", () => {
  it("returns null while active (no endedAt)", () => {
    expect(deriveBlockWallClockDurationSeconds(makeBlock())).toBeNull();
  });

  it("computes endedAt - startedAt in whole seconds", () => {
    const block = makeBlock({ endedAt: "2026-01-01T00:10:00.000Z" });
    expect(deriveBlockWallClockDurationSeconds(block)).toBe(600);
  });
});

describe("deriveBlockActiveSolvingTimeSeconds", () => {
  it("sums timeSpentSeconds, treating null (in_progress) as 0", () => {
    expect(deriveBlockActiveSolvingTimeSeconds([{ timeSpentSeconds: 20 }, { timeSpentSeconds: null }, { timeSpentSeconds: 40 }])).toBe(60);
  });

  it("returns 0 for no attempts", () => {
    expect(deriveBlockActiveSolvingTimeSeconds([])).toBe(0);
  });
});

describe("deriveInterAttemptGapsSeconds", () => {
  it("computes the gap between consecutive attempts ordered by blockSequenceNumber", () => {
    const gaps = deriveInterAttemptGapsSeconds([
      { blockSequenceNumber: 1, startedAt: "2026-01-01T00:00:00.000Z", finalizedAt: "2026-01-01T00:01:00.000Z" },
      { blockSequenceNumber: 2, startedAt: "2026-01-01T00:01:30.000Z", finalizedAt: "2026-01-01T00:02:30.000Z" },
      { blockSequenceNumber: 3, startedAt: "2026-01-01T00:03:00.000Z", finalizedAt: null }
    ]);
    // gap 1->2: 00:01:30 - 00:01:00 = 30s; gap 2->3: 00:03:00 - 00:02:30 = 30s
    expect(gaps).toEqual([30, 30]);
  });

  it("is computed correctly regardless of input array order -- sorts by blockSequenceNumber first", () => {
    const outOfOrder = deriveInterAttemptGapsSeconds([
      { blockSequenceNumber: 2, startedAt: "2026-01-01T00:01:30.000Z", finalizedAt: "2026-01-01T00:02:30.000Z" },
      { blockSequenceNumber: 1, startedAt: "2026-01-01T00:00:00.000Z", finalizedAt: "2026-01-01T00:01:00.000Z" }
    ]);
    expect(outOfOrder).toEqual([30]);
  });

  it("omits (never zero-fills) a gap where the earlier attempt was never finalized", () => {
    const gaps = deriveInterAttemptGapsSeconds([
      { blockSequenceNumber: 1, startedAt: "2026-01-01T00:00:00.000Z", finalizedAt: null },
      { blockSequenceNumber: 2, startedAt: "2026-01-01T00:01:30.000Z", finalizedAt: "2026-01-01T00:02:30.000Z" }
    ]);
    expect(gaps).toEqual([]);
  });

  it("returns an empty array for 0 or 1 attempts -- no pair to compute a gap from", () => {
    expect(deriveInterAttemptGapsSeconds([])).toEqual([]);
    expect(deriveInterAttemptGapsSeconds([{ blockSequenceNumber: 1, startedAt: "2026-01-01T00:00:00.000Z", finalizedAt: "2026-01-01T00:01:00.000Z" }])).toEqual([]);
  });
});
