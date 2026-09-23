/**
 * Named, PROVISIONAL policy constants (docs/DECISIONS.md D-061) — NOT
 * calibrated against real student data; no live attempt-timing telemetry
 * has ever existed in this environment. Same "reuse first, invent only
 * when nothing fits, always disclose provisional status" discipline as
 * `SPEED_LAB_CONSTANTS`/`CALCULATION_GYM_CONSTANTS`. Budget-consumption
 * pressure needs no constant here — `activeSolvingTimeSeconds >=
 * blockTimeBudgetSeconds` is definitional, not a judgment call.
 */
export const PRESSURE_TRAINING_CONSTANTS = {
  /**
   * PROVISIONAL, seconds. A median inter-attempt gap below this is
   * treated as "essentially no recovery time" between questions within a
   * sustained block — short enough that a student almost certainly did
   * not pause, re-read, or mentally reset between two attempts. No
   * repository evidence (no live attempt data, no timing telemetry)
   * justifies a more precise number; this is a low, round, defensible
   * value in the same register as `SPEED_LAB_CONSTANTS.GOOD_PACE_SPEED_RATIO`.
   */
  SHORT_RECOVERY_GAP_SECONDS: 5,

  /**
   * PROVISIONAL, a fraction — a 40-PERCENTAGE-POINT drop in
   * `firstHalfAccuracy - secondHalfAccuracy` (a difference of two
   * proportions, NOT the same kind of quantity as
   * `SPEED_LAB_CONSTANTS.SLOW_FRACTION_THRESHOLD`, which is a single
   * proportion). Chosen deliberately large/conservative because the
   * minimum qualifying block size (3 total attempts) can produce a half
   * as small as ONE graded attempt, where accuracy swings between
   * 0%/50%/100% are common by pure chance — a small threshold would
   * trigger on noise, not genuine degradation. This is a disclosed,
   * honest limitation of the V1 threshold at the floor block size, not a
   * hidden gap.
   */
  DEGRADATION_ACCURACY_DROP_THRESHOLD: 0.4
} as const;
