import { ADAPTIVE_SELECTION_CONSTANTS, DIFFICULTY_TIER_ORDER, type AdaptiveCandidateQuestion, type DifficultyTier, type MasteryAttemptRecord, type TrainingNeedReasonCode } from "./types.js";

/**
 * PHASE 3.3 -- TREND evidence: how has the student's OBSERVED performance on a concept changed over their persisted history?
 *
 *   RECENT       "what just happened?"                     the latest finalized attempt            (recentEvidence.ts)
 *   ACCUMULATED  "what has been demonstrated overall?"     whole-history aggregates from mastery   (accumulatedEvidence.ts)
 *   TREND        "how is that performance changing?"       the LAST window vs. everything before   (this file)
 *
 * Trend evidence describes changes in observed performance; it does not diagnose the student. It is three explicit, descriptive
 * pieces, never a blended score:
 *
 * ORDER/WINDOW RULES (all deterministic, all reconstructed from persisted attempts on every call -- no stored or process-local state)
 *   - Only this student's GRADED attempts (`status === "submitted"` with a verdict) on the concept count. Skipped and abandoned
 *     attempts are NOT graded: they are not observations of correctness, so they neither join a window nor break a streak
 *     (the same convention the mastery correctness sequence and `trailingIncorrectStreak` already follow).
 *   - Order is `finalizedAt` ascending; equal (or missing) timestamps are ordered by `attemptId`, so the same persisted history can
 *     never yield two different orders. `@ipmat/mastery` uses the identical tie-break for its own sequence.
 *   - RECENT window = the last `TREND_RECENT_WINDOW` (3) graded attempts. EARLIER = every graded attempt before that window.
 *   - A trend claim needs at least `TREND_MIN_EARLIER_OBSERVATIONS` (1) earlier attempt (sustained success) or 2 (any CHANGE claim):
 *     fewer than that is "insufficient history" and `kind` is `null` -- no claim, never a guess.
 *
 * KINDS (thresholds are the EXISTING accuracy thresholds -- 0.6 weakness, 0.8 progression; no new accuracy threshold is introduced)
 *   improving              earlier accuracy < 0.6 (>= 2 earlier attempts) AND all 3 recent answers correct   (old failure, current recovery)
 *   deteriorating          earlier accuracy >= 0.8 (>= 2 earlier attempts) AND recent accuracy < 0.6          (strong older history, weaker recent)
 *   persistent_difficulty  earlier accuracy < 0.6 (>= 2 earlier attempts) AND recent accuracy < 0.6          (one success does not undo it)
 *   sustained_success      all 3 recent answers correct, and not `improving`                                  (a run, not a one-off)
 *   otherwise `null`       mixed evidence -- no trend claim.
 * "All 3 correct" (not 2 of 3) is required for `improving` on purpose: a single temporary success inside an old problem must not read as recovery.
 */

export const TREND_KINDS = ["improving", "deteriorating", "persistent_difficulty", "sustained_success"] as const;
export type TrendKind = (typeof TREND_KINDS)[number];

export const TREND_CONSTANTS = {
  /** Number of most recent GRADED attempts on a concept that form the RECENT window. PROVISIONAL, authored policy -- not calibrated against real data. */
  TREND_RECENT_WINDOW: 3,
  /** Earlier graded attempts required before any trend claim at all (sustained success). */
  TREND_MIN_EARLIER_OBSERVATIONS: 1,
  /** Earlier graded attempts required before a CHANGE claim (improving / deteriorating / persistent): two points, so one old outcome is not a "history". */
  TREND_MIN_EARLIER_FOR_CHANGE: 2
} as const;

export interface TrendStreak {
  outcome: "correct" | "incorrect";
  length: number;
}

/** Descriptive facts about the ORDER of a student's graded outcomes on one concept -- counts and runs, nothing inferred. */
export interface TrendEvidence {
  conceptName: string;
  gradedAttempts: number;
  recentWindowSize: number;
  recentCorrect: number;
  recentIncorrect: number;
  earlierGraded: number;
  earlierCorrect: number;
  /** The run of identical graded outcomes ENDING at the most recent graded attempt (the CURRENT run -- never the longest ever). */
  currentStreak: TrendStreak;
  /** The run of the opposite outcome immediately before the current one, or `null` when there is none. */
  previousStreak: TrendStreak | null;
  /** Difficulty tier of the most recent graded attempt on this concept. */
  lastGradedTier: DifficultyTier;
  /** `null` = insufficient history or mixed evidence: no trend claim. */
  kind: TrendKind | null;
}

const tierRank = (tier: DifficultyTier): number => DIFFICULTY_TIER_ORDER.indexOf(tier);

function finalizedMs(record: MasteryAttemptRecord): number {
  const ms = record.contribution.finalizedAt ? Date.parse(record.contribution.finalizedAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** `finalizedAt` ascending, ties (and missing timestamps) by `attemptId` -- total and deterministic. */
export function compareAttemptsChronologically(a: MasteryAttemptRecord, b: MasteryAttemptRecord): number {
  const diff = finalizedMs(a) - finalizedMs(b);
  if (diff !== 0) return diff;
  return a.contribution.attemptId < b.contribution.attemptId ? -1 : a.contribution.attemptId > b.contribution.attemptId ? 1 : 0;
}

function runsEndingAt(outcomes: boolean[]): { current: TrendStreak; previous: TrendStreak | null } {
  const last = outcomes[outcomes.length - 1]!;
  let i = outcomes.length - 1;
  while (i >= 0 && outcomes[i] === last) i -= 1;
  const current: TrendStreak = { outcome: last ? "correct" : "incorrect", length: outcomes.length - 1 - i };
  if (i < 0) return { current, previous: null };
  const before = outcomes[i]!;
  let j = i;
  while (j >= 0 && outcomes[j] === before) j -= 1;
  return { current, previous: { outcome: before ? "correct" : "incorrect", length: i - j } };
}

/** Classification from the two windows' counts alone -- exported so the boundaries can be tested directly. */
export function classifyTrend(recent: { correct: number; total: number }, earlier: { correct: number; total: number }): TrendKind | null {
  if (recent.total < TREND_CONSTANTS.TREND_RECENT_WINDOW || earlier.total < TREND_CONSTANTS.TREND_MIN_EARLIER_OBSERVATIONS) return null;
  const recentAccuracy = recent.correct / recent.total;
  const earlierAccuracy = earlier.correct / earlier.total;
  const canClaimChange = earlier.total >= TREND_CONSTANTS.TREND_MIN_EARLIER_FOR_CHANGE;
  const allRecentCorrect = recent.correct === recent.total;
  const { ACCURACY_WEAKNESS_THRESHOLD: LOW, PROGRESSION_ACCURACY_THRESHOLD: HIGH } = ADAPTIVE_SELECTION_CONSTANTS;

  if (canClaimChange && earlierAccuracy < LOW && allRecentCorrect) return "improving";
  if (allRecentCorrect) return "sustained_success";
  if (canClaimChange && earlierAccuracy >= HIGH && recentAccuracy < LOW) return "deteriorating";
  if (canClaimChange && earlierAccuracy < LOW && recentAccuracy < LOW) return "persistent_difficulty";
  return null;
}

/** `null` when the student has no graded attempt on the concept. Pure function of the persisted attempt records. */
export function deriveTrendEvidence(studentId: string, conceptName: string, attemptRecords: MasteryAttemptRecord[]): TrendEvidence | null {
  const graded = attemptRecords
    .filter((r) => r.contribution.studentId === studentId && r.question.conceptName === conceptName && r.contribution.status === "submitted" && r.contribution.isCorrect !== null)
    .sort(compareAttemptsChronologically);
  if (graded.length === 0) return null;

  const outcomes = graded.map((r) => r.contribution.isCorrect === true);
  const split = Math.max(0, outcomes.length - TREND_CONSTANTS.TREND_RECENT_WINDOW);
  const earlier = outcomes.slice(0, split);
  const recent = outcomes.slice(split);
  const { current, previous } = runsEndingAt(outcomes);
  const count = (xs: boolean[]): number => xs.filter(Boolean).length;

  return {
    conceptName,
    gradedAttempts: outcomes.length,
    recentWindowSize: recent.length,
    recentCorrect: count(recent),
    recentIncorrect: recent.length - count(recent),
    earlierGraded: earlier.length,
    earlierCorrect: count(earlier),
    currentStreak: current,
    previousStreak: previous,
    lastGradedTier: graded[graded.length - 1]!.question.difficultyTier,
    kind: classifyTrend({ correct: count(recent), total: recent.length }, { correct: count(earlier), total: earlier.length })
  };
}

export const TREND_REASON_BY_KIND: Partial<Record<TrendKind, TrainingNeedReasonCode>> = {
  improving: "recent_improvement",
  deteriorating: "recent_deterioration"
};

/**
 * The trend reason this candidate satisfies, or `null`. Always the candidate's OWN concept's trend, never the just-attempted question.
 *   recent_improvement     same concept, NOT easier than the last graded tier (build on the progress)
 *   recent_deterioration   same concept, NOT harder than the last graded tier (keep difficulty steady)
 */
export function trendReasonFor(candidate: AdaptiveCandidateQuestion, trend: TrendEvidence | undefined): TrainingNeedReasonCode | null {
  if (!trend || trend.kind === null) return null;
  const reason = TREND_REASON_BY_KIND[trend.kind];
  if (!reason) return null;
  const rank = tierRank(candidate.question.difficultyTier);
  const lastRank = tierRank(trend.lastGradedTier);
  if (reason === "recent_improvement") return rank >= lastRank ? reason : null;
  return rank <= lastRank ? reason : null;
}

/** Within a trend bucket, the rule's own preference (lexicographic, smaller first) -- explicit, not a weighted score. */
export function trendPreferenceKey(trend: TrendEvidence, candidate: AdaptiveCandidateQuestion): number[] {
  const diff = tierRank(candidate.question.difficultyTier) - tierRank(trend.lastGradedTier);
  if (trend.kind === "improving") return [diff > 0 ? diff : Number.MAX_SAFE_INTEGER]; // smallest step up; same tier only when nothing harder is offered
  return [Math.abs(diff)]; // deteriorating: the same tier first, then the nearest easier one
}

export function compareByTrendPreference(trendByConcept: Map<string, TrendEvidence>) {
  return (a: AdaptiveCandidateQuestion, b: AdaptiveCandidateQuestion): number => {
    const ta = trendByConcept.get(a.question.conceptName);
    const tb = trendByConcept.get(b.question.conceptName);
    if (!ta || !tb) return 0;
    const ka = trendPreferenceKey(ta, a);
    const kb = trendPreferenceKey(tb, b);
    return ka[0]! - kb[0]!;
  };
}
