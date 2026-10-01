import type { RepairPlan } from "./types.js";

/**
 * Phase 4 Unit 4 -- the RepairPlan lifecycle, as ONE pure, deterministic, order-independent rule over a student's persisted finalized attempts.
 * It uses the EXISTING status vocabulary (`pending | in_progress | completed`); nothing here invents a status.
 *
 * Both constants are PROVISIONAL authored policy (like `REPAIR_SELECTION_CONSTANTS`, `AUTOPSY_THRESHOLDS`): not calibrated against real
 * outcomes. They are deliberately conservative.
 */
export const REPAIR_LIFECYCLE_POLICY = {
  /**
   * How many of the student's MOST RECENT attempts on questions that directly match the plan (same pattern family, or the same targeted
   * error category) must be correct, back to back, before the repair is considered DEMONSTRATED. One correct answer is evidence of
   * improvement, never proof; two in a row is still a small amount of evidence, not mastery.
   */
  DEMONSTRATED_MIN_CONSECUTIVE_CORRECT: 2,
  /**
   * A plan must never keep the student in repair forever (a broken or unwinnable plan must not block ordinary practice). After this many
   * finalized attempts on the target concept since the confirmation -- whatever their outcome -- the repair round is over ("round_limit").
   * This is NOT a claim that the mistake is fixed; the ordinary adaptive evidence tiers keep reacting to a continuing weakness, and a new
   * incorrect answer can be confirmed into a new plan.
   */
  MAX_REPAIR_ROUNDS: 3
} as const;

export type RepairLifecycleStatus = "pending" | "in_progress" | "completed";
/** WHY a plan is completed. `demonstrated` = recent direct-match answers were correct; `round_limit` = the round budget ran out (no claim about the mistake). */
export type RepairCompletionBasis = "demonstrated" | "round_limit";

/** One finalized attempt, restated for the lifecycle rule. */
export interface RepairLifecycleAttempt {
  attemptId: string;
  questionId: string;
  conceptName: string;
  patternFamilyName: string;
  trapErrorTaxonomyCode: string | null;
  status: "submitted" | "skipped" | "abandoned";
  isCorrect: boolean | null;
  finalizedAt: string | null;
}

export type RepairLifecyclePlan = Pick<RepairPlan, "targetConceptName" | "targetPatternFamilyName" | "targetErrorTaxonomyCode" | "confirmationSource">;

export interface RepairLifecycleResult {
  status: RepairLifecycleStatus;
  /** Finalized attempts on the target concept strictly after the confirmation (graded or skipped). */
  rounds: number;
  /** How many of those directly match the plan (same pattern family, or the same targeted error category). */
  directMatchRounds: number;
  /** The current trailing run of correct answers among the direct-match attempts. */
  consecutiveDirectCorrect: number;
  completionBasis: RepairCompletionBasis | null;
}

const ms = (iso: string | null): number => {
  const value = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NaN;
};

/**
 * - `pending`     no finalized attempt on the target concept since the confirmation.
 * - `in_progress` at least one, and neither completion condition holds.
 * - `completed`   (a) `demonstrated`: the last DEMONSTRATED_MIN_CONSECUTIVE_CORRECT direct-match attempts are all correct; or
 *                 (b) `round_limit`: MAX_REPAIR_ROUNDS finalized attempts on the target concept since the confirmation.
 *
 * Counted: attempts finalized strictly AFTER `hypothesisConfirmedAt`, on the target concept, that are `submitted` or `skipped` (an
 * abandoned attempt is not evidence). The attempt that was diagnosed is never counted (it predates the confirmation, and is excluded by
 * id as well). A skipped direct-match attempt is an attempt that was not answered correctly, so it breaks the correct run.
 * The result depends only on the SET of attempts: they are ordered by (finalizedAt, attemptId) here, so input order cannot matter.
 */
export function evaluateRepairLifecycle(plan: RepairLifecyclePlan, attempts: readonly RepairLifecycleAttempt[]): RepairLifecycleResult {
  const confirmedAtMs = ms(plan.confirmationSource.hypothesisConfirmedAt);

  const relevant = attempts
    .filter((a) => (a.status === "submitted" || a.status === "skipped") && a.attemptId !== plan.confirmationSource.attemptId && a.conceptName === plan.targetConceptName)
    .filter((a) => {
      const at = ms(a.finalizedAt);
      return Number.isFinite(at) && Number.isFinite(confirmedAtMs) && at > confirmedAtMs;
    })
    .sort((a, b) => ms(a.finalizedAt) - ms(b.finalizedAt) || a.attemptId.localeCompare(b.attemptId));

  const direct = relevant.filter(
    (a) => a.patternFamilyName === plan.targetPatternFamilyName || (plan.targetErrorTaxonomyCode !== null && a.trapErrorTaxonomyCode === plan.targetErrorTaxonomyCode)
  );

  let run = 0;
  for (let i = direct.length - 1; i >= 0; i--) {
    if (direct[i]!.status === "submitted" && direct[i]!.isCorrect === true) run += 1;
    else break;
  }

  const base = { rounds: relevant.length, directMatchRounds: direct.length, consecutiveDirectCorrect: run };
  if (run >= REPAIR_LIFECYCLE_POLICY.DEMONSTRATED_MIN_CONSECUTIVE_CORRECT) return { ...base, status: "completed", completionBasis: "demonstrated" };
  if (relevant.length >= REPAIR_LIFECYCLE_POLICY.MAX_REPAIR_ROUNDS) return { ...base, status: "completed", completionBasis: "round_limit" };
  if (relevant.length >= 1) return { ...base, status: "in_progress", completionBasis: null };
  return { ...base, status: "pending", completionBasis: null };
}
