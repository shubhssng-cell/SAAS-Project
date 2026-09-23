import { describe, expect, it } from "vitest";
import { deriveSessionActiveSolvingTimeSeconds, deriveSessionWallClockDurationSeconds } from "../src/time.js";
import type { PracticeSessionState } from "../src/types.js";

describe("deriveSessionWallClockDurationSeconds", () => {
  it("returns null while the session has no endedAt", () => {
    const session: PracticeSessionState = {
      id: "s1",
      enrollmentId: "e1",
      status: "active",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
      sessionTimeBudgetSeconds: null
    };
    expect(deriveSessionWallClockDurationSeconds(session)).toBeNull();
  });

  it("computes endedAt - startedAt in whole seconds", () => {
    const session: PracticeSessionState = {
      id: "s1",
      enrollmentId: "e1",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:30:00.000Z",
      sessionTimeBudgetSeconds: null
    };
    expect(deriveSessionWallClockDurationSeconds(session)).toBe(1800);
  });
});

describe("deriveSessionActiveSolvingTimeSeconds", () => {
  it("sums timeSpentSeconds across attempts", () => {
    expect(deriveSessionActiveSolvingTimeSeconds([{ timeSpentSeconds: 30 }, { timeSpentSeconds: 45 }, { timeSpentSeconds: 60 }])).toBe(135);
  });

  it("treats a still-in_progress attempt (null timeSpentSeconds) as contributing 0", () => {
    expect(deriveSessionActiveSolvingTimeSeconds([{ timeSpentSeconds: 30 }, { timeSpentSeconds: null }])).toBe(30);
  });

  it("returns 0 for an empty attempt list", () => {
    expect(deriveSessionActiveSolvingTimeSeconds([])).toBe(0);
  });

  it("never asserts a relationship with wall-clock duration -- a session can have idle time with equal solving time regardless of duration", () => {
    // A duration of 1800s with only 60s of active solving time is a legitimate, unrelated combination.
    const session: PracticeSessionState = {
      id: "s1",
      enrollmentId: "e1",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:30:00.000Z",
      sessionTimeBudgetSeconds: null
    };
    const duration = deriveSessionWallClockDurationSeconds(session);
    const solving = deriveSessionActiveSolvingTimeSeconds([{ timeSpentSeconds: 60 }]);
    expect(duration).toBe(1800);
    expect(solving).toBe(60);
  });
});
