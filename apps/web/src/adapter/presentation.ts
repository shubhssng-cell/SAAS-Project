import type { BehaviorSignals, HistoricalSignals } from "@ipmat/autopsy";
import type { TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import { ERROR_TAXONOMY } from "./fixtures.js";
import type { RecommendationViewModel } from "./types.js";

/**
 * The ONLY place internal decision-engine vocabulary (provider ids, action
 * types, error-taxonomy codes) is translated into student-facing language.
 * This is translation, not decision-making: every choice of WHAT to
 * recommend was already made by `orchestrateNextTrainingAction()` before
 * this function ever runs — nothing here inspects evidence or picks a
 * question. It only decides how to WORD an already-made decision.
 */

const PROVIDER_COPY: Record<string, { modeLabel: string; headline: string; explanation: string }> = {
  "trap-lab": {
    modeLabel: "Recurring mistake",
    headline: "Practice a recurring mistake",
    explanation: "You've made the same kind of mistake more than once. This question checks whether you've corrected it."
  },
  "calculation-gym": {
    modeLabel: "Calculation accuracy",
    headline: "Sharpen your calculations",
    explanation: "Your accuracy drops specifically on calculation-heavy versions of this topic. This one is built to target that."
  },
  "speed-lab": {
    modeLabel: "Solving speed",
    headline: "Build solving speed",
    explanation: "You're solving this type correctly, but slower than expected. Same difficulty — the focus this time is pace."
  },
  "pressure-training": {
    modeLabel: "Under pressure",
    headline: "Train under time pressure",
    explanation: "You handle this pattern well normally, but performance drops when time is tight. Let's test that directly."
  },
  "novelty-training": {
    modeLabel: "New angle",
    headline: "Practice a new variation",
    explanation: "You've mostly seen this concept presented one way. Here's a different angle on the same idea."
  }
};

function errorTaxonomyLabel(code: string | null): string | null {
  if (!code) return null;
  return ERROR_TAXONOMY.find((entry) => entry.code === code)?.label ?? null;
}

export function toRecommendationViewModel(result: TrainingOrchestrationResult): RecommendationViewModel {
  if (result.status === "no_action") {
    return {
      questionId: null,
      modeLabel: "Up to date",
      headline: "You're all caught up",
      explanation: "Nothing urgent right now. Keep practicing to build up more evidence."
    };
  }

  if (result.actionType === "targeted_repair") {
    const label = errorTaxonomyLabel(result.providerResult.targetErrorTaxonomyCode);
    return {
      questionId: result.question.questionId,
      modeLabel: "Confirmed pattern",
      headline: "Fix a confirmed mistake pattern",
      explanation: label
        ? `You confirmed this was a case of "${label.toLowerCase()}" — here's a question to test whether you've corrected it.`
        : "You confirmed a specific mistake last time — here's a question to test whether you've corrected it."
    };
  }

  if (result.actionType === "training_system_practice") {
    const copy = PROVIDER_COPY[result.providerId];
    return {
      questionId: result.question.questionId,
      modeLabel: copy?.modeLabel ?? "Focused practice",
      headline: copy?.headline ?? "Focused practice",
      explanation: copy?.explanation ?? "This question targets a specific pattern in how you've been practicing."
    };
  }

  // adaptive_practice
  return {
    questionId: result.question.questionId,
    modeLabel: "Coverage",
    headline: "Keep building your coverage",
    explanation: "This targets a part of the topic you haven't practiced much yet."
  };
}

/** Plain-language OBSERVED facts only -- never a claim about why something happened. */
export function describeObservations(behaviorSignals: BehaviorSignals, historicalSignals: HistoricalSignals | null): string[] {
  const observed: string[] = [];

  if (behaviorSignals.answerChanged) {
    observed.push(behaviorSignals.multipleAnswerChanges ? "You changed your answer more than once before submitting." : "You changed your answer once before submitting.");
  }
  if (behaviorSignals.incorrectSlow || behaviorSignals.correctSlow) {
    observed.push("You took longer than expected for this type of question.");
  }
  if (behaviorSignals.incorrectFast || behaviorSignals.correctFast) {
    observed.push("You answered faster than expected for this type of question.");
  }
  if (behaviorSignals.hintUsed) {
    observed.push("You used a hint before answering.");
  }
  if (behaviorSignals.solutionOpened) {
    observed.push("You viewed the solution.");
  }

  const repeatedTaxonomyCell = historicalSignals?.repeatedTaxonomyCellFailure;
  if (repeatedTaxonomyCell) {
    observed.push(`You've made this exact type of mistake ${repeatedTaxonomyCell.count} times before.`);
  } else {
    const repeatedConcept = historicalSignals?.repeatedConceptFailure;
    if (repeatedConcept) {
      observed.push(`You've gotten a question on this topic wrong ${repeatedConcept.count} times before.`);
    }
  }

  if (observed.length === 0) {
    observed.push("Nothing unusual about how you approached this question — the answer itself didn't match.");
  }

  return observed;
}
