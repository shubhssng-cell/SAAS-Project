import { describe, expect, it } from "vitest";
import type { TrainingSessionViewModel } from "../../src/adapter/index.js";
import {
  COMPLETION_PRESETS,
  DEFAULT_COMPLETION_PRESET_ID,
  SESSION_RECORD_NOTE,
  describeAnswered,
  describeCompletion,
  describeProgress,
  describeQuestionPosition,
  describeTimeLeft,
  formatClock,
  isStartable,
  presetsFor,
  trainingResultPath,
  trainingSessionPath
} from "../../src/training/trainingEntry.js";

function session(overrides: Partial<TrainingSessionViewModel> = {}): TrainingSessionViewModel {
  return {
    sessionId: "s-1",
    systemId: "novelty-training",
    systemLabel: "Novelty",
    systemTitle: "Novelty training",
    objective: { statement: "Unfamiliar twists.", targetConceptName: "Percentages" },
    status: "active",
    completion: { kind: "fixed_question_count", questionCount: 5 },
    progress: { completedQuestionCount: 2, submittedCount: 1, skippedCount: 1, elapsedSeconds: 100, remainingQuestions: 3, remainingSeconds: null, completionReached: false, hasOpenQuestion: false },
    stage: null,
    summary: { submittedCount: 1, skippedCount: 1, correctCount: 1, incorrectCount: 0, totalTimeSeconds: 31, expectedTimeSeconds: 35 },
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

  it("states question position as 'Question N of M' for a fixed-count session, and never past the end", () => {
    expect(describeQuestionPosition(session())).toBe("Question 3 of 5");
    expect(describeQuestionPosition(session({ progress: { ...session().progress, completedQuestionCount: 5 } }))).toBe("Question 5 of 5");
    expect(describeQuestionPosition(session({ completion: { kind: "fixed_duration", durationSeconds: 300 }, progress: { ...session().progress, remainingSeconds: 65 } }))).toBe("2 questions done · 1:05 left");
  });

  it("states the answered result as a count, or nothing when nothing was answered -- never a percentage or rating", () => {
    expect(describeAnswered(session())).toBe("1 of 1 correct");
    expect(describeAnswered(session({ summary: { ...session().summary, submittedCount: 0, correctCount: 0 } }))).toBeNull();
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("the session-record caveat claims no lasting progress", () => {
    expect(SESSION_RECORD_NOTE).toMatch(/record of this session only/);
    expect(SESSION_RECORD_NOTE.toLowerCase()).not.toMatch(/mastered|improved|fixed|guarantee|permanent/);
  });

  it("no helper output speaks about confidence, emotion or any inferred state", () => {
    const text = JSON.stringify([COMPLETION_PRESETS, describeProgress(session()), describeCompletion(session().completion)]).toLowerCase();
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood"]) expect(text).not.toContain(banned);
  });
});

describe("Pressure Training entry helpers (Phase 5 Unit 6)", () => {
  it("presetsFor offers every preset when a system has no restriction, and only the allowed kind otherwise", () => {
    expect(presetsFor(null)).toEqual(COMPLETION_PRESETS);
    const timed = presetsFor(["fixed_duration"]);
    expect(timed.map((p) => p.id)).toEqual(["m5", "m10"]);
    expect(timed.every((p) => p.completion.kind === "fixed_duration")).toBe(true);
    expect(presetsFor(["fixed_question_count"]).every((p) => p.completion.kind === "fixed_question_count")).toBe(true);
  });

  it("presetsFor never returns an empty list (a kind with no preset falls back to all)", () => {
    expect(presetsFor([])).toEqual(COMPLETION_PRESETS);
  });

  it("describeTimeLeft shows a clock while time remains and an honest, non-alarming line once it is up", () => {
    expect(describeTimeLeft(600)).toBe("Time left: 10:00");
    expect(describeTimeLeft(65)).toBe("Time left: 1:05");
    expect(describeTimeLeft(0)).toBe("Time is up for this session. Finish the open question; no new question will start.");
    expect(describeTimeLeft(-3)).toBe("Time is up for this session. Finish the open question; no new question will start.");
    expect(describeTimeLeft(30)).not.toMatch(/stress|hurry|fail|behind|slow/i);
  });
});
