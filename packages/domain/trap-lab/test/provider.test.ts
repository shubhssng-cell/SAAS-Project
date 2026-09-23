import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { TrapLabProvider } from "../src/provider.js";
import type { TrapLabRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, makeFailingBatch, STUDENT, TRAP_CODE } from "./fixtures.js";

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function asTrapLabRequirement(requirement: unknown): TrapLabRequirement {
  return requirement as TrapLabRequirement;
}

describe("TrapLabProvider -- end-to-end via runTrainingSystemProvider()", () => {
  it("not_applicable when there is no evidence at all, and select() is never reached", () => {
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context());
    expect(outcome.status).toBe("not_applicable");
  });

  it("applicable + selected end to end when recurrence and a qualifying candidate both exist", () => {
    const attemptRecords = makeFailingBatch(2);
    const candidate = makeCandidate({ trapErrorTaxonomyCode: TRAP_CODE });
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context({ attemptRecords, candidates: [candidate] }));

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(asTrapLabRequirement(outcome.requirement).targetErrorTaxonomyCode).toBe(TRAP_CODE);
    }
  });

  it("applicable but no_eligible_question end to end when recurrence exists but no candidate qualifies", () => {
    const attemptRecords = makeFailingBatch(2);
    const nonMatching = makeCandidate({ trapErrorTaxonomyCode: "other_code" });
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context({ attemptRecords, candidates: [nonMatching] }));
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("providerId is consistent across outcomes", () => {
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context());
    expect(outcome.status).toBe("not_applicable");
    if (outcome.status === "not_applicable") expect(outcome.diagnostics.providerId).toBe("trap-lab");
  });
});

describe("Trap Lab -- cross-domain independence", () => {
  it("slowness alone (no trap recurrence) does not trigger Trap Lab -- Trap Lab never reads timing fields for applicability", () => {
    // Plenty of correct, non-trap-tagged attempts, regardless of how slow -- Trap Lab's evidence derivation
    // never consults timeTakenSeconds/expectedTimeSeconds at all (see trapEvidence.ts).
    const slowNoTrapAttempts = Array.from({ length: 10 }, () => makeAttemptRecord({ trapErrorTaxonomyCode: null, isCorrect: true }));
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context({ attemptRecords: slowNoTrapAttempts }));
    expect(outcome.status).toBe("not_applicable");
  });

  it("calculation friction alone (no trap recurrence) does not trigger Trap Lab -- Trap Lab never reads difficultyDimensions.computationalLoad for applicability", () => {
    // Plenty of incorrect, non-trap-tagged attempts on high-computationalLoad questions -- Trap Lab's evidence
    // derivation never consults difficultyDimensions at all (see trapEvidence.ts); only trapErrorTaxonomyCode matters.
    const calcFrictionNoTrapAttempts = Array.from({ length: 10 }, () => makeAttemptRecord({ trapErrorTaxonomyCode: null, isCorrect: false }));
    const outcome = runTrainingSystemProvider(new TrapLabProvider(), context({ attemptRecords: calcFrictionNoTrapAttempts }));
    expect(outcome.status).toBe("not_applicable");
  });

});
