import type { BehaviorSignals } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { applyOveruseAvoidance, detectSpeedProblem, pickWinner } from "../src/tieBreak.js";
import { makeCandidate } from "./fixtures.js";

function signals(overrides: Partial<BehaviorSignals> = {}): BehaviorSignals {
  return {
    speedRatio: null,
    correctFast: false,
    correctSlow: false,
    incorrectFast: false,
    incorrectSlow: false,
    answerChanged: false,
    multipleAnswerChanges: false,
    hintUsed: false,
    solutionOpened: false,
    skipped: false,
    noAnswer: false,
    timeAboveExpected: false,
    timeBelowExpected: false,
    ...overrides
  };
}

describe("detectSpeedProblem — reuses AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO, never a second invented number", () => {
  it("false when no signals supplied", () => {
    expect(detectSpeedProblem(null)).toBe(false);
    expect(detectSpeedProblem(undefined)).toBe(false);
  });

  it("true when incorrectSlow is flagged", () => {
    expect(detectSpeedProblem(signals({ incorrectSlow: true }))).toBe(true);
  });

  it("true when correctSlow is flagged", () => {
    expect(detectSpeedProblem(signals({ correctSlow: true }))).toBe(true);
  });

  it("true when speedRatio itself is at/above the slow threshold even if the boolean flags weren't set", () => {
    expect(detectSpeedProblem(signals({ speedRatio: 1.3 }))).toBe(true);
  });

  it("false for a normal-paced attempt", () => {
    expect(detectSpeedProblem(signals({ speedRatio: 1.0 }))).toBe(false);
  });
});

describe("applyOveruseAvoidance — avoided only when enough alternatives exist (point O)", () => {
  it("filters out a candidate attempted at/above the overuse threshold when an alternative exists", () => {
    const a = makeCandidate();
    const b = makeCandidate();
    const result = applyOveruseAvoidance([a, b], [{ questionId: a.question.questionId, attemptCount: 2 }]);
    expect(result).toEqual([b]);
  });

  it("keeps the overused candidate when it is the ONLY one available (never empties the pool)", () => {
    const a = makeCandidate();
    const result = applyOveruseAvoidance([a], [{ questionId: a.question.questionId, attemptCount: 5 }]);
    expect(result).toEqual([a]);
  });

  it("a candidate below the overuse threshold is never filtered", () => {
    const a = makeCandidate();
    const b = makeCandidate();
    const result = applyOveruseAvoidance([a, b], [{ questionId: a.question.questionId, attemptCount: 1 }]);
    expect(result).toEqual([a, b]);
  });
});

describe("pickWinner — deterministic tie-breaking (point N), fixed priority order, never a weighted score", () => {
  it("prefers the shorter expectedTimeSeconds when a speed problem was detected", () => {
    const slowQuestion = makeCandidate({ expectedTimeSeconds: 120 });
    const fastQuestion = makeCandidate({ expectedTimeSeconds: 60 });
    const winner = pickWinner([slowQuestion, fastQuestion], { speedProblem: true });
    expect(winner).toBe(fastQuestion);
  });

  it("ignores expectedTimeSeconds when no speed problem was detected, falling through to difficulty/questionId", () => {
    const a = makeCandidate({ expectedTimeSeconds: 120, difficultyTier: "advanced" });
    const b = makeCandidate({ expectedTimeSeconds: 60, difficultyTier: "advanced" });
    // With no speed problem and equal difficulty, questionId is the only remaining tie-break.
    const winner = pickWinner([a, b], { speedProblem: false });
    const expected = [a, b].sort((x, y) => x.question.questionId.localeCompare(y.question.questionId))[0];
    expect(winner).toBe(expected);
  });

  it("prefers the candidate whose difficultyTier is closer to the target tier", () => {
    const far = makeCandidate({ difficultyTier: "novel" });
    const close = makeCandidate({ difficultyTier: "advanced" });
    const winner = pickWinner([far, close], { speedProblem: false, targetDifficultyTier: "hard" });
    expect(winner).toBe(close);
  });

  it("is fully deterministic: repeated calls on the same pool produce the same winner", () => {
    const pool = [makeCandidate(), makeCandidate(), makeCandidate()];
    const first = pickWinner(pool, { speedProblem: false });
    const second = pickWinner(pool, { speedProblem: false });
    expect(second).toBe(first);
  });

  it("throws on an empty pool rather than silently returning undefined", () => {
    expect(() => pickWinner([], { speedProblem: false })).toThrow(/empty candidate pool/);
  });
});
