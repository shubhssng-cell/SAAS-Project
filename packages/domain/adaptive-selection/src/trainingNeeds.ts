import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import { computeExposureCounts, type ExposureCounts } from "./exposure.js";
import {
  ADAPTIVE_SELECTION_CONSTANTS,
  DIFFICULTY_TIER_ORDER,
  type AdaptiveCandidateQuestion,
  type DifficultyTier,
  type MasteryAttemptRecord,
  type MasteryStateResult,
  type RepairPlan,
  type TrainingNeedReasonCode
} from "./types.js";

/**
 * Everything `determineSatisfiedReasons()` needs, built ONCE per selection
 * call rather than recomputed per candidate — a per-concept mastery
 * lookup, exposure counts (see `exposure.ts`), and the active repair
 * plans, exactly as supplied by the caller.
 */
export interface TrainingNeedContext {
  masteryByConcept: Map<string, MasteryStateResult>;
  exposure: ExposureCounts;
  activeRepairPlans: RepairPlan[];
}

export function buildTrainingNeedContext(input: {
  studentId: string;
  masteryByConcept: MasteryStateResult[];
  attemptRecords: MasteryAttemptRecord[];
  activeRepairPlans: RepairPlan[];
}): TrainingNeedContext {
  return {
    masteryByConcept: new Map(input.masteryByConcept.map((m) => [m.conceptName, m])),
    exposure: computeExposureCounts(input.studentId, input.attemptRecords),
    activeRepairPlans: input.activeRepairPlans
  };
}

/**
 * The tier this student is ready to progress TO for a given concept —
 * one step above the highest tier where they have both enough
 * observations (`MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT`,
 * reused directly, never a second threshold) and accuracy at or above
 * `PROGRESSION_ACCURACY_THRESHOLD` on THAT tier specifically (reusing
 * `MasteryComponentDetail.difficultyBreakdown.byTier`, never a new
 * per-tier counting pass). Falls back to `"standard"` — never a random or
 * "harder is better" guess — when no tier has sufficient evidence at all
 * (cold start, or a student who has never demonstrated mastery on any
 * single tier yet).
 */
export function computeProgressionTargetTier(mastery: MasteryStateResult | undefined): DifficultyTier {
  if (!mastery) return "standard";

  let highestMastered: DifficultyTier | null = null;
  for (const tier of DIFFICULTY_TIER_ORDER) {
    const stats = mastery.detail.difficultyBreakdown.byTier[tier];
    if (!stats || stats.attempts < MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT) continue;
    if (stats.correct / stats.attempts >= ADAPTIVE_SELECTION_CONSTANTS.PROGRESSION_ACCURACY_THRESHOLD) {
      highestMastered = tier;
    }
  }

  if (!highestMastered) return "standard";
  const idx = DIFFICULTY_TIER_ORDER.indexOf(highestMastered);
  return DIFFICULTY_TIER_ORDER[Math.min(idx + 1, DIFFICULTY_TIER_ORDER.length - 1)]!;
}

/**
 * Every reason code (see `types.ts`'s `TRAINING_NEED_REASON_CODES`) this
 * ONE candidate satisfies, given the current context — a candidate can
 * satisfy several at once (e.g. `accuracy_weakness` AND `coverage_gap`);
 * the caller decides the single PRIMARY reason by priority order, this
 * function only reports facts.
 *
 * The load-bearing distinction this function draws, throughout: a
 * WEAKNESS claim (`accuracy_weakness`/`speed_weakness`/`repeated_error`)
 * requires an actually-MEASURED value below threshold — a `null` measure
 * (insufficient observations) NEVER produces a weakness claim, exactly
 * requirement 11's "missing/nullable mastery dimensions do not produce
 * fake conclusions." A GAP claim (`coverage_gap`/`novelty_gap`/
 * `pressure_gap`) is different in kind: the ABSENCE of exposure IS the
 * observable fact being reported, so a `null` measure legitimately DOES
 * indicate a gap there — "you have not been tested enough on this" is
 * itself true and actionable, unlike "you are bad at this."
 */
export function determineSatisfiedReasons(candidate: AdaptiveCandidateQuestion, ctx: TrainingNeedContext): TrainingNeedReasonCode[] {
  const reasons: TrainingNeedReasonCode[] = [];
  const q = candidate.question;
  const mastery = ctx.masteryByConcept.get(q.conceptName);

  const repairMatch = ctx.activeRepairPlans.find((p) => p.targetConceptName === q.conceptName && p.targetPatternFamilyName === q.patternFamilyName);
  if (repairMatch) reasons.push("repair_priority");

  const prerequisiteMatch = ctx.activeRepairPlans.find((p) => p.prerequisites.includes(q.conceptName));
  if (prerequisiteMatch) {
    const accuracy = mastery?.measures.accuracy ?? null;
    if (accuracy === null || accuracy < ADAPTIVE_SELECTION_CONSTANTS.ACCURACY_WEAKNESS_THRESHOLD) {
      reasons.push("prerequisite_weakness");
    }
  }

  if (mastery && mastery.detail.errorRecurrence.longestIncorrectStreak >= ADAPTIVE_SELECTION_CONSTANTS.REPEATED_ERROR_MIN_STREAK) {
    reasons.push("repeated_error");
  }

  if (mastery?.measures.accuracy !== null && mastery?.measures.accuracy !== undefined && mastery.measures.accuracy < ADAPTIVE_SELECTION_CONSTANTS.ACCURACY_WEAKNESS_THRESHOLD) {
    reasons.push("accuracy_weakness");
  }

  if (mastery?.measures.speedRatio !== null && mastery?.measures.speedRatio !== undefined && mastery.measures.speedRatio >= ADAPTIVE_SELECTION_CONSTANTS.SPEED_WEAKNESS_RATIO) {
    reasons.push("speed_weakness");
  }

  const attemptedCells = mastery?.detail.coverage.taxonomyCellsEncountered ?? [];
  if (!attemptedCells.includes(q.patternTaxonomyCellId)) {
    reasons.push("coverage_gap");
  }

  const familyAttempts = ctx.exposure.byPatternFamilyName.get(q.patternFamilyName) ?? 0;
  if (ctx.exposure.totalAttempts > 0 && familyAttempts <= ADAPTIVE_SELECTION_CONSTANTS.UNDEREXPOSURE_MAX_FAMILY_ATTEMPT_COUNT) {
    reasons.push("underexposure");
  }

  if (q.noveltyLevel !== "standard") {
    const novelty = mastery?.measures.noveltyHandling ?? null;
    if (novelty === null || novelty < ADAPTIVE_SELECTION_CONSTANTS.NOVELTY_WEAKNESS_THRESHOLD) {
      reasons.push("novelty_gap");
    }
  }

  if (q.testingModes.includes("time_pressured")) {
    const pressure = mastery?.measures.pressurePerformance ?? null;
    if (pressure === null || pressure < ADAPTIVE_SELECTION_CONSTANTS.PRESSURE_WEAKNESS_THRESHOLD) {
      reasons.push("pressure_gap");
    }
  }

  if (q.difficultyTier === computeProgressionTargetTier(mastery)) {
    reasons.push("difficulty_progression");
  }

  return reasons;
}
