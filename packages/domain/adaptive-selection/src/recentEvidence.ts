import { compareAttemptsChronologically } from "./trendEvidence.js";
import {
  ADAPTIVE_SELECTION_CONSTANTS,
  DIFFICULTY_TIER_ORDER,
  type AdaptiveCandidateQuestion,
  type AutopsyQuestionContext,
  type MasteryAttemptRecord,
  type TrainingNeedReasonCode
} from "./types.js";

/**
 * PHASE 3.1 -- the FIRST adaptive layer: react to the student's MOST RECENT finalized attempt.
 *
 * Everything here is derived from what actually happened and was persisted -- the attempt's outcome
 * (submitted / skipped), whether a submitted answer was correct, the server-derived time taken vs the
 * question's expected time -- plus the answered question's own Question DNA. Nothing is inferred about
 * the student: no confidence, motivation, understanding, or "weakness" is claimed from ONE attempt (the
 * multi-attempt `accuracy_weakness` / `repeated_error` / `speed_weakness` reasons, which need a minimum
 * number of observations, still outrank these). It is a small, deterministic, explainable policy --
 * NOT machine learning and NOT a mastery model.
 *
 * The four named rules (each a `RecentEvidenceSignal` -> `TrainingNeedReasonCode`):
 *   incorrect        -> `recent_incorrect`        a RELATED question that is NOT harder
 *   skipped          -> `recent_skip`             a question that is NOT harder (any concept)
 *   correct_slow     -> `recent_slow`             another question at the SAME tier and concept (do not step up yet)
 *   correct_on_pace  -> `recent_correct_on_pace`  a question that is NOT easier (step up when one exists)
 * In every rule the just-attempted question itself is excluded (no immediate repeat).
 *
 * Priority (see `TRAINING_NEED_REASON_CODES`): an incorrect answer, a skip, or a slow correct answer are immediate
 * signals -- they rank above the exposure/coverage reasons. A correct on-pace answer is NOT a need: it never overrides
 * a coverage/novelty/pressure gap or mastery-driven progression, and only decides when nothing else stands out.
 * If no candidate satisfies the winning rule, nothing is forced: selection falls through to the existing reasons and
 * finally the `difficulty_progression` fallback, so a thin pool never yields an empty answer. Independently of these
 * reasons, `selectNextQuestion()` never immediately re-serves the just-attempted question while an alternative exists.
 */

export const RECENT_EVIDENCE_SIGNALS = ["incorrect", "skipped", "correct_slow", "correct_on_pace"] as const;
export type RecentEvidenceSignal = (typeof RECENT_EVIDENCE_SIGNALS)[number];

export interface RecentEvidence {
  signal: RecentEvidenceSignal;
  /** The DNA of the question that was just attempted. */
  question: AutopsyQuestionContext;
  /** Server-derived, as persisted; `null` when unavailable. */
  timeTakenSeconds: number | null;
  expectedTimeSeconds: number | null;
}

export const RECENT_EVIDENCE_REASON_BY_SIGNAL: Record<RecentEvidenceSignal, TrainingNeedReasonCode> = {
  incorrect: "recent_incorrect",
  skipped: "recent_skip",
  correct_slow: "recent_slow",
  correct_on_pace: "recent_correct_on_pace"
};

const tierRank = (tier: AutopsyQuestionContext["difficultyTier"]): number => DIFFICULTY_TIER_ORDER.indexOf(tier);

/**
 * The signal from this student's latest submitted-or-skipped attempt, or `null` when there is none (a cold
 * start, or only abandoned attempts) -- in which case adaptive selection behaves exactly as it did before.
 * "Latest" is the last attempt in the total order `compareAttemptsChronologically` (`finalizedAt`, then `attemptId`) -- the SAME order the trend
 * and mastery sequences use, so equal or missing timestamps can never make the answer depend on the order the records were supplied in.
 * "Slow" reuses the existing per-attempt ratio (`SPEED_WEAKNESS_RATIO`, itself equal to autopsy's
 * `SLOW_SPEED_RATIO`) -- no new threshold is introduced.
 */
export function deriveRecentEvidence(studentId: string, attemptRecords: MasteryAttemptRecord[]): RecentEvidence | null {
  let latest: MasteryAttemptRecord | null = null;
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    if (record.contribution.status !== "submitted" && record.contribution.status !== "skipped") continue;
    if (latest === null || compareAttemptsChronologically(record, latest) > 0) latest = record;
  }
  if (latest === null) return null;

  const { status, isCorrect, timeTakenSeconds, expectedTimeSeconds } = latest.contribution;
  let signal: RecentEvidenceSignal;
  if (status === "skipped") {
    signal = "skipped";
  } else if (isCorrect === false) {
    signal = "incorrect";
  } else if (isCorrect === true) {
    const slow = timeTakenSeconds !== null && expectedTimeSeconds !== null && expectedTimeSeconds > 0 && timeTakenSeconds / expectedTimeSeconds >= ADAPTIVE_SELECTION_CONSTANTS.SPEED_WEAKNESS_RATIO;
    signal = slow ? "correct_slow" : "correct_on_pace";
  } else {
    return null; // a submitted attempt with no verdict is not evidence of anything
  }
  return { signal, question: latest.question, timeTakenSeconds, expectedTimeSeconds };
}

/** "Related" is purely a Question DNA fact: same concept, or either question lists the other's concept as a combination. */
function isRelated(candidate: AutopsyQuestionContext, last: AutopsyQuestionContext): boolean {
  return (
    candidate.conceptName === last.conceptName ||
    last.combinesWithConcepts.includes(candidate.conceptName) ||
    candidate.combinesWithConcepts.includes(last.conceptName)
  );
}

/** The recent-evidence reason this candidate satisfies, or `null`. Never true for the just-attempted question itself. */
export function recentEvidenceReasonFor(candidate: AdaptiveCandidateQuestion, evidence: RecentEvidence | null): TrainingNeedReasonCode | null {
  if (evidence === null) return null;
  const q = candidate.question;
  const last = evidence.question;
  if (q.questionId === last.questionId) return null;

  const rank = tierRank(q.difficultyTier);
  const lastRank = tierRank(last.difficultyTier);
  let satisfied: boolean;
  switch (evidence.signal) {
    case "incorrect":
      satisfied = isRelated(q, last) && rank <= lastRank;
      break;
    case "skipped":
      satisfied = rank <= lastRank;
      break;
    case "correct_slow":
      satisfied = rank === lastRank && q.conceptName === last.conceptName;
      break;
    case "correct_on_pace":
      satisfied = rank >= lastRank;
      break;
  }
  return satisfied ? RECENT_EVIDENCE_REASON_BY_SIGNAL[evidence.signal] : null;
}

/**
 * Within a recent-evidence bucket, the rule's own preference (lexicographic; smaller sorts first), applied
 * BEFORE the generic tie-breaks. Deliberately explicit rather than a weighted score.
 */
export function recentEvidencePreferenceKey(evidence: RecentEvidence, candidate: AdaptiveCandidateQuestion): number[] {
  const q = candidate.question;
  const last = evidence.question;
  const diff = tierRank(q.difficultyTier) - tierRank(last.difficultyTier);
  switch (evidence.signal) {
    case "incorrect":
      // 1) the same pattern family as the missed question, 2) a strictly easier tier (step down) before an equal one
      return [q.patternFamilyName === last.patternFamilyName ? 0 : 1, diff < 0 ? 0 : 1];
    case "skipped":
      // 1) a strictly easier tier, 2) the shorter expected time
      return [diff < 0 ? 0 : 1, candidate.expectedTimeSeconds];
    case "correct_slow":
      return [candidate.expectedTimeSeconds];
    case "correct_on_pace":
      // the SMALLEST step up first; staying at the same tier only when nothing harder is offered
      return [diff > 0 ? diff : Number.MAX_SAFE_INTEGER];
  }
}

export function compareByRecentPreference(evidence: RecentEvidence) {
  return (a: AdaptiveCandidateQuestion, b: AdaptiveCandidateQuestion): number => {
    const ka = recentEvidencePreferenceKey(evidence, a);
    const kb = recentEvidencePreferenceKey(evidence, b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i]! !== kb[i]!) return ka[i]! - kb[i]!;
    }
    return 0;
  };
}

/** Deterministic, observation-only wording -- states what happened and what the question is relative to it, never why or what the student is like. */
export function explainRecentEvidence(reason: TrainingNeedReasonCode, candidate: AdaptiveCandidateQuestion, evidence: RecentEvidence): string {
  const last = evidence.question;
  const rel = tierRank(candidate.question.difficultyTier) - tierRank(last.difficultyTier);
  const level = rel < 0 ? "a lower difficulty tier" : rel > 0 ? "a higher difficulty tier" : "the same difficulty tier";
  const prior = `Your most recent attempt was a "${last.difficultyTier}" "${last.patternFamilyName}" question`;
  switch (reason) {
    case "recent_incorrect":
      return `${prior} and the answer was incorrect, so this is a related question at ${level}.`;
    case "recent_skip":
      return `${prior} and it was skipped, so this is a question at ${level}.`;
    case "recent_slow":
      return `${prior}; it was answered correctly but took ${Math.round(evidence.timeTakenSeconds ?? 0)}s against ${Math.round(evidence.expectedTimeSeconds ?? 0)}s expected, so this stays at ${level} rather than stepping up.`;
    case "recent_correct_on_pace":
      return `${prior} and it was answered correctly within the expected time, so this is a question at ${level}.`;
    default:
      return `${prior}.`;
  }
}
