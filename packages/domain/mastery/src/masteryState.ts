import type { QuestionRefForCoverage } from "@ipmat/question-engine";
import { buildComponentDetail } from "./componentDetail.js";
import {
  MASTERY_CONSTANTS,
  type MasteryAttemptRecord,
  type MasteryComponentDetail,
  type MasteryComponentMeasures,
  type MasteryStateResult,
  type PatternTaxonomyCellData
} from "./types.js";

/**
 * Derives the 5 "headline" component measures from a `MasteryComponentDetail`
 * — every one independently nullable, gated on
 * `MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT` so a measure computed
 * from too few observations is reported as "insufficient data" rather than
 * a falsely precise ratio (Phase 5B §9/§17). `patternCoverage` uses a
 * different gate: it is null whenever the caller didn't supply the
 * concept's full taxonomy-cell list, since there is then no honest
 * denominator to divide by at all (not an observation-count question).
 */
function deriveMeasures(detail: MasteryComponentDetail, totalTaxonomyCellsForConcept: number | null): MasteryComponentMeasures {
  const minObs = MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT;

  const accuracy = detail.submittedAttempts >= minObs ? detail.accuracyStability.meanAccuracy : null;
  const speedRatio = detail.speedStatistics.observationCount >= minObs ? detail.speedStatistics.meanSpeedRatio : null;

  const nonStandardNovelty = Object.entries(detail.noveltyBreakdown.byNoveltyLevel).filter(([level]) => level !== "standard");
  const nonStandardAttempts = nonStandardNovelty.reduce((sum, [, v]) => sum + (v?.attempts ?? 0), 0);
  const nonStandardCorrect = nonStandardNovelty.reduce((sum, [, v]) => sum + (v?.correct ?? 0), 0);
  const noveltyHandling = nonStandardAttempts >= minObs ? nonStandardCorrect / nonStandardAttempts : null;

  const { pressureAttempts, pressureCorrect } = detail.pressureBreakdown;
  const pressurePerformance = pressureAttempts >= minObs ? pressureCorrect / pressureAttempts : null;

  const patternCoverage =
    totalTaxonomyCellsForConcept === null || totalTaxonomyCellsForConcept === 0
      ? null
      : detail.coverage.taxonomyCellsEncountered.length / totalTaxonomyCellsForConcept;

  return { accuracy, speedRatio, noveltyHandling, pressurePerformance, patternCoverage };
}

export interface ComputeMasteryStateInput {
  studentId: string;
  conceptId: string;
  conceptName: string;
  /** Caller-supplied "now" — never read from the system clock internally (Phase 5B, consistent with `@ipmat/attempt`/`@ipmat/autopsy`'s pure-function convention). */
  now: string;
  /** The concept's FULL real taxonomy-cell list (from `@ipmat/question-engine`) — required to compute `patternCoverage` honestly; omit and it stays `null` rather than guessed. */
  allTaxonomyCellsForConcept?: PatternTaxonomyCellData[];
  /** Real `Question` rows (validation-state only) for the SAME cells, needed to compute `coverage.contentCoverage` (content readiness) via the EXISTING `computePatternFamilyReadiness()` — omit and `contentCoverage` stays `[]`. */
  questionsForCoverage?: QuestionRefForCoverage[];
}

/**
 * The primary, concept-level aggregation (Phase 5B §7/§8) — the same grain
 * as the real `MasteryState` table (`@@unique([studentId, conceptId])`).
 * Filters `allRecords` down to this student's records for this concept
 * internally (a caller does not need to pre-filter); records for other
 * students/concepts are silently excluded, not an error (the same
 * behavior `@ipmat/autopsy`'s `deriveHistoricalSignals()` already uses).
 */
export function computeMasteryState(allRecords: MasteryAttemptRecord[], input: ComputeMasteryStateInput): MasteryStateResult {
  const records = allRecords.filter(
    (r) => r.contribution.studentId === input.studentId && r.contribution.conceptId === input.conceptId
  );

  const detail = buildComponentDetail(records, {
    allTaxonomyCellsForConcept: input.allTaxonomyCellsForConcept,
    questionsForCoverage: input.questionsForCoverage
  });

  const totalCellsForConcept = input.allTaxonomyCellsForConcept
    ? input.allTaxonomyCellsForConcept.filter((cell) => cell.conceptName === input.conceptName).length
    : null;

  return {
    studentId: input.studentId,
    conceptId: input.conceptId,
    conceptName: input.conceptName,
    measures: deriveMeasures(detail, totalCellsForConcept),
    detail,
    calibrationStatus: "provisional",
    computedAt: input.now
  };
}

/**
 * A pattern-family-scoped slice of the SAME component-detail logic
 * `computeMasteryState()` uses — reuses `buildComponentDetail()` directly
 * rather than a second counting implementation (Phase 5B §8: "support
 * aggregation by ... pattern family"). Callers typically pre-filter
 * `records` to one student first; this function does not assume that —
 * it only filters by `patternFamilyName`.
 */
export function computePatternFamilyMasteryDetail(records: MasteryAttemptRecord[], patternFamilyName: string): MasteryComponentDetail {
  return buildComponentDetail(records.filter((r) => r.question.patternFamilyName === patternFamilyName));
}

/** Same as `computePatternFamilyMasteryDetail()`, scoped to one PatternTaxonomyCell instead (Phase 5B §8: "support aggregation by ... taxonomy cell"). */
export function computeTaxonomyCellMasteryDetail(records: MasteryAttemptRecord[], taxonomyCellId: string): MasteryComponentDetail {
  return buildComponentDetail(records.filter((r) => r.question.patternTaxonomyCellId === taxonomyCellId));
}
