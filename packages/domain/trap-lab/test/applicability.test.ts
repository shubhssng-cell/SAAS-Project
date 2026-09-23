import { describe, expect, it } from "vitest";
import { evaluateTrapLab } from "../src/applicability.js";
import type { TrapLabRequirement } from "../src/types.js";
import { makeAttemptRecord, makeErrorTaxonomyEntry, makeFailingBatch, STUDENT, TRAP_CODE } from "./fixtures.js";

function asTrapLabRequirement(requirement: unknown): TrapLabRequirement {
  return requirement as TrapLabRequirement;
}

describe("evaluateTrapLab", () => {
  it("insufficient_evidence: zero incorrect trap-tagged attempts anywhere", () => {
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [] });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("insufficient_evidence: only correct attempts and attempts with no trap code", () => {
    const attemptRecords = [makeAttemptRecord({ isCorrect: true }), makeAttemptRecord({ trapErrorTaxonomyCode: null, isCorrect: false })];
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("no_recurring_trap_detected: one failing trap-tagged question, below the recurrence threshold", () => {
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords: makeFailingBatch(1), candidates: [] });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("no_recurring_trap_detected");
  });

  it("no_recurring_trap_detected: the SAME question retried many times never reaches recurrence", () => {
    const sharedQuestionId = "same-question";
    const attemptRecords = Array.from({ length: 5 }, () => makeAttemptRecord({ questionId: sharedQuestionId, isCorrect: false }));
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("no_recurring_trap_detected");
  });

  it("applicable: two distinct failing questions, same code", () => {
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords: makeFailingBatch(2), candidates: [] });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asTrapLabRequirement(outcome.requirement).targetErrorTaxonomyCode).toBe(TRAP_CODE);
  });

  it("applicable: recurrence across two DIFFERENT concepts for the same code (mandatory cross-concept case)", () => {
    const attemptRecords = [...makeFailingBatch(1, { conceptName: "Percentages" }), ...makeFailingBatch(1, { conceptName: "Ratio" })];
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asTrapLabRequirement(outcome.requirement).targetErrorTaxonomyCode).toBe(TRAP_CODE);
  });

  it("V1 evaluate() never populates targetConceptName, even when recurrence was observed within one concept", () => {
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords: makeFailingBatch(2, { conceptName: "Percentages" }), candidates: [] });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asTrapLabRequirement(outcome.requirement).targetConceptName).toBeUndefined();
  });

  it("unrelated codes sharing the same ErrorCategory do NOT combine", () => {
    const attemptRecords = [...makeFailingBatch(1, { trapErrorTaxonomyCode: "code-a" }), ...makeFailingBatch(1, { trapErrorTaxonomyCode: "code-b" })];
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("no_recurring_trap_detected");
  });

  it("multiple recurring codes: the largest distinct-failing-question count wins", () => {
    const attemptRecords = [...makeFailingBatch(2, { trapErrorTaxonomyCode: "code-a" }), ...makeFailingBatch(3, { trapErrorTaxonomyCode: "code-b" })];
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asTrapLabRequirement(outcome.requirement).targetErrorTaxonomyCode).toBe("code-b");
  });

  it("equal recurrence counts: deterministic lexicographic error-code tie-break", () => {
    const attemptRecords = [...makeFailingBatch(2, { trapErrorTaxonomyCode: "zebra_code" }), ...makeFailingBatch(2, { trapErrorTaxonomyCode: "alpha_code" })];
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asTrapLabRequirement(outcome.requirement).targetErrorTaxonomyCode).toBe("alpha_code");
  });

  it("cumulative history (mandatory): 2 historical failures establish recurrence, and remain applicable after many later correct attempts", () => {
    const attemptRecords = [...makeFailingBatch(2), ...Array.from({ length: 10 }, () => makeAttemptRecord({ isCorrect: true }))];
    const outcome = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) {
      expect(outcome.requirement.notes?.some((n) => n.includes("cumulative"))).toBe(true);
    }
  });

  it("enrichment omitted vs. supplied-but-missing the target code produce an identical applicability decision", () => {
    const attemptRecords = makeFailingBatch(2);
    const omitted = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [] });
    const missing = evaluateTrapLab({ studentId: STUDENT, masteryByConcept: [], attemptRecords, errorTaxonomy: [makeErrorTaxonomyEntry({ code: "unrelated" })], candidates: [] });

    expect(omitted.applicable).toBe(missing.applicable);
    if (omitted.applicable && missing.applicable) {
      expect(asTrapLabRequirement(omitted.requirement).targetErrorTaxonomyCode).toBe(asTrapLabRequirement(missing.requirement).targetErrorTaxonomyCode);
    }
  });
});
