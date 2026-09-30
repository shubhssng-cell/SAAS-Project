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

  it("every other adaptive reason keeps the existing Coverage copy (unchanged behavior)", () => {
    for (const reason of ["coverage_gap", "underexposure", "difficulty_progression", "accuracy_weakness"]) {
      const view = toRecommendationView(adaptive(reason));
      expect(view).toEqual({ questionId: "q-next", modeLabel: "Coverage", headline: "Keep building your coverage", explanation: "This targets a part of the topic you haven't practiced much yet." });
    }
  });

  it("no_action is unchanged", () => {
    expect(toRecommendationView({ status: "no_action", reason: "no_candidates_supplied" } as unknown as TrainingOrchestrationResult).questionId).toBeNull();
  });
});
