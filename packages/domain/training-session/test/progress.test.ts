import type { PracticeBlockState } from "@ipmat/practice-block";
import { describe, expect, it } from "vitest";
import { deriveTrainingSessionProgress } from "../src/progress.js";

const T0 = "2026-10-01T10:00:00.000Z";

function block(overrides: Partial<PracticeBlockState> = {}): PracticeBlockState {
  return { id: "b1", practiceSessionId: "s1", sequenceNumber: 1, status: "active", startedAt: T0, endedAt: null, targetQuestionCount: 3, blockTimeBudgetSeconds: null, ...overrides };
}

describe("training session progress -- derived on every read", () => {
  it("counts submitted and skipped as completed, never abandoned or in_progress", () => {
    const progress = deriveTrainingSessionProgress({
      block: block(),
      attempts: [
        { id: "a1", status: "submitted" },
        { id: "a2", status: "skipped" },
        { id: "a3", status: "abandoned" },
        { id: "a4", status: "in_progress" }
      ],
      now: T0
    });
    expect(progress).toMatchObject({ completedQuestionCount: 2, submittedCount: 1, skippedCount: 1, openAttemptId: "a4", remainingQuestions: 1, completionReached: false });
  });

  it("fixed question count: reached exactly at the target", () => {
    const attempts = ["a1", "a2", "a3"].map((id) => ({ id, status: "submitted" as const }));
    expect(deriveTrainingSessionProgress({ block: block(), attempts: attempts.slice(0, 2), now: T0 }).completionReached).toBe(false);
    expect(deriveTrainingSessionProgress({ block: block(), attempts, now: T0 })).toMatchObject({ completionReached: true, remainingQuestions: 0 });
  });

  it("fixed duration: reached from the SERVER-supplied clock, never an attempt count", () => {
    const timed = block({ targetQuestionCount: null, blockTimeBudgetSeconds: 600 });
    expect(deriveTrainingSessionProgress({ block: timed, attempts: [], now: "2026-10-01T10:09:59.000Z" })).toMatchObject({ elapsedSeconds: 599, remainingSeconds: 1, completionReached: false });
    expect(deriveTrainingSessionProgress({ block: timed, attempts: [], now: "2026-10-01T10:10:00.000Z" })).toMatchObject({ elapsedSeconds: 600, remainingSeconds: 0, completionReached: true });
    expect(deriveTrainingSessionProgress({ block: timed, attempts: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, status: "submitted" as const })), now: T0 }).completionReached).toBe(false);
  });

  it("a finalized session's elapsed time stops at its end, not at `now`", () => {
    const ended = block({ status: "completed", endedAt: "2026-10-01T10:05:00.000Z" });
    expect(deriveTrainingSessionProgress({ block: ended, attempts: [], now: "2026-10-02T00:00:00.000Z" })).toMatchObject({ status: "completed", elapsedSeconds: 300 });
  });

  it("the same persisted facts always give the same progress (deterministic reconstruction)", () => {
    const input = { block: block(), attempts: [{ id: "a1", status: "submitted" as const }], now: "2026-10-01T10:01:00.000Z" };
    expect(deriveTrainingSessionProgress(input)).toEqual(deriveTrainingSessionProgress({ ...input, attempts: [...input.attempts] }));
  });
});
