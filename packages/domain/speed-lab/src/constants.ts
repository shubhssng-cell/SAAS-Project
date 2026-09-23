/**
 * Named, PROVISIONAL policy constants this provider introduces. None are
 * calibrated against real student data — same discipline as
 * `CALCULATION_GYM_CONSTANTS` (`@ipmat/calculation-gym`, D-054) and every
 * other threshold in this codebase. "How much evidence is enough" and
 * "what counts as slow" are NOT re-invented here — reused directly from
 * `@ipmat/mastery`'s `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT`
 * and `@ipmat/autopsy`'s `AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO`
 * respectively, avoiding a second, competing definition of either.
 */
export const SPEED_LAB_CONSTANTS = {
  /**
   * PROVISIONAL. The ceiling below which Question DNA's
   * `difficultyDimensions.conceptualLoad` (author-estimated, uncalibrated,
   * docs/DECISIONS.md D-021) is treated as "not conceptually hard" — used
   * to isolate slow-but-correct evidence from questions where the concept
   * itself, not pace, is the plausible bottleneck (docs/DECISIONS.md D-055
   * item 5).
   */
  LOW_CONCEPTUAL_LOAD_THRESHOLD: 0.5,

  /**
   * PROVISIONAL. The minimum fraction of the eligible-graded population
   * (see `speedEvidence.ts` for the exact, immutable denominator) that
   * must be correct-and-slow before speed inefficiency is reported.
   */
  SLOW_FRACTION_THRESHOLD: 0.5,

  /**
   * PROVISIONAL. `speedRatio <= this` counts as "good enough pace" for
   * PROGRESSION gates only — a deliberately separate judgment from
   * `AUTOPSY_THRESHOLDS.FAST_SPEED_RATIO` (which marks a behavior signal),
   * not a redefinition of it.
   */
  GOOD_PACE_SPEED_RATIO: 1.0
} as const;

/**
 * Progression gates are deliberately COUNT-based (has the student
 * accumulated enough demonstrated good-pace attempts), reusing
 * `@ipmat/mastery`'s `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT`
 * directly, rather than RATE-based. A rate-based gate (e.g. "75% of
 * attempts are good-paced") would be the near-exact mathematical
 * complement of the applicability trigger ("50%+ of attempts are
 * correct-and-slow") over the SAME population, making the two
 * structurally impossible to satisfy simultaneously for any nonnegative
 * counts — i.e. Speed Lab could never actually recommend a later stage
 * while still applicable. A count-based gate over a DISJOINT
 * conceptual-load slice (see `progression.ts`) has no such conflict, the
 * same reasoning `@ipmat/calculation-gym`'s disjoint foundational/mixed
 * slices already rely on (D-054).
 */
