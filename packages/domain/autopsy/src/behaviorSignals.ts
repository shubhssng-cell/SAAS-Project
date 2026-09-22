import type { AttemptAutopsyEvidence } from "@ipmat/attempt";
import { AUTOPSY_THRESHOLDS, type BehaviorSignals, type HintSolutionEvidence } from "./types.js";

/**
 * `timeTaken / expectedTime`, computed ONLY when both are present,
 * finite, and `expectedTime > 0` — never manufactured otherwise (Phase 5A
 * §2). An `expectedTimeSeconds` of 0 or a negative number is treated as
 * invalid (not a legitimate "instant" question), same as a missing value.
 */
function computeSpeedRatio(evidence: AttemptAutopsyEvidence): number | null {
  const { timeTakenSeconds, expectedTimeSeconds } = evidence;
  if (timeTakenSeconds === null || expectedTimeSeconds === null) return null;
  if (!Number.isFinite(timeTakenSeconds) || !Number.isFinite(expectedTimeSeconds)) return null;
  if (expectedTimeSeconds <= 0) return null;
  return timeTakenSeconds / expectedTimeSeconds;
}

/**
 * Deterministic behavior signals (Phase 5A §2/§3) — pure function of the
 * finalized attempt's evidence. No question-context input is needed here
 * beyond what `AttemptAutopsyEvidence` already carries (expectedTimeSeconds);
 * the richer question-DNA context (difficulty tier, novelty level, etc.)
 * is preserved alongside these signals in `AutopsyOutput.questionFacts`,
 * not folded into the signals themselves — see docs/PHASE_5A_REVIEW.md for
 * why interpretation stays at the call site, not baked into the signal.
 */
export function deriveBehaviorSignals(evidence: AttemptAutopsyEvidence): BehaviorSignals {
  const speedRatio = computeSpeedRatio(evidence);
  const isCorrect = evidence.isCorrect === true;
  const isIncorrect = evidence.isCorrect === false;
  const isFast = speedRatio !== null && speedRatio <= AUTOPSY_THRESHOLDS.FAST_SPEED_RATIO;
  const isSlow = speedRatio !== null && speedRatio >= AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO;

  return {
    speedRatio,
    correctFast: isCorrect && isFast,
    correctSlow: isCorrect && isSlow,
    incorrectFast: isIncorrect && isFast,
    incorrectSlow: isIncorrect && isSlow,
    answerChanged: evidence.answerChangeHistory.changeCount >= 1,
    multipleAnswerChanges: evidence.answerChangeHistory.changeCount >= AUTOPSY_THRESHOLDS.MULTIPLE_ANSWER_CHANGES,
    hintUsed: evidence.hintsUsed > 0,
    solutionOpened: evidence.solutionOpenedAt !== null,
    skipped: evidence.skipped,
    noAnswer: evidence.finalAnswer === null,
    timeAboveExpected: speedRatio !== null && speedRatio > 1,
    timeBelowExpected: speedRatio !== null && speedRatio < 1
  };
}

const TERMINAL_EVENT_TYPES = new Set(["answer_submitted", "question_skipped"]);

/**
 * Finds the last index of `eventType` and the last index of any terminal
 * event, and reports whether the former precedes the latter — a genuine
 * event-order comparison, not an assumption (Phase 5A §5). Returns null
 * when `eventType` never occurred, or when the timeline has no terminal
 * event at all (an `abandoned` attempt never appends one — see
 * `@ipmat/attempt`'s `finalizeAttempt()`).
 */
function occurredBeforeTerminalEvent(evidence: AttemptAutopsyEvidence, eventType: string): boolean | null {
  const eventIndex = evidence.eventTimeline.findIndex((event) => event.type === eventType);
  if (eventIndex === -1) return null;
  const terminalIndex = evidence.eventTimeline.findIndex((event) => TERMINAL_EVENT_TYPES.has(event.type));
  if (terminalIndex === -1) return null;
  return eventIndex < terminalIndex;
}

export function deriveHintSolutionEvidence(evidence: AttemptAutopsyEvidence): HintSolutionEvidence {
  return {
    hintUsed: evidence.hintsUsed > 0,
    hintCount: evidence.hintsUsed,
    solutionOpened: evidence.solutionOpenedAt !== null,
    hintBeforeFinalization: occurredBeforeTerminalEvent(evidence, "hint_opened"),
    solutionBeforeFinalization: occurredBeforeTerminalEvent(evidence, "solution_opened")
  };
}
