import { describe, expect, it } from "vitest";
import { computeTrapAssociatedFailureRecurrence } from "../src/trapEvidence.js";
import { makeAttemptRecord, makeErrorTaxonomyEntry, makeFailingBatch, STUDENT, TRAP_CODE } from "./fixtures.js";

function evidenceFor(code: string, records: ReturnType<typeof makeFailingBatch>, errorTaxonomy?: ReturnType<typeof makeErrorTaxonomyEntry>[]) {
  return computeTrapAssociatedFailureRecurrence(STUDENT, records, errorTaxonomy).find((e) => e.errorTaxonomyCode === code);
}

describe("computeTrapAssociatedFailureRecurrence", () => {
  it("zero history -> no evidence entries at all", () => {
    expect(computeTrapAssociatedFailureRecurrence(STUDENT, [], undefined)).toEqual([]);
  });

  it("no trap-tagged failures -> no evidence for a code that never appears", () => {
    const records = [makeAttemptRecord({ trapErrorTaxonomyCode: null, isCorrect: false })];
    expect(computeTrapAssociatedFailureRecurrence(STUDENT, records, undefined)).toEqual([]);
  });

  it("one failing trap-tagged question -> distinct failing count 1", () => {
    const evidence = evidenceFor(TRAP_CODE, makeFailingBatch(1));
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(1);
  });

  it("two distinct failing questionIds, same code -> distinct failing count 2", () => {
    const evidence = evidenceFor(TRAP_CODE, makeFailingBatch(2));
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });

  it("the same question retried many times contributes at most ONE distinct failing question id", () => {
    const sharedQuestionId = "same-question";
    const records = Array.from({ length: 5 }, () => makeAttemptRecord({ questionId: sharedQuestionId, isCorrect: false }));
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toEqual([sharedQuestionId]);
  });

  it("different codes must not combine", () => {
    const records = [...makeFailingBatch(1, { trapErrorTaxonomyCode: "code-a" }), ...makeFailingBatch(1, { trapErrorTaxonomyCode: "code-b" })];
    const evidence = computeTrapAssociatedFailureRecurrence(STUDENT, records, undefined);
    const a = evidence.find((e) => e.errorTaxonomyCode === "code-a");
    const b = evidence.find((e) => e.errorTaxonomyCode === "code-b");
    expect(a?.distinctFailingQuestionIds).toHaveLength(1);
    expect(b?.distinctFailingQuestionIds).toHaveLength(1);
  });

  it("same code across different concepts still accumulates into ONE code's evidence", () => {
    const records = [...makeFailingBatch(1, { conceptName: "Percentages" }), ...makeFailingBatch(1, { conceptName: "Ratio" })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
    expect(evidence?.distinctConceptNames.sort()).toEqual(["Percentages", "Ratio"]);
  });

  it("same code, same taxonomy cell across both failing questions -> distinctPatternTaxonomyCellIds has 1 entry", () => {
    const records = makeFailingBatch(2, { patternTaxonomyCellId: "cell-a" });
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctPatternTaxonomyCellIds).toEqual(["cell-a"]);
  });

  it("same code, different taxonomy cells across the two failing questions -> distinctPatternTaxonomyCellIds has 2 entries", () => {
    const records = [...makeFailingBatch(1, { patternTaxonomyCellId: "cell-a" }), ...makeFailingBatch(1, { patternTaxonomyCellId: "cell-b" })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctPatternTaxonomyCellIds.sort()).toEqual(["cell-a", "cell-b"]);
  });

  it("hints do NOT invalidate incorrect recurrence evidence", () => {
    const records = makeFailingBatch(2, { hintsUsed: 3 });
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });

  it("skipped attempts are excluded", () => {
    const records = [...makeFailingBatch(2), makeAttemptRecord({ status: "skipped", isCorrect: null })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });

  it("abandoned attempts are excluded", () => {
    const records = [...makeFailingBatch(2), makeAttemptRecord({ status: "abandoned", isCorrect: null })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });

  it("correct trap-tagged attempts are excluded from failure recurrence entirely", () => {
    const records = [...makeFailingBatch(2), makeAttemptRecord({ isCorrect: true })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });

  it("hint-free resistance is tracked separately from failure recurrence", () => {
    const records = [...makeFailingBatch(2), makeAttemptRecord({ isCorrect: true, hintsUsed: 0 })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.resistanceQuestionIds).toHaveLength(1);
    expect(evidence?.hintAssistedResistanceQuestionIds).toHaveLength(0);
  });

  it("hint-assisted resistance is tracked separately from hint-free resistance", () => {
    const records = [...makeFailingBatch(2), makeAttemptRecord({ isCorrect: true, hintsUsed: 1 })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.resistanceQuestionIds).toHaveLength(0);
    expect(evidence?.hintAssistedResistanceQuestionIds).toHaveLength(1);
  });

  it("cumulative history: many LATER correct attempts do not remove or reduce prior failure recurrence", () => {
    const records = [...makeFailingBatch(2), ...Array.from({ length: 10 }, () => makeAttemptRecord({ isCorrect: true }))];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });

  it("taxonomy enrichment missing for the code does not discard the raw-code evidence", () => {
    const records = makeFailingBatch(2);
    const evidence = evidenceFor(TRAP_CODE, records, [makeErrorTaxonomyEntry({ code: "some-other-code" })]);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
    expect(evidence?.diagnosticNotes.some((n) => n === `taxonomy_enrichment_missing:${TRAP_CODE}`)).toBe(true);
  });

  it("enrichment omitted vs. missing vs. empty all produce identical recurrence counts (only diagnostic notes differ)", () => {
    const records = makeFailingBatch(2);
    const omitted = evidenceFor(TRAP_CODE, records, undefined);
    const empty = evidenceFor(TRAP_CODE, records, []);
    const missing = evidenceFor(TRAP_CODE, records, [makeErrorTaxonomyEntry({ code: "unrelated" })]);

    expect(omitted?.distinctFailingQuestionIds).toEqual(empty?.distinctFailingQuestionIds);
    expect(omitted?.distinctFailingQuestionIds).toEqual(missing?.distinctFailingQuestionIds);

    expect(omitted?.diagnosticNotes.some((n) => n.startsWith("taxonomy_enrichment_missing"))).toBe(false);
    expect(empty?.diagnosticNotes.some((n) => n === `taxonomy_enrichment_missing:${TRAP_CODE}`)).toBe(true);
    expect(missing?.diagnosticNotes.some((n) => n === `taxonomy_enrichment_missing:${TRAP_CODE}`)).toBe(true);
  });

  it("enrichment present and matching adds a resolved label/category note, never affecting the recurrence count", () => {
    const records = makeFailingBatch(2);
    const enriched = evidenceFor(TRAP_CODE, records, [makeErrorTaxonomyEntry()]);
    expect(enriched?.distinctFailingQuestionIds).toHaveLength(2);
    expect(enriched?.diagnosticNotes.some((n) => n.includes("Base confusion"))).toBe(true);
    expect(enriched?.diagnosticNotes.some((n) => n.startsWith("taxonomy_enrichment_missing"))).toBe(false);
  });

  it("only counts attempts for THIS student", () => {
    const records = [...makeFailingBatch(2), ...makeFailingBatch(2, { studentId: "someone-else" })];
    const evidence = evidenceFor(TRAP_CODE, records);
    expect(evidence?.distinctFailingQuestionIds).toHaveLength(2);
  });
});
