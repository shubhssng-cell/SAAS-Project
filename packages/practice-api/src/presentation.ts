import type { AttemptState } from "@ipmat/attempt";
import type { StoredAutopsy, StudentQuestionRecord } from "@ipmat/db";
import type { TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import type { AttemptResultStatus, AttemptResultView, PendingAutopsyView, RecommendationView, StudentQuestionView } from "./types.js";

/**
 * The ONLY place internal decision-engine vocabulary (provider ids, action
 * types, raw `providerResult`/`diagnostics` structures) is translated into
 * student-facing language (B, K). This is translation, not decision-making
 * — every choice of WHAT to recommend was already made by
 * `orchestrateNextTrainingAction()` before this function runs; nothing
 * here inspects evidence or picks a question. Independently authored from
 * `apps/web/src/adapter/presentation.ts`'s own `toRecommendationViewModel()`
 * (this package cannot depend on `apps/web` — the dependency direction
 * only ever goes the other way), but deliberately the SAME kind of
 * translation and the SAME output shape, so a future `apps/web` adapter
 * built on this boundary needs no new UI-facing vocabulary.
 *
 * `result.explanation`/`providerResult`'s own `explanation` fields are
 * NEVER surfaced directly — they are internal orchestration/selection
 * diagnostics, not authored student copy (B: "never expose internal
 * orchestration reason structures unless deliberately mapped to a
 * student-safe explanation" — this function IS that deliberate mapping).
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

export function toRecommendationView(result: TrainingOrchestrationResult): RecommendationView {
  if (result.status === "no_action") {
    return { questionId: null, modeLabel: "Up to date", headline: "You're all caught up", explanation: "Nothing urgent right now. Keep practicing to build up more evidence." };
  }

  if (result.actionType === "targeted_repair") {
    return {
      questionId: result.question.questionId,
      modeLabel: "Confirmed pattern",
      headline: "Fix a confirmed mistake pattern",
      explanation: "You confirmed a specific mistake last time — here's a question to test whether you've corrected it."
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
  return { questionId: result.question.questionId, modeLabel: "Coverage", headline: "Keep building your coverage", explanation: "This targets a part of the topic you haven't practiced much yet." };
}

export function toStudentQuestionView(record: StudentQuestionRecord): StudentQuestionView {
  return {
    questionId: record.id,
    chapterName: record.chapterName,
    conceptName: record.conceptName,
    prompt: record.prompt,
    answerFormat: record.answerFormat,
    options: record.options,
    expectedTimeSeconds: record.expectedTimeSeconds
  };
}

/**
 * `correctAnswer` is included ONLY for `status === "submitted"` — for
 * `skipped`/`abandoned` it is always `null`, even if the caller supplies
 * one, since there is no answer a skip/abandonment was graded against
 * (mirrors `@ipmat/attempt`'s own "a skip is neither correct nor
 * incorrect" rule).
 */
export function toAttemptResultView(
  attempt: AttemptState,
  correctAnswer: string | null,
  expectedTimeSeconds: number | null,
  reveal: { solutionSteps?: string[] | null; content?: Pick<StudentQuestionRecord, "prompt" | "chapterName" | "conceptName"> | null } = {}
): AttemptResultView {
  const status = attempt.status as AttemptResultStatus;
  return {
    attemptId: attempt.id,
    questionId: attempt.questionId,
    status,
    isCorrect: attempt.isCorrect,
    chosenAnswer: attempt.chosenAnswer,
    correctAnswer: status === "submitted" ? correctAnswer : null,
    timeSpentSeconds: attempt.timeSpentSeconds,
    expectedTimeSeconds,
    // Post-submission material only: a skip/abandon is never shown a solution or question, same rule as `correctAnswer`.
    solutionSteps: status === "submitted" ? [...(reveal.solutionSteps ?? [])] : [],
    question: status === "submitted" && reveal.content ? { prompt: reveal.content.prompt, chapterName: reveal.content.chapterName, conceptName: reveal.content.conceptName } : null
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * `stored.evidenceUsed` is untyped persisted JSON (`Record<string, unknown>`
 * — `@ipmat/autopsy` has no reverse mapper back to a typed `AutopsyOutput`)
 * — `supportingEvidence` is read out of it defensively, never trusted to
 * already be the right shape. `modelConfidence` is deliberately never read
 * out of it at all (D-038). `null`/not-yet-decided (`confirmed === null`)
 * is the only state this function reports as `pending: true` — an already
 * confirmed/rejected/corrected row, or no row at all, is `pending: false`,
 * a valid ordinary state, never an error.
 */
export function toPendingAutopsyView(attemptId: string, stored: StoredAutopsy | null): PendingAutopsyView {
  if (stored === null || stored.confirmed !== null) {
    return { attemptId, pending: false, hypothesis: null };
  }

  const supportingEvidence = isStringArray(stored.evidenceUsed.supportingEvidence) ? stored.evidenceUsed.supportingEvidence : [];
  return { attemptId, pending: true, hypothesis: { summary: stored.hypothesisText, supportingEvidence } };
}
