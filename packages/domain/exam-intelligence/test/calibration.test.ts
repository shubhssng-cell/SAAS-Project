import { describe, expect, it } from "vitest";
import {
  buildCalibrationReport,
  CALIBRATABLE_FIELDS,
  CALIBRATION_CONSTANTS,
  calibrationRecordProblems,
  compareExpectedVsObserved,
  deriveCalibrationStatus,
  measureObservedOutcomes,
  type CalibrationRecord,
  type QuestionOutcome
} from "../src/index.js";
import { pub, snapshot, view } from "./fixtures.js";

const outcomes = (questionId: string, n: number, students: number, over: Partial<QuestionOutcome> = {}): QuestionOutcome[] =>
  Array.from({ length: n }, (_, i) => ({ questionId, studentKey: `s${i % students}`, timeSpentSeconds: 30 + (i % 10), isCorrect: i % 3 !== 0, ...over }));
const record = (over: Partial<CalibrationRecord> = {}): CalibrationRecord => ({
  field: "expected_time",
  questionId: null,
  method: "fixture-method (synthetic, for tests)",
  sampleAttempts: CALIBRATION_CONSTANTS.MIN_ATTEMPTS_FOR_CALIBRATION,
  sampleStudents: CALIBRATION_CONSTANTS.MIN_DISTINCT_STUDENTS_FOR_CALIBRATION,
  calibratedAt: "2026-10-02T00:00:00.000Z",
  calibratedBy: "fixture-calibrator",
  ...over
});

describe("the minimums are themselves provisional", () => {
  it("are labelled provisional and are not presented as statistical thresholds", () => {
    expect(CALIBRATION_CONSTANTS.status).toBe("provisional");
    expect(CALIBRATION_CONSTANTS.MIN_DISTINCT_STUDENTS_FOR_CALIBRATION).toBeGreaterThan(CALIBRATION_CONSTANTS.MIN_DISTINCT_STUDENTS_FOR_OBSERVATION);
    expect(CALIBRATION_CONSTANTS.MIN_ATTEMPTS_FOR_CALIBRATION).toBeGreaterThan(CALIBRATION_CONSTANTS.MIN_ATTEMPTS_FOR_OBSERVATION);
  });
});

describe("observed measurements: insufficient data reports nothing", () => {
  it("below the minimum attempts OR distinct students: insufficient_data and NO aggregate", () => {
    const few = measureObservedOutcomes(["q"], outcomes("q", 9, 9))[0]!;
    expect(few).toMatchObject({ state: "insufficient_data", attempts: 9, accuracy: null, time: null });
    const oneStudent = measureObservedOutcomes(["q"], outcomes("q", 50, 1))[0]!;
    expect(oneStudent).toMatchObject({ state: "insufficient_data", distinctStudents: 1, accuracy: null, time: null });
    expect(measureObservedOutcomes(["q"], outcomes("q", 50, 4))[0]!.state).toBe("insufficient_data");
  });
  it("a question with no outcomes at all is insufficient_data", () => {
    expect(measureObservedOutcomes(["q"], [])[0]).toMatchObject({ state: "insufficient_data", attempts: 0, distinctStudents: 0 });
  });
  it("at the minimums: descriptive aggregates only (accuracy and time), still not a calibration", () => {
    const m = measureObservedOutcomes(["q"], outcomes("q", 20, 5))[0]!;
    expect(m.state).toBe("measured");
    expect(m.accuracy).toMatchObject({ graded: 20 });
    expect(m.time).toMatchObject({ n: 20, minSeconds: 30, maxSeconds: 39 });
    expect(Object.keys(m).sort()).toEqual(["accuracy", "attempts", "distinctStudents", "questionId", "state", "time"]);
  });
  it("never exposes a student key, however many outcomes", () => {
    expect(JSON.stringify(measureObservedOutcomes(["q"], outcomes("q", 50, 10)))).not.toMatch(/"s\d|studentKey/);
  });
  it("is order-independent; ungraded or untimed outcomes are skipped, not defaulted", () => {
    const o = [...outcomes("q", 20, 5), { questionId: "q", studentKey: "z", timeSpentSeconds: null, isCorrect: null }];
    const a = measureObservedOutcomes(["q"], o)[0]!;
    expect(measureObservedOutcomes(["q"], [...o].reverse())[0]).toEqual(a);
    expect(a.accuracy!.graded).toBe(20);
    expect(a.time!.n).toBe(20);
  });
  it("measures only the questions asked about", () => {
    expect(measureObservedOutcomes(["a"], [...outcomes("a", 20, 5), ...outcomes("b", 20, 5)]).map((m) => m.questionId)).toEqual(["a"]);
  });
});

describe("calibration status: provisional | observed | calibrated", () => {
  const measured = measureObservedOutcomes(["q"], outcomes("q", 20, 5))[0]!;
  const insufficient = measureObservedOutcomes(["q"], outcomes("q", 3, 3))[0]!;

  it("with nothing measured every annotation is PROVISIONAL", () => {
    for (const field of CALIBRATABLE_FIELDS) expect(deriveCalibrationStatus({ field, measurement: null, record: null }).status).toBe("provisional");
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: insufficient, record: null }).status).toBe("provisional");
  });
  it("measurements without an asserted calibration are OBSERVED (outcome-measurable fields only)", () => {
    for (const field of ["expected_time", "difficulty_tier", "difficulty_dimensions"] as const) {
      const v = deriveCalibrationStatus({ field, measurement: measured, record: null });
      expect(v.status).toBe("observed");
      expect(v.missing).toContain("calibration_record");
    }
    for (const field of ["novelty", "trap", "pattern_classification", "exam_relevance"] as const) expect(deriveCalibrationStatus({ field, measurement: measured, record: null }).status).toBe("provisional");
  });
  it("CALIBRATED only with an explicit, sufficient record (and sufficient measurements for outcome fields)", () => {
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record() }).status).toBe("calibrated");
    expect(deriveCalibrationStatus({ field: "novelty", measurement: null, record: record({ field: "novelty" }) }).status).toBe("calibrated");
  });
  it("a record without enough samples, a method or a calibrator is NOT calibration", () => {
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record({ sampleAttempts: 99 }) }).status).toBe("observed");
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record({ sampleStudents: 29 }) }).status).toBe("observed");
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record({ method: " " }) }).status).toBe("observed");
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record({ calibratedBy: "" }) }).status).toBe("observed");
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record({ calibratedAt: "yesterday" }) }).status).toBe("observed");
    expect(deriveCalibrationStatus({ field: "novelty", measurement: null, record: record({ field: "novelty", sampleAttempts: 1 }) }).status).toBe("provisional");
  });
  it("a record cannot calibrate an outcome field whose measurements are insufficient, nor a different field", () => {
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: insufficient, record: record() })).toMatchObject({ status: "provisional", missing: expect.arrayContaining(["outcome_measurements_insufficient"]) });
    expect(deriveCalibrationStatus({ field: "expected_time", measurement: measured, record: record({ field: "trap" }) }).status).toBe("observed");
  });
  it("record validation lists every problem", () => {
    expect(calibrationRecordProblems(record())).toEqual([]);
    expect(calibrationRecordProblems(record({ method: "", calibratedBy: "", sampleAttempts: 0, sampleStudents: 0, calibratedAt: "x" }))).toHaveLength(5);
  });
});

describe("expected vs observed is descriptive and never calibrated", () => {
  const q = pub({ expectedTimeSeconds: 60 }, { id: "q" });
  it("with enough data: the ratio of observed median to expected time, labelled descriptive_only and 'observed'", () => {
    const c = compareExpectedVsObserved(q, measureObservedOutcomes(["q"], outcomes("q", 20, 5))[0]!);
    expect(c).toMatchObject({ state: "measured", expectedTimeSeconds: 60, interpretation: "descriptive_only", status: "observed" });
    expect(c.observedMedianSeconds).toBeCloseTo(34.5, 5);
    expect(c.timeRatio).toBeCloseTo(34.5 / 60, 5);
    expect(c.observedAccuracy).not.toBeNull();
  });
  it("without enough data: no ratio, no accuracy, status provisional", () => {
    const c = compareExpectedVsObserved(q, measureObservedOutcomes(["q"], outcomes("q", 4, 2))[0]!);
    expect(c).toMatchObject({ state: "insufficient_data", observedMedianSeconds: null, timeRatio: null, observedAccuracy: null, status: "provisional" });
    expect(compareExpectedVsObserved(q, null).status).toBe("provisional");
  });
  it("never yields 'calibrated', never changes the annotation, and infers no difficulty", () => {
    const c = compareExpectedVsObserved(q, measureObservedOutcomes(["q"], outcomes("q", 500, 100))[0]!);
    expect(c.status).not.toBe("calibrated");
    expect(c.expectedTimeSeconds).toBe(60);
    expect(JSON.stringify(c)).not.toMatch(/difficultyScore|inferredDifficulty|curve|percentile/i);
  });
});

describe("the calibration report over a snapshot", () => {
  const qs = [pub({}, { id: "a" }), pub({}, { id: "b" }), view({ id: "draft", validationState: "draft" }), view({ id: "fx", isFixture: true })];
  it("with no outcomes and no records: everything provisional, nothing calibrated (the honest present state)", () => {
    const r = buildCalibrationReport(snapshot(qs), []);
    expect(r.nothingCalibrated).toBe(true);
    for (const f of r.fields) expect(f).toMatchObject({ total: 2, provisional: 2, observed: 0, calibrated: 0 }); // only the 2 published, non-fixture questions
    expect(r.constants.status).toBe("provisional");
    expect(r.comparisons.every((c) => c.state === "insufficient_data")).toBe(true);
  });
  it("tiny fixtures can never produce a calibrated value, even with a record asserted", () => {
    const r = buildCalibrationReport(snapshot(qs), [...outcomes("a", 6, 3), ...outcomes("b", 8, 4)], [record()]);
    expect(r.nothingCalibrated).toBe(true);
    expect(r.fields.find((f) => f.field === "expected_time")!.calibrated).toBe(0);
  });
  it("sufficient measurements are reported as observed, and calibrated only with a sufficient explicit record", () => {
    const o = [...outcomes("a", 120, 40), ...outcomes("b", 20, 6)];
    const observed = buildCalibrationReport(snapshot(qs), o);
    const t = observed.fields.find((f) => f.field === "expected_time")!;
    expect(t).toMatchObject({ observed: 2, calibrated: 0 });
    const calibrated = buildCalibrationReport(snapshot(qs), o, [record({ questionId: "a" })]);
    const t2 = calibrated.fields.find((f) => f.field === "expected_time")!;
    expect(t2).toMatchObject({ calibrated: 1, observed: 1 });
    expect(calibrated.nothingCalibrated).toBe(false);
  });
  it("ignores outcomes and records for questions that are not this exam's published content, and reports rejected records", () => {
    const r = buildCalibrationReport(snapshot(qs), outcomes("not-in-exam", 50, 20), [record({ questionId: "not-in-exam" }), record({ method: "" })]);
    expect(r.measurements.every((m) => m.state === "insufficient_data")).toBe(true);
    expect(r.rejectedRecords.map((x) => x.problems)).toEqual([expect.arrayContaining(["question_not_in_this_exam_or_not_published"]), expect.arrayContaining(["method_required"])]);
  });
  it("is deterministic and independent of outcome order", () => {
    const o = [...outcomes("a", 30, 8), ...outcomes("b", 30, 8)];
    expect(buildCalibrationReport(snapshot(qs), [...o].reverse())).toEqual(buildCalibrationReport(snapshot(qs), o));
  });
  it("reports no student identity, mastery or confidence", () => {
    const text = JSON.stringify(buildCalibrationReport(snapshot(qs), outcomes("a", 30, 8))).toLowerCase();
    for (const forbidden of ["studentkey", "studentid", "mastery", "confidence", "ability", "skill level"]) expect(text, forbidden).not.toContain(forbidden);
  });
});
