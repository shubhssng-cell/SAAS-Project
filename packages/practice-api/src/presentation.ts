import type { AttemptState } from "@ipmat/attempt";
import type { StoredAutopsy, StudentQuestionRecord } from "@ipmat/db";
import type { TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import type { ObservationEvidence } from "@ipmat/training-recommendation";
import type { AttemptEvidenceView, AttemptResultStatus, AttemptResultView, PendingAutopsyView, RecommendationView, StudentQuestionView } from "./types.js";

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

/**
 * Student-facing wording for the Phase 3.1 recent-evidence reasons (the FIRST adaptive layer -- deterministic rules over the
 * last attempt's observable outcome, not AI, not a diagnosis). Each line states an observation and what the question is
 * relative to it; none says why the student got it wrong or what they are like.
 */
const RECENT_EVIDENCE_COPY: Partial<Record<string, { modeLabel: string; headline: string; explanation: string }>> = {
  recent_incorrect: {
    modeLabel: "After an incorrect answer",
    headline: "Try a related question",
    explanation: "Your last answer was incorrect, so here's a related question that isn't harder."
  },
  recent_skip: {
    modeLabel: "After a skipped question",
    headline: "Try a question that isn't harder",
    explanation: "You skipped your last question, so here's one that isn't harder."
  },
  recent_slow: {
    modeLabel: "Steady pace",
    headline: "Stay at this level",
    explanation: "Your last answer was correct but took longer than expected, so here's another at the same level before moving up."
  },
  recent_correct_on_pace: {
    modeLabel: "Next step",
    headline: "Move on a step",
    explanation: "Your last answer was correct within the expected time, so here's one that isn't easier."
  }
};

/**
 * Phase 3.2 -- student-facing wording for ACCUMULATED evidence (the existing multi-attempt reasons, which need the shared
 * minimum number of observations). Every sentence states a COUNT or RATIO taken from the student's own persisted attempts
 * ("2 of your 4 graded answers on Percentages were incorrect") and what the question is ("more practice on it") -- never a
 * label, a score, a cause, or a claim about the student. Returns `null` (=> the neutral coverage copy) when the facts needed to
 * state it truthfully are not present, rather than inventing a number.
 */
function accumulatedEvidenceCopy(
  reason: string,
  evidence: { conceptName: string; gradedAttempts: number; incorrectCount: number; trailingIncorrectStreak: number; speedObservations: number; meanSpeedRatio: number | null; highestDemonstratedTier: { tier: string; attempts: number; correct: number } | null } | null | undefined,
  selection: { isFallback: boolean; questionTier: string }
): { modeLabel: string; headline: string; explanation: string } | null {
  if (!evidence) return null;
  const topic = evidence.conceptName;
  switch (reason) {
    case "repeated_error":
      if (evidence.trailingIncorrectStreak < 2) return null;
      return {
        modeLabel: "Repeated incorrect answers",
        headline: "More practice on this topic",
        explanation: `Your last ${evidence.trailingIncorrectStreak} graded answers on ${topic} were all incorrect, so here's more practice on ${topic}.`
      };
    case "accuracy_weakness":
      if (evidence.gradedAttempts < 1 || evidence.incorrectCount < 1) return null;
      return {
        modeLabel: "Accuracy so far",
        headline: "More practice on this topic",
        explanation: `${evidence.incorrectCount} of your ${evidence.gradedAttempts} graded answers on ${topic} were incorrect, so here's more practice on ${topic}.`
      };
    case "speed_weakness":
      if (evidence.meanSpeedRatio === null || evidence.speedObservations < 1) return null;
      return {
        modeLabel: "Time so far",
        headline: "Practice at a steady pace",
        explanation: `Across ${evidence.speedObservations} attempts on ${topic}, your answers took about ${evidence.meanSpeedRatio.toFixed(1)} times the expected time, so here's more practice on ${topic} while you build speed.`
      };
    case "difficulty_progression": {
      // Only when progression is a genuine, evidence-backed reason (not the last-resort fallback) and there IS a demonstrated tier to cite.
      const demonstrated = evidence.highestDemonstratedTier;
      if (selection.isFallback || !demonstrated) return null;
      return {
        modeLabel: "Your progress so far",
        headline: "Try the next level",
        explanation: `You answered ${demonstrated.correct} of ${demonstrated.attempts} graded ${demonstrated.tier}-tier questions on ${topic} correctly, so here's a question at the ${selection.questionTier} tier.`
      };
    }
    default:
      return null;
  }
}

/**
 * Phase 3.3 -- student-facing wording for TREND evidence (how observed performance on the concept changed between the most recent
 * graded answers and the earlier ones). Every sentence states counts from the student's own persisted attempts and what the question is;
 * it never labels the student, never explains why performance changed, never shows an internal reason code. Trend evidence describes
 * changes in observed performance; it does not diagnose the student. `null` => the existing copy for that reason is used.
 */
type TrendFacts = { conceptName: string; recentWindowSize: number; recentCorrect: number; earlierGraded: number; earlierCorrect: number; currentStreak: { outcome: string; length: number }; kind: string | null };

function trendEvidenceCopy(reason: string, trend: TrendFacts | null | undefined): { modeLabel: string; headline: string; explanation: string } | null {
  if (!trend || trend.kind === null) return null;
  const topic = trend.conceptName;
  const recent = `${trend.recentCorrect} of your last ${trend.recentWindowSize} graded answers on ${topic}`;
  const earlier = `${trend.earlierCorrect} of ${trend.earlierGraded} earlier ones`;
  switch (reason) {
    case "recent_improvement":
      return {
        modeLabel: "Recent progress",
        headline: "Keep building on your progress",
        explanation: `Your last ${trend.recentWindowSize} graded answers on ${topic} were all correct, compared with ${earlier}, so this moves you forward gradually.`
      };
    case "recent_deterioration":
      return {
        modeLabel: "Recent change",
        headline: "Keep the difficulty steady",
        explanation: `${recent} were correct, compared with ${earlier}, so here's another question that isn't harder.`
      };
    case "repeated_error":
      if (trend.kind !== "deteriorating" || trend.currentStreak.outcome !== "incorrect" || trend.currentStreak.length < 2) return null;
      return {
        modeLabel: "Recent change",
        headline: "Keep the difficulty steady",
        explanation: `Your last ${trend.currentStreak.length} graded answers on ${topic} were all incorrect, while ${earlier} were correct, so here's more practice on ${topic} at a steady difficulty.`
      };
    case "accuracy_weakness":
      if (trend.kind !== "persistent_difficulty") return null;
      return {
        modeLabel: "Accuracy over time",
        headline: "More practice on this topic",
        explanation: `Only ${trend.earlierCorrect} of ${trend.earlierGraded} earlier graded answers and ${trend.recentCorrect} of your last ${trend.recentWindowSize} on ${topic} were correct, so here's more practice on ${topic}.`
      };
    default:
      return null;
  }
}

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
  // Phase 3.1: when the pick was decided by the student's most recent attempt, say so -- in fixed copy that states only what
  // was observed ("your last answer was incorrect"), never a claim about the student. Anything else keeps the coverage copy.
  // Phase 3.3: trend evidence (recent window vs earlier) is stated first when it is what decided the pick, or sharpens an accumulated reason.
  const trend = trendEvidenceCopy(result.providerResult.primaryReason, result.providerResult.trendEvidence);
  if (trend) return { questionId: result.question.questionId, ...trend };
  const recentCopy = RECENT_EVIDENCE_COPY[result.providerResult.primaryReason];
  if (recentCopy) return { questionId: result.question.questionId, ...recentCopy };
  // Phase 3.2: accumulated evidence -- counts/ratios of observed performance across persisted attempts, stated as facts.
  const accumulated = accumulatedEvidenceCopy(result.providerResult.primaryReason, result.providerResult.accumulatedEvidence, { isFallback: result.providerResult.isFallback, questionTier: result.question.difficultyTier });
  if (accumulated) return { questionId: result.question.questionId, ...accumulated };
  return { questionId: result.question.questionId, modeLabel: "Coverage", headline: "Keep building your coverage", explanation: "This targets a part of the topic you haven't practiced much yet." };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Phase 4 Unit 1 -- the ONLY place observation evidence becomes student-facing sentences. Every sentence restates a recorded or
 * derived number ("You took 86 seconds."); none explains why, labels the student, or judges the attempt beyond the graded verdict.
 * Anything unknown is left out of `observations` and, where it matters, named in `notRecorded` -- never turned into a default.
 */
export function toAttemptEvidenceView(evidence: ObservationEvidence): AttemptEvidenceView {
  const { outcome, timing, interaction, questionContext, history } = evidence;
  const observations: string[] = [];

  if (outcome.status === "submitted") {
    if (outcome.selectedAnswer !== null) observations.push(`Your selected answer was ${outcome.selectedAnswer}.`);
    if (outcome.verdict === "correct") observations.push("Your answer was correct.");
    if (outcome.verdict === "incorrect") observations.push("Your answer was incorrect.");
  } else if (outcome.status === "skipped") {
    observations.push("You skipped this question.");
  } else {
    observations.push("This attempt ended without a submitted answer.");
  }

  if (timing.elapsedSeconds !== null) observations.push(`You took ${timing.elapsedSeconds} ${plural(timing.elapsedSeconds, "second", "seconds")}.`);
  if (timing.expectedSeconds !== null) observations.push(`The expected time was ${timing.expectedSeconds} ${plural(timing.expectedSeconds, "second", "seconds")}.`);
  if (timing.timeRatio !== null) observations.push(`That is about ${timing.timeRatio.toFixed(1)} times the expected time.`);

  if (interaction.answerChangeCount !== null && interaction.answerChangeCount >= 1) {
    observations.push(`You changed your answer ${interaction.answerChangeCount === 1 ? "once" : `${interaction.answerChangeCount} times`} before submitting.`);
  }
  if (interaction.hintEventsRecorded > 0) observations.push(`You opened ${interaction.hintEventsRecorded} ${plural(interaction.hintEventsRecorded, "hint", "hints")}.`);
  if (interaction.solutionOpenedRecorded) observations.push("You opened the solution during this attempt.");

  if (questionContext !== null) {
    observations.push(`This question was in ${questionContext.conceptName}, pattern "${questionContext.patternFamilyName}", at the ${questionContext.difficultyTier} level.`);
  }
  const onConcept = history?.onSameConcept;
  if (questionContext !== null && onConcept !== undefined && onConcept.attempts > 0) {
    const parts = [`${onConcept.correct} correct`, `${onConcept.incorrect} incorrect`];
    if (onConcept.skipped > 0) parts.push(`${onConcept.skipped} skipped`);
    observations.push(`Before this attempt you had ${onConcept.attempts} earlier ${plural(onConcept.attempts, "attempt", "attempts")} on ${questionContext.conceptName}: ${parts.join(", ")}.`);
  }

  const notRecorded: string[] = [];
  if (interaction.answerChangeCount === null) notRecorded.push("Changes to your answer before submitting are not recorded in this practice flow.");

  return {
    attemptId: evidence.identity.attemptId,
    questionId: evidence.identity.questionId,
    status: outcome.status,
    observations,
    facts: {
      verdict: outcome.verdict,
      selectedAnswer: outcome.selectedAnswer,
      elapsedSeconds: timing.elapsedSeconds,
      expectedSeconds: timing.expectedSeconds,
      timeRatio: timing.timeRatio,
      answerChangeCount: interaction.answerChangeCount
    },
    context: questionContext === null ? null : { conceptName: questionContext.conceptName, patternFamilyName: questionContext.patternFamilyName, difficultyTier: questionContext.difficultyTier },
    history:
      history === null
        ? null
        : { priorAttempts: history.priorAttempts, onConcept: { attempts: history.onSameConcept.attempts, correct: history.onSameConcept.correct, incorrect: history.onSameConcept.incorrect, skipped: history.onSameConcept.skipped } },
    notRecorded
  };
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
