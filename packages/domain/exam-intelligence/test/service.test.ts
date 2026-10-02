import { ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { describe, expect, it } from "vitest";
import { ExamIntelligenceError, ExamIntelligenceService, InMemoryExamIntelligenceSource, type ExamIntelligenceSnapshot } from "../src/index.js";
import { otherExamPack, pub, record, snapshot, view } from "./fixtures.js";

const ipmat = snapshot([pub({}, { id: "a" }), pub({ patternFamilyName: "Successive Percentage Change", testingModes: ["combined"], combinesWithConcepts: ["Profit and Loss"], trapErrorTaxonomyCode: "successive_change_error" }, { id: "b" })], [record("h1")]);
const other: ExamIntelligenceSnapshot = { ...snapshot([], [], { examCode: "OTHER_EXAM", examVersion: "1", pack: otherExamPack(), patternFamilies: [] }) };
const outcomes = Array.from({ length: 30 }, (_, i) => ({ examCode: "IPMAT_INDORE", questionId: "a", studentKey: `s${i % 8}`, timeSpentSeconds: 40, isCorrect: true }));
const service = new ExamIntelligenceService(new InMemoryExamIntelligenceSource([ipmat, other], outcomes), new InMemoryExamIntelligenceSource([ipmat, other], outcomes));

describe("ExamIntelligenceService composes the pure functions over one exam", () => {
  it("coverage, queries, selection and calibration for one exam", async () => {
    const coverage = await service.coverage("IPMAT_INDORE");
    expect(coverage.examCode).toBe("IPMAT_INDORE");
    expect(coverage.examVersion).toBe(ipmatIndoreExamPack.packVersion);
    expect(coverage.content.published.find((m) => m.facet === "pattern")!.numerator).toBe(2);
    expect((await service.queries("IPMAT_INDORE")).availability().published).toBe(2);
    expect((await service.select("IPMAT_INDORE", { novelty: ["standard"] })).candidates.map((c) => c.questionId)).toEqual(["a", "b"]);
    const calibration = await service.calibration("IPMAT_INDORE");
    expect(calibration.nothingCalibrated).toBe(true);
  });
  it("another exam's intelligence is separate; its own (empty) content is not IPMAT's", async () => {
    const c = await service.coverage("OTHER_EXAM");
    expect(c.examCode).toBe("OTHER_EXAM");
    expect(c.content.published.find((m) => m.facet === "concept")).toMatchObject({ denominator: 2, numerator: 0, itemCount: 0 });
    expect((await service.queries("OTHER_EXAM")).availability().published).toBe(0);
  });
  it("outcomes are loaded per exam: another exam's outcomes never reach this exam's calibration", async () => {
    const onlyOther = new ExamIntelligenceService(new InMemoryExamIntelligenceSource([ipmat, other]), new InMemoryExamIntelligenceSource([], [{ ...outcomes[0]!, examCode: "OTHER_EXAM" }]));
    expect((await onlyOther.calibration("IPMAT_INDORE")).measurements.every((m) => m.attempts === 0)).toBe(true);
  });
  it("an unknown exam is a typed error", async () => {
    await expect(service.coverage("NO_EXAM")).rejects.toBeInstanceOf(ExamIntelligenceError);
  });
  it("a source that returns the WRONG exam's data is refused, never silently served", async () => {
    const hostile = new ExamIntelligenceService({ loadSnapshot: async () => other });
    await expect(hostile.coverage("IPMAT_INDORE")).rejects.toMatchObject({ code: "exam_mismatch" });
    const mislabelled = new ExamIntelligenceService({ loadSnapshot: async () => ({ ...ipmat, examCode: "IPMAT_INDORE", pack: otherExamPack() }) });
    await expect(mislabelled.select("IPMAT_INDORE")).rejects.toMatchObject({ code: "exam_mismatch" });
  });
  it("without an outcome source, calibration is simply all-provisional", async () => {
    const noOutcomes = new ExamIntelligenceService(new InMemoryExamIntelligenceSource([ipmat]));
    const r = await noOutcomes.calibration("IPMAT_INDORE");
    expect(r.fields.every((f) => f.provisional === f.total)).toBe(true);
  });
  it("calibration records can be supplied and are validated", async () => {
    const r = await service.calibration("IPMAT_INDORE", [{ field: "expected_time", questionId: "a", method: "", sampleAttempts: 1, sampleStudents: 1, calibratedAt: "x", calibratedBy: "" }]);
    expect(r.rejectedRecords).toHaveLength(1);
    expect(r.nothingCalibrated).toBe(true);
  });
  void view;
});
