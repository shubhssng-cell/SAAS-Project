import { describe, expect, it } from "vitest";
import type { TrainingSessionViewModel } from "../../src/adapter/index.js";
import { COMPLETION_PRESETS, DEFAULT_COMPLETION_PRESET_ID, describeCompletion, describeProgress, isStartable, trainingResultPath, trainingSessionPath } from "../../src/training/trainingEntry.js";

function session(overrides: Partial<TrainingSessionViewModel> = {}): TrainingSessionViewModel {
  return {
    sessionId: "s-1",
    systemId: "novelty-training",
    systemLabel: "Novelty",
    objective: { statement: "Unfamiliar twists.", targetConceptName: "Percentages" },
    status: "active",
    completion: { kind: "fixed_question_count", questionCount: 5 },
    progress: { completedQuestionCount: 2, submittedCount: 1, skippedCount: 1, elapsedSeconds: 100, remainingQuestions: 3, remainingSeconds: null, completionReached: false, hasOpenQuestion: false },
    ...overrides
  };
}

describe("Training entry helpers (Phase 5 Unit 1)", () => {
  it("offers presets of both completion kinds, with a default that exists", () => {
    expect(COMPLETION_PRESETS.some((p) => p.completion.kind === "fixed_question_count")).toBe(true);
    expect(COMPLETION_PRESETS.some((p) => p.completion.kind === "fixed_duration")).toBe(true);
    expect(COMPLETION_PRESETS.some((p) => p.id === DEFAULT_COMPLETION_PRESET_ID)).toBe(true);
    expect(new Set(COMPLETION_PRESETS.map((p) => p.id)).size).toBe(COMPLETION_PRESETS.length);
  });

  it("describes progress from observable counts only", () => {
    expect(describeProgress(session())).toBe("2 of 5 questions done");
    expect(describeProgress(session({ completion: { kind: "fixed_duration", durationSeconds: 600 }, progress: { ...session().progress, completedQuestionCount: 1, remainingSeconds: 125 } }))).toBe("1 question done · 2:05 left");
  });

  it("describes a completion rule", () => {
    expect(describeCompletion({ kind: "fixed_question_count", questionCount: 1 })).toBe("1 question");
    expect(describeCompletion({ kind: "fixed_duration", durationSeconds: 300 })).toBe("5 minutes");
  });

  it("builds session and result paths that encode ids and carry the attempt for a refresh", () => {
    expect(trainingSessionPath("a b")).toBe("/training/a%20b");
    expect(trainingResultPath("s-1", "q-9", "att-3")).toBe("/training/s-1/result/q-9?attempt=att-3");
  });

  it("only an `available` system is startable", () => {
    expect(isStartable("available")).toBe(true);
    for (const a of ["not_applicable", "no_eligible_question", "unavailable", "not_built", ""]) expect(isStartable(a)).toBe(false);
  });

  it("no helper output speaks about confidence, emotion or any inferred state", () => {
    const text = JSON.stringify([COMPLETION_PRESETS, describeProgress(session()), describeCompletion(session().completion)]).toLowerCase();
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood"]) expect(text).not.toContain(banned);
  });
});
