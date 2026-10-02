/**
 * Named, PROVISIONAL policy constants for Revision (docs/DECISIONS.md D-081).
 *
 * `DORMANCY_DAYS` is a fixed PRODUCT constant: a concept becomes revision-eligible only once
 * the student's most recent graded attempt on it is at least this many days old. It is
 * deterministic, it is NOT a learned decay model, it is NOT a forgetting curve or a
 * spaced-repetition interval, and it has not been calibrated against any real student data --
 * it is intended for later empirical calibration. Revision never claims a student forgot
 * anything; it only observes that a concept has not been attempted for this long.
 *
 * A "day" is exactly 24 hours of elapsed time between the persisted attempt timestamp and the
 * caller-supplied `now` (no timezone or daylight-saving arithmetic), so the rule is identical
 * on every machine.
 */
export const REVISION_CONSTANTS = {
  /** PROVISIONAL: minimum number of GRADED attempts (submitted, correct-or-incorrect) on a concept. Revision's own named constant -- deliberately not coupled to `@ipmat/mastery`'s observation gate. */
  MIN_GRADED_ATTEMPTS: 3,
  /** PROVISIONAL: the dormancy interval in days. */
  DORMANCY_DAYS: 14
} as const;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DORMANCY_MS = REVISION_CONSTANTS.DORMANCY_DAYS * MS_PER_DAY;
