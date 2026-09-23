/**
 * Named, PROVISIONAL policy constants this provider introduces. None of
 * these are calibrated against real student data — same discipline as
 * `AUTOPSY_THRESHOLDS` (`@ipmat/autopsy`) and `ADAPTIVE_SELECTION_CONSTANTS`
 * (`@ipmat/adaptive-selection`), and the same honest caveat Question DNA's
 * own `difficultyCalibrationStatus: "provisional"` carries (docs/DECISIONS.md
 * D-021) for the `computationalLoad` metadata these thresholds are applied
 * to. "How much evidence is enough" itself is NOT re-invented here — it is
 * reused directly from `@ipmat/mastery`'s `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT`
 * wherever a slice's sample size needs to be judged sufficient.
 */
export const CALCULATION_GYM_CONSTANTS = {
  /**
   * PROVISIONAL. Question DNA's `difficultyDimensions.computationalLoad` is
   * a 0..1, author-estimated, uncalibrated proxy for how arithmetic-heavy a
   * question is (docs/DECISIONS.md D-021) — NOT a measured fact. This
   * threshold is only the split point this provider uses to separate
   * "calculation-heavy" from "calculation-light" attempts of the SAME
   * concept for comparison purposes; it is never presented as a measured
   * boundary.
   */
  HIGH_COMPUTATIONAL_LOAD_THRESHOLD: 0.5,

  /**
   * PROVISIONAL. The minimum gap (low-load accuracy minus high-load
   * accuracy, both fractions in [0, 1]) required, for the SAME concept and
   * the SAME student, before "friction conditioned on high computational
   * load" is reported — as opposed to ordinary conceptual weakness, which
   * would depress accuracy on BOTH slices roughly equally.
   */
  CALCULATION_FRICTION_ACCURACY_GAP: 0.2,

  /**
   * PROVISIONAL. The accuracy a stage's own qualifying attempts must reach
   * before progression advances past it. Applied independently at EACH
   * transition (foundational->mixed, mixed->time_pressured) against THAT
   * transition's own evidence slice — never inherited from an earlier
   * stage's result. See docs/DECISIONS.md D-054.
   */
  STAGE_MASTERY_ACCURACY: 0.75
} as const;
