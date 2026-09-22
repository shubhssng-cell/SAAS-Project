import { describe, expect, it } from "vitest";
import { deriveBehaviorSignals } from "../src/behaviorSignals.js";
import { buildEvidence } from "../fixtures/evidence.js";

describe("deriveBehaviorSignals — deterministic, question-time-aware signals (Phase 5A §2)", () => {
  it("correct + fast: isCorrect true, speedRatio well under expected", () => {
    const evidence = buildEvidence({ isCorrect: true, timeTakenSeconds: 30, expectedTimeSeconds: 90 }); // ratio 0.33
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.correctFast).toBe(true);
    expect(signals.correctSlow).toBe(false);
    expect(signals.incorrectFast).toBe(false);
    expect(signals.incorrectSlow).toBe(false);
  });

  it("correct + slow: isCorrect true, speedRatio well over expected", () => {
    const evidence = buildEvidence({ isCorrect: true, timeTakenSeconds: 150, expectedTimeSeconds: 90 }); // ratio 1.67
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.correctSlow).toBe(true);
    expect(signals.correctFast).toBe(false);
  });

  it("incorrect + fast", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420", timeTakenSeconds: 20, expectedTimeSeconds: 90 });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.incorrectFast).toBe(true);
    expect(signals.incorrectSlow).toBe(false);
  });

  it("incorrect + slow", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420", timeTakenSeconds: 200, expectedTimeSeconds: 90 });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.incorrectSlow).toBe(true);
    expect(signals.incorrectFast).toBe(false);
  });

  it("answer changed once: answerChanged true, multipleAnswerChanges false", () => {
    const evidence = buildEvidence({
      answerChangeHistory: { initialAnswer: "420", finalAnswer: "480", changeCount: 1, sequence: [] }
    });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.answerChanged).toBe(true);
    expect(signals.multipleAnswerChanges).toBe(false);
  });

  it("multiple answer changes: both true", () => {
    const evidence = buildEvidence({
      answerChangeHistory: { initialAnswer: "420", finalAnswer: "500", changeCount: 3, sequence: [] }
    });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.answerChanged).toBe(true);
    expect(signals.multipleAnswerChanges).toBe(true);
  });

  it("hint usage sets hintUsed", () => {
    const evidence = buildEvidence({ hintsUsed: 2 });
    expect(deriveBehaviorSignals(evidence).hintUsed).toBe(true);
  });

  it("solution usage sets solutionOpened", () => {
    const evidence = buildEvidence({ solutionOpenedAt: "2026-09-22T10:01:00.000Z" });
    expect(deriveBehaviorSignals(evidence).solutionOpened).toBe(true);
  });

  it("skipped attempt: skipped true, noAnswer true, correctness signals all false", () => {
    const evidence = buildEvidence({ status: "skipped", skipped: true, finalAnswer: null, isCorrect: null, timeTakenSeconds: 20 });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.skipped).toBe(true);
    expect(signals.noAnswer).toBe(true);
    expect(signals.correctFast).toBe(false);
    expect(signals.incorrectFast).toBe(false);
  });

  it("unanswered/abandoned attempt: noAnswer true, skipped false — distinct from a skip", () => {
    const evidence = buildEvidence({ status: "abandoned", skipped: false, finalAnswer: null, isCorrect: null, timeTakenSeconds: 200 });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.noAnswer).toBe(true);
    expect(signals.skipped).toBe(false);
  });

  it("missing expected time: speedRatio null, no fast/slow/above/below signals fabricated", () => {
    const evidence = buildEvidence({ timeTakenSeconds: 100, expectedTimeSeconds: null });
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.speedRatio).toBeNull();
    expect(signals.correctFast).toBe(false);
    expect(signals.correctSlow).toBe(false);
    expect(signals.timeAboveExpected).toBe(false);
    expect(signals.timeBelowExpected).toBe(false);
  });

  it("invalid expected time (zero): speedRatio null, not Infinity", () => {
    const evidence = buildEvidence({ timeTakenSeconds: 100, expectedTimeSeconds: 0 });
    expect(deriveBehaviorSignals(evidence).speedRatio).toBeNull();
  });

  it("invalid expected time (negative): speedRatio null", () => {
    const evidence = buildEvidence({ timeTakenSeconds: 100, expectedTimeSeconds: -10 });
    expect(deriveBehaviorSignals(evidence).speedRatio).toBeNull();
  });

  it("missing time taken (in_progress-shaped data): speedRatio null", () => {
    const evidence = buildEvidence({ timeTakenSeconds: null, expectedTimeSeconds: 90 });
    expect(deriveBehaviorSignals(evidence).speedRatio).toBeNull();
  });

  it("regression: correct but 3x expected time remains BOTH correct AND slow, and above-expected — not mutually exclusive", () => {
    const evidence = buildEvidence({ isCorrect: true, timeTakenSeconds: 270, expectedTimeSeconds: 90 }); // ratio 3.0
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.correctSlow).toBe(true);
    expect(signals.timeAboveExpected).toBe(true);
    expect(signals.incorrectSlow).toBe(false); // still correct, so the incorrect_* signals must not also fire
  });

  it("time_above_expected and time_below_expected are coarser than the fast/slow thresholds — a ratio of 1.1 is above expected but not yet 'slow'", () => {
    const evidence = buildEvidence({ isCorrect: true, timeTakenSeconds: 99, expectedTimeSeconds: 90 }); // ratio 1.1
    const signals = deriveBehaviorSignals(evidence);
    expect(signals.timeAboveExpected).toBe(true);
    expect(signals.correctSlow).toBe(false);
  });
});
