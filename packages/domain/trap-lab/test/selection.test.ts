import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { selectTrapLabQuestion } from "../src/selection.js";
import type { TrapLabRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, STUDENT, TRAP_CODE } from "./fixtures.js";

const REQUIREMENT: TrapLabRequirement = { targetErrorTaxonomyCode: TRAP_CODE };

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

describe("selectTrapLabQuestion", () => {
  it("no_eligible_question when the pool is empty", () => {
    const outcome = selectTrapLabQuestion("trap-lab", context(), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes a candidate whose trapErrorTaxonomyCode does not match", () => {
    const wrongTrap = makeCandidate({ trapErrorTaxonomyCode: "other_code" });
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [wrongTrap] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("accepts a candidate whose trapErrorTaxonomyCode matches", () => {
    const matching = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE });
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [matching] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("selected");
  });

  it("excludes unpublished candidates, correctly counted as ineligible", () => {
    const draft = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE }, { validationState: "draft" });
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [draft] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") expect(outcome.diagnostics.excludedIneligibleCount).toBe(1);
  });

  it("excludes a structurally malformed candidate, counted separately from ineligible", () => {
    const malformed = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE });
    // @ts-expect-error -- deliberately corrupting the fixture to prove the malformed-candidate guard.
    malformed.question.patternTaxonomyCellId = undefined;
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [malformed] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") {
      expect(outcome.diagnostics.excludedMalformedCount).toBe(1);
      expect(outcome.diagnostics.excludedIneligibleCount).toBe(0);
    }
  });

  it("multiple eligible candidates: one is selected deterministically", () => {
    const a = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "q-a" });
    const b = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "q-b" });
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [a, b] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("selected");
  });

  it("prefers a candidate whose taxonomy cell the student has NOT previously attempted against this trap code", () => {
    const seenCell = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, patternTaxonomyCellId: "cell-seen", questionId: "seen-cell-question" });
    const unseenCell = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, patternTaxonomyCellId: "cell-unseen", questionId: "unseen-cell-question" });
    const attemptRecords = [makeAttemptRecord({ patternTaxonomyCellId: "cell-seen", isCorrect: false })];

    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [seenCell, unseenCell], attemptRecords }), REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-cell-question");
  });

  it("a correct attempt against a taxonomy cell also counts as having seen it (variation still preferred)", () => {
    const seenCell = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, patternTaxonomyCellId: "cell-seen", questionId: "seen-cell-question" });
    const unseenCell = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, patternTaxonomyCellId: "cell-unseen", questionId: "unseen-cell-question" });
    const attemptRecords = [makeAttemptRecord({ patternTaxonomyCellId: "cell-seen", isCorrect: true })];

    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [seenCell, unseenCell], attemptRecords }), REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-cell-question");
  });

  it("within the same partition, prefers the least-exposed candidate", () => {
    const seen = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "seen-question" });
    const unseen = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "unseen-question" });
    const attemptRecords = [makeAttemptRecord({ questionId: "seen-question", isCorrect: false }), makeAttemptRecord({ questionId: "seen-question", isCorrect: false })];

    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [seen, unseen], attemptRecords }), REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-question");
  });

  it("falls back to lexicographic questionId as the final deterministic tie-break", () => {
    const b = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "b-question" });
    const a = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "a-question" });
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [b, a] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("a-question");
  });

  it("repeated invocation with identical input gives the identical answer (determinism)", () => {
    const candidates = [makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "b-question" }), makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, questionId: "a-question" })];
    const ctx = context({ candidates });
    const first = selectTrapLabQuestion("trap-lab", ctx, REQUIREMENT, "test");
    const second = selectTrapLabQuestion("trap-lab", ctx, REQUIREMENT, "test");
    expect(first).toEqual(second);
  });

  it("an explicit targetConceptName filters candidates by concept", () => {
    const wrongConcept = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, conceptName: "Ratio" });
    const rightConcept = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, conceptName: "Percentages" });
    const requirement: TrapLabRequirement = { targetErrorTaxonomyCode: TRAP_CODE, targetConceptName: "Percentages" };

    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [wrongConcept, rightConcept] }), requirement, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.conceptName).toBe("Percentages");
  });

  it("an ABSENT targetConceptName does NOT filter by concept -- default Trap Lab selection is cross-concept", () => {
    const otherConcept = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE, conceptName: "Ratio" });
    const outcome = selectTrapLabQuestion("trap-lab", context({ candidates: [otherConcept] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("selected");
  });
});
