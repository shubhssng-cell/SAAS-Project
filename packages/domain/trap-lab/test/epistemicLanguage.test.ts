import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { TrapLabProvider } from "../src/provider.js";
import { evaluateTrapLab } from "../src/applicability.js";
import { makeAttemptRecord, makeCandidate, makeErrorTaxonomyEntry, makeFailingBatch, STUDENT, TRAP_CODE } from "./fixtures.js";

const FORBIDDEN_PATTERNS = [/confirmed/i, /proven/i, /diagnos/i, /student'?s reasoning/i];

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function collectStrings(outcome: unknown): string[] {
  const strings: string[] = [];
  if (outcome !== null && typeof outcome === "object") {
    for (const value of Object.values(outcome)) {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") strings.push(item);
        }
      } else if (typeof value === "object" && value !== null) {
        strings.push(...collectStrings(value));
      }
    }
  }
  return strings;
}

function assertNoForbiddenLanguage(strings: string[]): void {
  for (const text of strings) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(text), `String "${text}" must not match ${pattern}`).toBe(false);
    }
  }
}

/**
 * Epistemic-boundary regression test (docs/DECISIONS.md D-056): every
 * string Trap Lab itself produces (explanation/notes/diagnostics) must
 * never imply a confirmed diagnosis, proof, or access to the student's
 * private reasoning -- only "trap-associated"/"trap-tagged" candidate-level
 * recurrence language. This targets strings Trap Lab actually returns,
 * not generic framework internals.
 */
describe("trap-lab -- epistemic language regression guard", () => {
  it("not_applicable (insufficient_evidence) explanation contains no confirmation-implying language", () => {
    const outcome = evaluateTrapLab(context());
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("not_applicable (no_recurring_trap_detected) explanation contains no confirmation-implying language", () => {
    const outcome = evaluateTrapLab(context({ attemptRecords: makeFailingBatch(1) }));
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("applicable explanation/notes contain no confirmation-implying language, and DO contain the accepted candidate-level phrasing", () => {
    const outcome = evaluateTrapLab(context({ attemptRecords: makeFailingBatch(2) }));
    const strings = collectStrings(outcome);
    assertNoForbiddenLanguage(strings);
    expect(strings.some((s) => /trap-associated/i.test(s) || /trap-tagged/i.test(s))).toBe(true);
  });

  it("applicable explanation/notes with enrichment (label/category resolved) contain no confirmation-implying language", () => {
    const outcome = evaluateTrapLab(context({ attemptRecords: makeFailingBatch(2), errorTaxonomy: [makeErrorTaxonomyEntry()] }));
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("applicable with resistance evidence present contains no confirmation-implying language", () => {
    const attemptRecords = [...makeFailingBatch(2), makeAttemptRecord({ isCorrect: true }), makeAttemptRecord({ isCorrect: true, hintsUsed: 1 })];
    const outcome = evaluateTrapLab(context({ attemptRecords }));
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("end-to-end selected outcome (via runTrainingSystemProvider) contains no confirmation-implying language", () => {
    const attemptRecords = makeFailingBatch(2);
    const candidate = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE });
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context({ attemptRecords, candidates: [candidate] }));
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("end-to-end no_eligible_question outcome contains no confirmation-implying language", () => {
    const attemptRecords = makeFailingBatch(2);
    const nonMatching = makeCandidate({ trapErrorTaxonomyCode: "other_code" });
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context({ attemptRecords, candidates: [nonMatching] }));
    assertNoForbiddenLanguage(collectStrings(outcome));
  });
});
