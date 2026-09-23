import { describe, expect, it } from "vitest";
import { deriveBlockProgress } from "../src/progress.js";
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

describe("deriveBlockProgress", () => {
  it("targetReached is false when no target was configured, regardless of attempt count", () => {
    expect(deriveBlockProgress(makeBlock({ targetQuestionCount: null }), 50).targetReached).toBe(false);
  });

  it("targetReached is false while under the target", () => {
    expect(deriveBlockProgress(makeBlock({ targetQuestionCount: 10 }), 5).targetReached).toBe(false);
  });

  it("targetReached is true exactly at the target", () => {
    expect(deriveBlockProgress(makeBlock({ targetQuestionCount: 10 }), 10).targetReached).toBe(true);
  });

  it("targetReached is true beyond the target (never caps attemptCount)", () => {
    const progress = deriveBlockProgress(makeBlock({ targetQuestionCount: 10 }), 15);
    expect(progress.targetReached).toBe(true);
    expect(progress.attemptCount).toBe(15);
  });

  it("is always a fresh computation, never a stored field on PracticeBlockState -- reflects the caller's own attemptCount input", () => {
    const block = makeBlock({ targetQuestionCount: 3 });
    expect(deriveBlockProgress(block, 0).targetReached).toBe(false);
    expect(deriveBlockProgress(block, 3).targetReached).toBe(true);
  });
});
