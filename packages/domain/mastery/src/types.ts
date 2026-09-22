import type { AttemptMasteryContribution } from "@ipmat/attempt";
import type { AutopsyQuestionContext } from "@ipmat/autopsy";
import type { DifficultyTier, NoveltyLevel, PatternFamilyCoverage, PatternTaxonomyCellData } from "@ipmat/question-engine";

export type { AttemptMasteryContribution, AutopsyQuestionContext, PatternTaxonomyCellData };

/**
 * Mastery is derived, never input (docs/DATABASE.md "Mastery" rule) — this
 * package computes it FRESH from many per-attempt facts every time, never
 * accumulating a running score anywhere. It is deliberately multidimensional
 * (Phase 5B §7): there is no single field anywhere in this package that
 * collapses accuracy, speed, difficulty handling, novelty handling,
 * pressure performance, coverage, and stability into one number. See
 * `MasteryComponentMeasures` (the 5 "headline" component ratios, each
 * independently nullable) and `MasteryComponentDetail` (the full,
 * never-discarded breakdown each one was computed from).
 */

// ---------------------------------------------------------------------
// Centralized, provisional constants — Phase 5B §9: never scatter magic
// numbers, never claim a calibrated weight that doesn't exist.
// ---------------------------------------------------------------------

export const MASTERY_CONSTANTS = {
  /**
   * PROVISIONAL (Phase 5B §9) — below this many graded/relevant
   * observations for a given component, that component's headline
   * measure is reported as `null` ("insufficient data"), never a
   * precise-looking ratio computed from too few data points. Not
   * calibrated against real reliability data — the same honest caveat
   * `difficultyCalibrationStatus: "provisional"` already carries for
   * blueprint difficulty dimensions (docs/DECISIONS.md D-021). Raw counts
   * are ALWAYS preserved in `MasteryComponentDetail` regardless of this
   * gate, so "why is this null" is always answerable from the same result.
   */
  MIN_OBSERVATIONS_FOR_COMPONENT: 3
} as const;

// ---------------------------------------------------------------------
// Input — one record per finalized attempt, combining Phase 4A's
// per-attempt outcome fact with the same Question-DNA context Phase 5A
// already restated (reused directly — never a third Question DNA shape,
// Phase 5B §18).
// ---------------------------------------------------------------------

export interface MasteryAttemptRecord {
  contribution: AttemptMasteryContribution;
  question: AutopsyQuestionContext;
}

// ---------------------------------------------------------------------
// Component detail — the rich, never-discarded breakdown (Phase 5B §8)
// ---------------------------------------------------------------------

export interface SpeedStatistics {
  /** How many contributing attempts had a valid, computable speed ratio (both times present, expectedTime > 0). */
  observationCount: number;
  meanSpeedRatio: number | null;
  minSpeedRatio: number | null;
  maxSpeedRatio: number | null;
  /** Population standard deviation of the valid speedRatio observations. Null below 2 observations. */
  stdDevSpeedRatio: number | null;
}

export interface AccuracyStability {
  /** Per-attempt correctness (true/false) among SUBMITTED (graded) attempts only, in finalizedAt order — exactly what distinguishes 100/40/100/30 from 67/67/67/67 alongside stdDevAccuracy below (Phase 5B §11). */
  sequence: boolean[];
  meanAccuracy: number | null;
  /** Population standard deviation of the 0/1 correctness sequence. Null below 2 graded attempts. Two students can share the same meanAccuracy and have very different stdDevAccuracy — that difference is the whole point of preserving this field (Phase 5B §11). */
  stdDevAccuracy: number | null;
}

export interface DifficultyBreakdown {
  /** Attempts/correct-count actually observed per DifficultyTier — a tier never attempted simply has no key here (Phase 5B §13: performance on easy questions must never be read as evidence about hard questions this way). */
  byTier: Partial<Record<DifficultyTier, { attempts: number; correct: number }>>;
}

export interface NoveltyBreakdown {
  byNoveltyLevel: Partial<Record<NoveltyLevel, { attempts: number; correct: number }>>;
}

/**
 * "Pressure" is read ONLY from Question DNA's `testingModes` including
 * `"time_pressured"` — an authoritative fact about the question, never
 * inferred from how fast or slow the student happened to go (Phase 5B
 * §13: "do not invent pressure from ordinary timing alone").
 */
export interface PressureBreakdown {
  pressureAttempts: number;
  pressureCorrect: number;
  ordinaryAttempts: number;
  ordinaryCorrect: number;
}

export interface ErrorRecurrence {
  incorrectCount: number;
  /** Longest run of consecutive incorrect attempts in finalizedAt order — a single bad attempt (streak 1) stays visibly distinct from several in a row (Phase 5B §14). */
  longestIncorrectStreak: number;
}

export interface CoverageDetail {
  patternFamiliesEncountered: string[];
  taxonomyCellsEncountered: string[];
  /**
   * Reuses `@ipmat/question-engine`'s EXISTING content-coverage type
   * directly (`PatternFamilyCoverage` — never a second coverage model,
   * Phase 5B §12/§18) for whichever families the caller supplied
   * cell/question context for. NOTE this measures CONTENT readiness
   * (does the family have published questions at all), a different axis
   * from `taxonomyCellsEncountered` (has THIS STUDENT attempted a cell) —
   * both are preserved because they answer different questions; see
   * docs/PHASE_5B_REVIEW.md for why this is not a duplicate coverage
   * model but a reuse of the same taxonomy vocabulary for two distinct,
   * legitimate measurements.
   */
  contentCoverage: PatternFamilyCoverage[];
}

export interface MasteryComponentDetail {
  totalAttempts: number;
  submittedAttempts: number;
  skippedAttempts: number;
  abandonedAttempts: number;
  correctCount: number;
  incorrectCount: number;
  speedStatistics: SpeedStatistics;
  accuracyStability: AccuracyStability;
  difficultyBreakdown: DifficultyBreakdown;
  noveltyBreakdown: NoveltyBreakdown;
  pressureBreakdown: PressureBreakdown;
  errorRecurrence: ErrorRecurrence;
  coverage: CoverageDetail;
  /** Every attemptId that contributed, for auditability — the same discipline `@ipmat/autopsy`'s `RepetitionCount.attemptIds` already established. */
  contributingAttemptIds: string[];
  /**
   * Earliest/latest `finalizedAt` among contributing attempts, and the
   * full ordered attempt-id sequence — preserved so a future
   * recency-aware pass (most-recent-N window, decay weighting, whatever
   * it turns out to be) has what it needs without this phase inventing an
   * unexplained decay formula (Phase 5B §10). NO recency weighting is
   * applied anywhere in this package today — see docs/DECISIONS.md.
   */
  earliestAttemptAt: string | null;
  latestAttemptAt: string | null;
}

// ---------------------------------------------------------------------
// Component measures — the 5 "headline" ratios, each independently
// nullable, mapping to MasteryState's existing 5 Float columns
// ---------------------------------------------------------------------

export interface MasteryComponentMeasures {
  /** Maps to `MasteryState.accuracy`. Null below `MIN_OBSERVATIONS_FOR_COMPONENT` graded (submitted) attempts. */
  accuracy: number | null;
  /** Maps to `MasteryState.speedRatio` — mean of valid speedRatio observations. Null below the same threshold. */
  speedRatio: number | null;
  /** Maps to `MasteryState.noveltyHandling` — accuracy specifically on non-"standard" noveltyLevel attempts. Null below threshold or if none attempted. */
  noveltyHandling: number | null;
  /** Maps to `MasteryState.pressurePerformance` — accuracy on `time_pressured` attempts specifically. Null below threshold or if none attempted (never invented from ordinary timing). */
  pressurePerformance: number | null;
  /** Maps to `MasteryState.patternCoverage` — fraction of the concept's real taxonomy cells this student has attempted at least once. Null if the caller did not supply the full cell list (insufficient CONTEXT, not 0% coverage). */
  patternCoverage: number | null;
}

// ---------------------------------------------------------------------
// Output contract (Phase 5B §15)
// ---------------------------------------------------------------------

export interface MasteryStateResult {
  studentId: string;
  conceptId: string;
  conceptName: string;
  measures: MasteryComponentMeasures;
  detail: MasteryComponentDetail;
  /** ALWAYS "provisional" — no formula in this package has been validated against real student outcomes (mirrors docs/DECISIONS.md D-021's difficultyCalibrationStatus). */
  calibrationStatus: "provisional";
  /** Caller-supplied "now", never read from the system clock internally — the same testable-pure-function convention `@ipmat/attempt`/`@ipmat/autopsy` already use. */
  computedAt: string;
}

// ---------------------------------------------------------------------
// Persistence-ready contract — shape only, no adapter (mirrors Phase 5B
// §5's treatment of the Autopsy tables)
// ---------------------------------------------------------------------

/** The exact shape a Prisma adapter would write to `mastery_states` — requires the NEW `componentDetail` column (migration `0004_mastery_component_detail`, generated but not applied — no live database has ever been reachable). */
export interface MasteryStatePersistenceRecord {
  studentId: string;
  conceptId: string;
  accuracy: number;
  speedRatio: number;
  noveltyHandling: number;
  pressurePerformance: number;
  patternCoverage: number;
  componentDetail: Record<string, unknown>;
  computedAt: string;
}
