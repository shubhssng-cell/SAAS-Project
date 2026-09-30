import type { TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import { describe, expect, it } from "vitest";
import { toRecommendationView } from "../src/presentation.js";

/**
 * Phase 3.1 -- student-facing wording for the first adaptive layer. The view is student-safe: fixed strings that state an
 * observation, never a claim about the student, never an internal reason code, and never anything answer-bearing.
 */

function adaptive(primaryReason: string): TrainingOrchestrationResult {
  return {
    status: "selected",
    actionType: "adaptive_practice",
    question: { questionId: "q-next" },
    explanation: "internal explanation that must never be shown",
    providerResult: { primaryReason, explanation: "internal", recentEvidence: { signal: "incorrect", question: { questionId: "q-prev" } } },
    wasFallbackFromRepair: false,
    wasFallbackFromTrainingSystems: false,
    diagnostics: { internal: "diagnostics" }
  } as unknown as TrainingOrchestrationResult;
}

describe("toRecommendationView -- recent-evidence copy", () => {
  it.each([
    ["recent_incorrect", /last answer was incorrect/, "After an incorrect answer"],
    ["recent_skip", /skipped your last question/, "After a skipped question"],
    ["recent_slow", /correct but took longer than expected/, "Steady pace"],
    ["recent_correct_on_pace", /correct within the expected time/, "Next step"]
  ])("%s -> fixed observation-only copy", (reason, explanation, modeLabel) => {
    const view = toRecommendationView(adaptive(reason));
    expect(view.questionId).toBe("q-next");
    expect(view.modeLabel).toBe(modeLabel);
    expect(view.explanation).toMatch(explanation);
    expect(Object.keys(view).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]);
  });

  it("never shows internal vocabulary, and never claims anything about the student (no confidence/ability/emotion language)", () => {
    for (const reason of ["recent_incorrect", "recent_skip", "recent_slow", "recent_correct_on_pace"]) {
      const text = JSON.stringify(toRecommendationView(adaptive(reason)));
      expect(text).not.toMatch(/recent_|primaryReason|providerResult|diagnostics|internal|adaptive|signal/);
      expect(text).not.toMatch(/confiden|motivat|anxi|lazy|careless|weak|struggl|understand|intelligen|ability|afraid|feel/i);
    }
  });

  it("every other adaptive reason keeps the existing Coverage copy (unchanged behavior) -- including accumulated reasons when the facts to state them are absent", () => {
    for (const reason of ["coverage_gap", "underexposure", "difficulty_progression", "accuracy_weakness"]) {
      const view = toRecommendationView(adaptive(reason));
      expect(view).toEqual({ questionId: "q-next", modeLabel: "Coverage", headline: "Keep building your coverage", explanation: "This targets a part of the topic you haven't practiced much yet." });
    }
  });

  it("no_action is unchanged", () => {
    expect(toRecommendationView({ status: "no_action", reason: "no_candidates_supplied" } as unknown as TrainingOrchestrationResult).questionId).toBeNull();
  });
});

/**
 * Phase 3.2 -- ACCUMULATED evidence copy. Each sentence states a count or ratio from the student's own persisted attempts and what the
 * question is; it never labels the student, never gives a cause, never shows an internal reason code.
 */
function accumulated(primaryReason: string, evidence: Record<string, unknown> | null, extra: { isFallback?: boolean; tier?: string } = {}): TrainingOrchestrationResult {
  return {
    status: "selected",
    actionType: "adaptive_practice",
    question: { questionId: "q-next", difficultyTier: extra.tier ?? "advanced" },
    explanation: "internal",
    providerResult: { primaryReason, isFallback: extra.isFallback ?? false, accumulatedEvidence: evidence, explanation: "internal" },
    wasFallbackFromRepair: false,
    wasFallbackFromTrainingSystems: false,
    diagnostics: {}
  } as unknown as TrainingOrchestrationResult;
}
const base = { conceptName: "Percentages", gradedAttempts: 4, incorrectCount: 3, trailingIncorrectStreak: 3, speedObservations: 4, meanSpeedRatio: 1.84, highestDemonstratedTier: null };

describe("toRecommendationView -- accumulated-evidence copy", () => {
  it("repeated_error states the current run of incorrect answers as a fact", () => {
    const view = toRecommendationView(accumulated("repeated_error", base));
    expect(view).toMatchObject({ questionId: "q-next", modeLabel: "Repeated incorrect answers", headline: "More practice on this topic" });
    expect(view.explanation).toBe("Your last 3 graded answers on Percentages were all incorrect, so here's more practice on Percentages.");
  });

  it("accuracy_weakness states the observed proportion", () => {
    const view = toRecommendationView(accumulated("accuracy_weakness", { ...base, gradedAttempts: 4, incorrectCount: 2, trailingIncorrectStreak: 0 }));
    expect(view.modeLabel).toBe("Accuracy so far");
    expect(view.explanation).toBe("2 of your 4 graded answers on Percentages were incorrect, so here's more practice on Percentages.");
  });

  it("speed_weakness states the observed time relationship, not a label", () => {
    const view = toRecommendationView(accumulated("speed_weakness", base));
    expect(view.modeLabel).toBe("Time so far");
    expect(view.explanation).toBe("Across 4 attempts on Percentages, your answers took about 1.8 times the expected time, so here's more practice on Percentages while you build speed.");
  });

  it("difficulty_progression cites the demonstrated tier's counts -- only when it is a genuine reason (not the fallback) and there is a tier to cite", () => {
    const evidence = { ...base, highestDemonstratedTier: { tier: "standard", attempts: 3, correct: 3 } };
    expect(toRecommendationView(accumulated("difficulty_progression", evidence)).explanation).toBe("You answered 3 of 3 graded standard-tier questions on Percentages correctly, so here's a question at the advanced tier.");
    expect(toRecommendationView(accumulated("difficulty_progression", evidence, { isFallback: true })).modeLabel).toBe("Coverage");
    expect(toRecommendationView(accumulated("difficulty_progression", base)).modeLabel).toBe("Coverage");
  });

  it("never states a fact it does not have: missing or inconsistent evidence falls back to the neutral coverage copy", () => {
    expect(toRecommendationView(accumulated("repeated_error", null)).modeLabel).toBe("Coverage");
    expect(toRecommendationView(accumulated("repeated_error", { ...base, trailingIncorrectStreak: 1 })).modeLabel).toBe("Coverage");
    expect(toRecommendationView(accumulated("accuracy_weakness", { ...base, incorrectCount: 0 })).modeLabel).toBe("Coverage");
    expect(toRecommendationView(accumulated("speed_weakness", { ...base, meanSpeedRatio: null })).modeLabel).toBe("Coverage");
  });

  it("student-safe: no internal vocabulary and no claim about the student (no confidence/ability/emotion/label language), fixed response shape", () => {
    const evidence = { ...base, highestDemonstratedTier: { tier: "standard", attempts: 3, correct: 3 } };
    for (const reason of ["repeated_error", "accuracy_weakness", "speed_weakness", "difficulty_progression"]) {
      const view = toRecommendationView(accumulated(reason, evidence));
      const text = JSON.stringify(view);
      expect(Object.keys(view).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]);
      expect(text).not.toMatch(/repeated_error|accuracy_weakness|speed_weakness|difficulty_progression|primaryReason|providerResult|accumulatedEvidence|internal|adaptive/);
      expect(text).not.toMatch(/confiden|motivat|anxi|lazy|careless|weak|struggl|understand|intelligen|ability|afraid|feel|ready|slow|bad at/i);
    }
  });
});

/**
 * Phase 3.3 -- TREND evidence copy. Counts from the student's own persisted attempts and what the question is; never a label, never a
 * cause, never an internal reason code. Trend evidence describes changes in observed performance; it does not diagnose the student.
 */
function withTrend(primaryReason: string, trend: Record<string, unknown> | null, accumulatedEvidence: Record<string, unknown> | null = null): TrainingOrchestrationResult {
  return {
    status: "selected",
    actionType: "adaptive_practice",
    question: { questionId: "q-next", difficultyTier: "advanced" },
    explanation: "internal",
    providerResult: { primaryReason, isFallback: false, accumulatedEvidence, trendEvidence: trend, explanation: "internal" },
    wasFallbackFromRepair: false,
    wasFallbackFromTrainingSystems: false,
    diagnostics: {}
  } as unknown as TrainingOrchestrationResult;
}
const trendBase = { conceptName: "Percentages", recentWindowSize: 3, recentCorrect: 3, earlierGraded: 3, earlierCorrect: 0, currentStreak: { outcome: "correct", length: 3 }, kind: "improving" };

describe("toRecommendationView -- trend-evidence copy", () => {
  it("recent_improvement states the last window against the earlier ones, and moves forward gradually", () => {
    const view = toRecommendationView(withTrend("recent_improvement", trendBase));
    expect(view).toEqual({
      questionId: "q-next",
      modeLabel: "Recent progress",
      headline: "Keep building on your progress",
      explanation: "Your last 3 graded answers on Percentages were all correct, compared with 0 of 3 earlier ones, so this moves you forward gradually."
    });
  });

  it("recent_deterioration states the counts and keeps the difficulty steady", () => {
    const view = toRecommendationView(withTrend("recent_deterioration", { ...trendBase, kind: "deteriorating", recentCorrect: 1, earlierGraded: 4, earlierCorrect: 4, currentStreak: { outcome: "incorrect", length: 1 } }));
    expect(view.modeLabel).toBe("Recent change");
    expect(view.explanation).toBe("1 of your last 3 graded answers on Percentages were correct, compared with 4 of 4 earlier ones, so here's another question that isn't harder.");
  });

  it("repeated_error gains the trend context ONLY when the history genuinely deteriorated; otherwise the Unit 10 copy is untouched", () => {
    const deteriorated = { ...trendBase, kind: "deteriorating", recentCorrect: 1, earlierGraded: 2, earlierCorrect: 2, currentStreak: { outcome: "incorrect", length: 2 } };
    expect(toRecommendationView(withTrend("repeated_error", deteriorated)).explanation).toBe(
      "Your last 2 graded answers on Percentages were all incorrect, while 2 of 2 earlier ones were correct, so here's more practice on Percentages at a steady difficulty."
    );
    const persistent = { ...deteriorated, kind: "persistent_difficulty", earlierCorrect: 0 };
    const view = toRecommendationView(withTrend("repeated_error", persistent, base));
    expect(view.modeLabel).toBe("Repeated incorrect answers");
  });

  it("accuracy_weakness under persistent difficulty states both windows' counts; under any other kind it keeps the Unit 10 copy", () => {
    const persistent = { ...trendBase, kind: "persistent_difficulty", recentCorrect: 1, earlierGraded: 3, earlierCorrect: 1, currentStreak: { outcome: "incorrect", length: 1 } };
    expect(toRecommendationView(withTrend("accuracy_weakness", persistent)).explanation).toBe(
      "Only 1 of 3 earlier graded answers and 1 of your last 3 on Percentages were correct, so here's more practice on Percentages."
    );
    const plain = toRecommendationView(withTrend("accuracy_weakness", { ...persistent, kind: null }, { ...base, incorrectCount: 2, trailingIncorrectStreak: 0 }));
    expect(plain.modeLabel).toBe("Accuracy so far");
  });

  it("no trend (or no claim) means no trend copy: neutral fallback or the existing copy", () => {
    expect(toRecommendationView(withTrend("recent_improvement", null)).modeLabel).toBe("Coverage");
    expect(toRecommendationView(withTrend("recent_improvement", { ...trendBase, kind: null })).modeLabel).toBe("Coverage");
  });

  it("student-safe: no internal vocabulary, no psychological language, fixed response shape", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["recent_improvement", trendBase],
      ["recent_deterioration", { ...trendBase, kind: "deteriorating", recentCorrect: 1 }],
      ["repeated_error", { ...trendBase, kind: "deteriorating", recentCorrect: 1, currentStreak: { outcome: "incorrect", length: 2 } }],
      ["accuracy_weakness", { ...trendBase, kind: "persistent_difficulty", recentCorrect: 1 }]
    ];
    for (const [reason, trend] of cases) {
      const view = toRecommendationView(withTrend(reason, trend));
      const text = JSON.stringify(view);
      expect(Object.keys(view).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]);
      expect(text).not.toMatch(/recent_|repeated_error|accuracy_weakness|persistent_difficulty|deteriorating|improving|primaryReason|providerResult|trendEvidence|internal|adaptive/);
      expect(text).not.toMatch(/confiden|motivat|anxi|lazy|careless|weak|struggl|understand|intelligen|ability|afraid|feel|ready|slow|bad at|naturally|losing/i);
    }
  });
});
