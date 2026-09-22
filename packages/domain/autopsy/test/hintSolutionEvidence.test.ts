import { describe, expect, it } from "vitest";
import { deriveHintSolutionEvidence } from "../src/behaviorSignals.js";
import { buildEvidence } from "../fixtures/evidence.js";

describe("deriveHintSolutionEvidence — temporal, order-based facts (Phase 5A §5)", () => {
  it("hint used before the terminal answer_submitted event", () => {
    const evidence = buildEvidence({
      hintsUsed: 1,
      eventTimeline: [
        { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z", payload: null },
        { type: "hint_opened", occurredAt: "2026-09-22T10:00:10.000Z", payload: null },
        { type: "answer_selected", occurredAt: "2026-09-22T10:00:30.000Z", payload: { selectedAnswer: "480" } },
        { type: "answer_submitted", occurredAt: "2026-09-22T10:01:00.000Z", payload: { selectedAnswer: "480" } }
      ]
    });
    const result = deriveHintSolutionEvidence(evidence);
    expect(result.hintUsed).toBe(true);
    expect(result.hintBeforeFinalization).toBe(true);
  });

  it("solution opened before a skip", () => {
    const evidence = buildEvidence({
      status: "skipped",
      skipped: true,
      finalAnswer: null,
      isCorrect: null,
      solutionOpenedAt: "2026-09-22T10:00:20.000Z",
      eventTimeline: [
        { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z", payload: null },
        { type: "solution_opened", occurredAt: "2026-09-22T10:00:20.000Z", payload: null },
        { type: "question_skipped", occurredAt: "2026-09-22T10:00:40.000Z", payload: null }
      ]
    });
    const result = deriveHintSolutionEvidence(evidence);
    expect(result.solutionOpened).toBe(true);
    expect(result.solutionBeforeFinalization).toBe(true);
  });

  it("no hint used: hintBeforeFinalization is null, not false", () => {
    const evidence = buildEvidence({ hintsUsed: 0 });
    const result = deriveHintSolutionEvidence(evidence);
    expect(result.hintUsed).toBe(false);
    expect(result.hintBeforeFinalization).toBeNull();
  });

  it("abandoned attempt with a hint but no terminal event: hintBeforeFinalization is null (nothing to compare against)", () => {
    const evidence = buildEvidence({
      status: "abandoned",
      skipped: false,
      finalAnswer: null,
      isCorrect: null,
      hintsUsed: 1,
      eventTimeline: [
        { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z", payload: null },
        { type: "hint_opened", occurredAt: "2026-09-22T10:00:10.000Z", payload: null }
      ]
    });
    const result = deriveHintSolutionEvidence(evidence);
    expect(result.hintUsed).toBe(true);
    expect(result.hintBeforeFinalization).toBeNull();
  });
});
