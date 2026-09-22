import type { AttemptAutopsyEvidence } from "@ipmat/attempt";

let counter = 0;
/** A fresh, deterministic attempt id per call, so fixtures built in a loop (e.g. historical-signal tests) don't collide. */
export function nextAttemptId(): string {
  counter += 1;
  return `attempt-fixture-${counter}`;
}

/**
 * A deterministic, directly-constructed `AttemptAutopsyEvidence` — used
 * for fast, isolated unit tests of this package's own derivation logic.
 * Defaults to a normal, correct, on-time, single-answer, no-hint,
 * no-solution, submitted attempt; every field can be overridden per test.
 * `test/integration.test.ts` separately proves this package against a
 * REAL `@ipmat/attempt` lifecycle + `toAutopsyEvidence()` call, so this
 * hand-built shortcut is never the only thing exercising the real contract.
 */
export function buildEvidence(overrides: Partial<AttemptAutopsyEvidence> = {}): AttemptAutopsyEvidence {
  return {
    attemptId: nextAttemptId(),
    studentId: "student-1",
    questionId: "question-reverse-percentage-1",
    conceptId: "concept-percentages",
    status: "submitted",
    correctAnswer: "480",
    finalAnswer: "480",
    isCorrect: true,
    answerChangeHistory: { initialAnswer: "480", finalAnswer: "480", changeCount: 0, sequence: [{ answer: "480", occurredAt: "2026-09-22T10:00:30.000Z" }] },
    timeTakenSeconds: 90,
    expectedTimeSeconds: 90,
    hintsUsed: 0,
    solutionOpenedAt: null,
    solutionOpenedBeforeFinalization: null,
    skipped: false,
    eventTimeline: [
      { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z", payload: null },
      { type: "answer_selected", occurredAt: "2026-09-22T10:00:30.000Z", payload: { selectedAnswer: "480" } },
      { type: "answer_submitted", occurredAt: "2026-09-22T10:01:30.000Z", payload: { selectedAnswer: "480" } }
    ],
    ...overrides
  };
}
