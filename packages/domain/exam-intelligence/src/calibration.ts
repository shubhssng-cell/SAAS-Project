import { ExamIntelligenceError, type CalibrationStatus, type ContentQuestionView, type ExamIntelligenceSnapshot } from "./types.js";

/**
 * CALIBRATION architecture (docs/DECISIONS.md D-086).
 *
 * Every annotation on a question - expected time, difficulty tier and
 * dimensions, novelty, trap, pattern classification, exam relevance - is a
 * human or model ANNOTATION. This module makes that explicit and gives the
 * future empirical calibration a place to land, WITHOUT claiming any
 * calibration the data cannot support:
 *
 *   provisional  an annotation with no measurements behind it (every value today)
 *   observed     measurements EXIST and are reported next to the annotation, but are
 *                not enough, or not asserted, to call the annotation calibrated
 *   calibrated   ONLY when an explicit calibration RECORD exists (method, sample
 *                sizes, date, who) and the sample sizes meet the minimums - and, for
 *                outcome-measurable fields, the measurements meet them too.
 *                Nothing in the system derives `calibrated` by itself.
 *
 * The minimums below are themselves PROVISIONAL, uncalibrated numbers (they are
 * NOT statistically justified). No difficulty curve, percentile or ML model
 * is computed, and nothing is fitted from small samples. Observed measurements
 * are AGGREGATED and non-identifying: below the minimum number of distinct
 * students a question reports only that data is insufficient.
 */
export const CALIBRATION_CONSTANTS = {
  /** These numbers are provisional themselves. */
  status: "provisional",
  /** Below this, a question's outcomes are NOT reported at all (insufficient data; also a privacy floor). */
  MIN_DISTINCT_STUDENTS_FOR_OBSERVATION: 5,
  MIN_ATTEMPTS_FOR_OBSERVATION: 10,
  /** A calibration record must rest on at least this much. */
  MIN_DISTINCT_STUDENTS_FOR_CALIBRATION: 30,
  MIN_ATTEMPTS_FOR_CALIBRATION: 100
} as const;

export const CALIBRATABLE_FIELDS = ["expected_time", "difficulty_tier", "difficulty_dimensions", "novelty", "trap", "pattern_classification", "exam_relevance"] as const;
export type CalibratableField = (typeof CALIBRATABLE_FIELDS)[number];

/** Fields an outcome measurement (time, correctness) can bear on. The others have no outcome measure today and can only be provisional or explicitly recorded. */
const OUTCOME_MEASURABLE: readonly CalibratableField[] = ["expected_time", "difficulty_tier", "difficulty_dimensions"];

/** One graded attempt, reduced to what calibration needs. `studentKey` is an opaque, non-reversible key used ONLY to count distinct students; it is never reported. */
export interface QuestionOutcome {
  questionId: string;
  studentKey: string;
  timeSpentSeconds: number | null;
  isCorrect: boolean | null;
}

export interface ObservedMeasurement {
  questionId: string;
  /** `measured` only above the minimums; otherwise `insufficient_data` and NO aggregate is reported. */
  state: "measured" | "insufficient_data";
  attempts: number;
  distinctStudents: number;
  accuracy: { correct: number; graded: number; rate: number } | null;
  time: { n: number; medianSeconds: number; meanSeconds: number; minSeconds: number; maxSeconds: number } | null;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Descriptive aggregation only. Deterministic; independent of outcome order; never reads or returns a student identity. */
export function measureObservedOutcomes(questionIds: readonly string[], outcomes: readonly QuestionOutcome[]): ObservedMeasurement[] {
  return [...new Set(questionIds)].sort().map((questionId) => {
    const mine = outcomes.filter((o) => o.questionId === questionId);
    const students = new Set(mine.map((o) => o.studentKey));
    const base = { questionId, attempts: mine.length, distinctStudents: students.size };
    if (mine.length < CALIBRATION_CONSTANTS.MIN_ATTEMPTS_FOR_OBSERVATION || students.size < CALIBRATION_CONSTANTS.MIN_DISTINCT_STUDENTS_FOR_OBSERVATION) {
      return { ...base, state: "insufficient_data" as const, accuracy: null, time: null };
    }
    const graded = mine.filter((o) => o.isCorrect !== null);
    const times = mine.map((o) => o.timeSpentSeconds).filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0);
    const correct = graded.filter((o) => o.isCorrect === true).length;
    return {
      ...base,
      state: "measured" as const,
      accuracy: graded.length > 0 ? { correct, graded: graded.length, rate: correct / graded.length } : null,
      time: times.length > 0 ? { n: times.length, medianSeconds: median(times), meanSeconds: times.reduce((a, b) => a + b, 0) / times.length, minSeconds: Math.min(...times), maxSeconds: Math.max(...times) } : null
    };
  });
}

/** An EXPLICIT assertion that a field has been calibrated: by whom, how, on how much data. Nothing creates one automatically. */
export interface CalibrationRecord {
  field: CalibratableField;
  /** null = the whole exam; otherwise one question. */
  questionId: string | null;
  method: string;
  sampleAttempts: number;
  sampleStudents: number;
  /** ISO-8601. */
  calibratedAt: string;
  calibratedBy: string;
}

export function calibrationRecordProblems(r: CalibrationRecord): string[] {
  const problems: string[] = [];
  if (!CALIBRATABLE_FIELDS.includes(r.field)) problems.push("unknown_field");
  if (typeof r.method !== "string" || r.method.trim() === "") problems.push("method_required");
  if (typeof r.calibratedBy !== "string" || r.calibratedBy.trim() === "") problems.push("calibrated_by_required");
  if (typeof r.calibratedAt !== "string" || Number.isNaN(Date.parse(r.calibratedAt))) problems.push("calibrated_at_required");
  if (!Number.isInteger(r.sampleAttempts) || r.sampleAttempts < CALIBRATION_CONSTANTS.MIN_ATTEMPTS_FOR_CALIBRATION) problems.push("sample_attempts_below_minimum");
  if (!Number.isInteger(r.sampleStudents) || r.sampleStudents < CALIBRATION_CONSTANTS.MIN_DISTINCT_STUDENTS_FOR_CALIBRATION) problems.push("sample_students_below_minimum");
  return problems;
}

export interface CalibrationVerdict {
  status: CalibrationStatus;
  /** Why this status and no stronger one. */
  reason: string;
  /** What would be needed for the next status. Empty when calibrated. */
  missing: string[];
}

export function deriveCalibrationStatus(args: { field: CalibratableField; measurement: ObservedMeasurement | null; record: CalibrationRecord | null }): CalibrationVerdict {
  const { field, measurement, record } = args;
  const measurable = OUTCOME_MEASURABLE.includes(field);
  const measured = measurement?.state === "measured";
  if (record) {
    const problems = calibrationRecordProblems(record);
    if (record.field !== field) problems.push("record_is_for_another_field");
    if (measurable && !measured) problems.push("outcome_measurements_insufficient");
    if (problems.length === 0) return { status: "calibrated", reason: `an explicit calibration record by ${record.calibratedBy} (${record.method}) on ${record.sampleStudents} students / ${record.sampleAttempts} attempts`, missing: [] };
    return { status: measurable && measured ? "observed" : "provisional", reason: `a calibration record exists but is not sufficient: ${problems.join(", ")}`, missing: problems };
  }
  if (measurable && measured) return { status: "observed", reason: "measurements exist and are reported beside the annotation, but no calibration has been asserted", missing: ["calibration_record"] };
  if (measurable) return { status: "provisional", reason: "no sufficient outcome measurements exist (insufficient data)", missing: ["outcome_measurements", "calibration_record"] };
  return { status: "provisional", reason: "no outcome measure exists for this annotation; it is an annotation only", missing: ["calibration_record"] };
}

export interface ExpectedVsObserved {
  questionId: string;
  expectedTimeSeconds: number;
  difficultyTier: string;
  state: "measured" | "insufficient_data";
  observedMedianSeconds: number | null;
  /** observedMedian / expected, descriptive only. Null when there is not enough data. */
  timeRatio: number | null;
  observedAccuracy: number | null;
  /** Always descriptive: no difficulty is inferred, no annotation is changed, nothing is called calibrated. */
  interpretation: "descriptive_only";
  status: CalibrationStatus;
}

/** Puts the annotation beside the observation. Never produces `calibrated`, never adjusts the annotation, never fits anything. */
export function compareExpectedVsObserved(view: Pick<ContentQuestionView, "id" | "dna">, measurement: ObservedMeasurement | null): ExpectedVsObserved {
  const measured = measurement?.state === "measured";
  const median = measured ? measurement!.time?.medianSeconds ?? null : null;
  return {
    questionId: view.id,
    expectedTimeSeconds: view.dna.expectedTimeSeconds,
    difficultyTier: view.dna.difficultyTier,
    state: measured ? "measured" : "insufficient_data",
    observedMedianSeconds: median,
    timeRatio: median !== null && view.dna.expectedTimeSeconds > 0 ? median / view.dna.expectedTimeSeconds : null,
    observedAccuracy: measured ? measurement!.accuracy?.rate ?? null : null,
    interpretation: "descriptive_only",
    status: measured ? "observed" : "provisional"
  };
}

export interface CalibrationFieldSummary {
  field: CalibratableField;
  total: number;
  provisional: number;
  observed: number;
  calibrated: number;
}

export interface CalibrationReport {
  examCode: string;
  /** The minimums are provisional themselves; stated so no reader mistakes them for statistical thresholds. */
  constants: typeof CALIBRATION_CONSTANTS;
  fields: CalibrationFieldSummary[];
  /** True while no field of any question is calibrated: the honest present state. */
  nothingCalibrated: boolean;
  measurements: ObservedMeasurement[];
  comparisons: ExpectedVsObserved[];
  /** Records supplied but rejected as insufficient/invalid, with reasons. */
  rejectedRecords: Array<{ field: string; questionId: string | null; problems: string[] }>;
}

/**
 * Calibration status per field across a snapshot's PUBLISHED questions, from
 * supplied outcomes and explicit calibration records. Reports measurements;
 * never fits, never promotes. Exam-scoped: an outcome or record for a question
 * that is not in this snapshot is ignored.
 */
export function buildCalibrationReport(snapshot: ExamIntelligenceSnapshot, outcomes: readonly QuestionOutcome[], records: readonly CalibrationRecord[] = []): CalibrationReport {
  const views = snapshot.questions.filter((q) => q.validationState === "published" && q.dna?.examCode === snapshot.examCode && !q.isFixture);
  const ids = new Set(views.map((v) => v.id));
  const measurements = measureObservedOutcomes([...ids], outcomes.filter((o) => ids.has(o.questionId)));
  const byId = new Map(measurements.map((m) => [m.questionId, m]));
  const summaries = new Map<CalibratableField, CalibrationFieldSummary>(CALIBRATABLE_FIELDS.map((f) => [f, { field: f, total: 0, provisional: 0, observed: 0, calibrated: 0 }]));
  const rejected: CalibrationReport["rejectedRecords"] = [];
  for (const v of views) {
    for (const field of CALIBRATABLE_FIELDS) {
      const record = records.find((r) => r.field === field && (r.questionId === v.id || r.questionId === null)) ?? null;
      const verdict = deriveCalibrationStatus({ field, measurement: byId.get(v.id) ?? null, record });
      const s = summaries.get(field)!;
      s.total += 1;
      s[verdict.status] += 1;
    }
  }
  for (const r of records) {
    const problems = calibrationRecordProblems(r);
    if (r.questionId !== null && !ids.has(r.questionId)) problems.push("question_not_in_this_exam_or_not_published");
    if (problems.length > 0) rejected.push({ field: r.field, questionId: r.questionId, problems });
  }
  return {
    examCode: snapshot.examCode,
    constants: CALIBRATION_CONSTANTS,
    fields: CALIBRATABLE_FIELDS.map((f) => summaries.get(f)!),
    nothingCalibrated: [...summaries.values()].every((s) => s.calibrated === 0),
    measurements,
    comparisons: views.map((v) => compareExpectedVsObserved(v, byId.get(v.id) ?? null)).sort((a, b) => (a.questionId < b.questionId ? -1 : 1)),
    rejectedRecords: rejected
  };
}

export { ExamIntelligenceError };
