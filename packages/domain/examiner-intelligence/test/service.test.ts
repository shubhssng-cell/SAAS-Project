import { ExamPackInvalidError, ExamPackNotFoundError, InMemoryExamPackRepository, ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import {
  ExaminerIntelligenceService,
  HistoricalRecordInvalidError,
  InMemoryHistoricalRecordRepository,
  proposeAnnotation,
  recordReview
} from "../src/index.js";
import { baseClassification, ERROR_TAXONOMY_CODES, fixtureRecord, otherExamPack, realSourceRecord } from "./fixtures.js";

function build(extraPacks = [otherExamPack()]) {
  const records = new InMemoryHistoricalRecordRepository();
  const service = new ExaminerIntelligenceService({
    records,
    packs: new InMemoryExamPackRepository([ipmatIndoreExamPack, ...extraPacks]),
    patternFamiliesFor: (examCode) => (examCode === "IPMAT_INDORE" ? percentagesPatternFamilies : []),
    errorTaxonomyCodes: ERROR_TAXONOMY_CODES
  });
  return { records, service };
}
const all = { examCode: "IPMAT_INDORE", origins: ["fixture", "real_source"] } as const;

describe("ExaminerIntelligenceService", () => {
  it("saves a valid record and answers queries about it", async () => {
    const { service } = build();
    await service.saveRecord(fixtureRecord("a"));
    expect((await service.listRecords(all)).map((r) => r.id)).toEqual(["a"]);
    expect(await service.patternsForConcept(all, "Percentages")).toEqual([{ value: "Reverse Percentage", count: 1 }]);
    expect((await service.summarize(all)).recordCount).toBe(1);
  });

  it("rejects an invalid record with every issue and stores nothing", async () => {
    const { service, records } = build();
    const bad = fixtureRecord("bad", { classification: baseClassification({ conceptName: "Nope", expectedTimeSeconds: 0 }) });
    await expect(service.saveRecord(bad)).rejects.toBeInstanceOf(HistoricalRecordInvalidError);
    expect(await records.listByExamCode("IPMAT_INDORE")).toEqual([]);
  });

  it("validates a record against ITS OWN exam's pack: IPMAT-valid DNA labelled as another exam is rejected", async () => {
    const { service } = build();
    await expect(service.saveRecord(fixtureRecord("x", { examCode: "OTHER_EXAM" }))).rejects.toBeInstanceOf(HistoricalRecordInvalidError);
  });

  it("an unknown exam is a typed pack-not-found error; an invalid pack fails closed", async () => {
    const { service } = build();
    await expect(service.saveRecord(fixtureRecord("x", { examCode: "NO_EXAM" }))).rejects.toBeInstanceOf(ExamPackNotFoundError);
    const broken = otherExamPack();
    broken.relations.push({ from: "percentages", to: "ghost", type: "prerequisite", rationale: "r", sharedKnowledge: "s", usefulForQuestionGeneration: true, requirementLevel: "required", certainty: "probable", source: "human", provenance: broken.provenance });
    const b = build([broken]);
    await expect(b.service.saveRecord(fixtureRecord("y", { examCode: "OTHER_EXAM", classification: { ...baseClassification(), examCode: "OTHER_EXAM" } }))).rejects.toBeInstanceOf(ExamPackInvalidError);
  });

  it("the repository never returns another exam's record, and never lets an id move between exams", async () => {
    const { records } = build();
    await records.save(fixtureRecord("shared-id"));
    expect(await records.findById("OTHER_EXAM", "shared-id")).toBeNull();
    expect(await records.listByExamCode("OTHER_EXAM")).toEqual([]);
    await expect(records.save(fixtureRecord("shared-id", { examCode: "OTHER_EXAM" }))).rejects.toThrow();
  });

  it("exam isolation end to end: exam A's evidence is invisible to exam B, even with identical concept names", async () => {
    const { service } = build();
    await service.saveRecord(fixtureRecord("ipmat-1"));
    expect((await service.summarize({ examCode: "OTHER_EXAM", origins: ["fixture", "real_source"] })).recordCount).toBe(0);
    expect(await service.patternsForConcept({ examCode: "OTHER_EXAM", origins: ["fixture"] }, "Percentages")).toEqual([]);
    expect(await service.sourceSupport("OTHER_EXAM", "ipmat-1")).toBeNull();
  });

  it("full lifecycle: raw import -> AI proposal -> human review; the proposal only counts as intelligence after the review", async () => {
    const { service } = build();
    const rawRecord = realSourceRecord("life", { annotationState: "raw_imported", classification: null, authorship: null, review: null });
    await service.saveRecord(rawRecord);
    expect((await service.listRecords({ examCode: "IPMAT_INDORE" })).length).toBe(0);

    const proposed = proposeAnnotation(rawRecord, { classification: baseClassification(), authorship: "ai_assisted", proposedBy: "classifier-v1" });
    await service.saveRecord(proposed);
    expect((await service.patternsForConcept({ examCode: "IPMAT_INDORE" }, "Percentages"))).toEqual([]); // still a proposal
    expect((await service.patternsForConcept({ examCode: "IPMAT_INDORE", states: ["candidate_annotation"] }, "Percentages"))).toEqual([{ value: "Reverse Percentage", count: 1 }]);

    await service.saveRecord(recordReview(proposed, { reviewedBy: "editor", reviewedAt: "2026-10-02T10:00:00.000Z" }));
    expect(await service.patternsForConcept({ examCode: "IPMAT_INDORE" }, "Percentages")).toEqual([{ value: "Reverse Percentage", count: 1 }]);
    const support = await service.sourceSupport("IPMAT_INDORE", "life");
    expect(support?.authorship).toBe("ai_assisted");
    expect(support?.review?.reviewedBy).toBe("editor");
  });

  it("fixtures never appear in default (real-source) intelligence", async () => {
    const { service } = build();
    await service.saveRecord(fixtureRecord("fx"));
    await service.saveRecord(realSourceRecord("real"));
    expect((await service.listRecords({ examCode: "IPMAT_INDORE" })).map((r) => r.id)).toEqual(["real"]);
    expect((await service.listRecords(all)).map((r) => r.id)).toEqual(["fx", "real"]);
  });

  it("stored records are copies: mutating a returned record does not change the store", async () => {
    const { service } = build();
    await service.saveRecord(fixtureRecord("a"));
    const [r] = await service.listRecords(all);
    r!.classification!.skill = "tampered";
    expect((await service.listRecords(all))[0]!.classification!.skill).not.toBe("tampered");
  });
});
