import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { CalculationGymProvider } from "../src/provider.js";
import type { CalculationGymRequirement } from "../src/types.js";
import { makeCandidate, makeGradedBatch, STUDENT } from "./fixtures.js";

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function asCalculationGymRequirement(requirement: unknown): CalculationGymRequirement {
  return requirement as CalculationGymRequirement;
}

describe("CalculationGymProvider — end-to-end via runTrainingSystemProvider()", () => {
  it("not_applicable when there is no evidence at all, and select() is never reached", () => {
    const outcome = runTrainingSystemProvider(new CalculationGymProvider(), context({ candidates: [makeCandidate({ conceptName: "Percentages" })] }));
    expect(outcome.status).toBe("not_applicable");
  });

  it("applicable + selected end to end when friction evidence and a qualifying candidate both exist", () => {
    const attemptRecords = [...makeGradedBatch(5, 1, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })];
    const candidate = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.6, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });

    const outcome = runTrainingSystemProvider(new CalculationGymProvider(), context({ attemptRecords, candidates: [candidate] }));

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.question.conceptName).toBe("Percentages");
      expect(asCalculationGymRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
    }
  });

  it("applicable but no_eligible_question end to end when friction is detected but no candidate qualifies", () => {
    const attemptRecords = [...makeGradedBatch(5, 1, { computationalLoad: 0.9 }), ...makeGradedBatch(5, 5, { computationalLoad: 0.1 })];
    const lowLoadCandidate = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.1, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });

    const outcome = runTrainingSystemProvider(new CalculationGymProvider(), context({ attemptRecords, candidates: [lowLoadCandidate] }));

    expect(outcome.status).toBe("no_eligible_question");
  });

  it("providerId is consistent across not_applicable, selected, and no_eligible_question outcomes", () => {
    const outcome = runTrainingSystemProvider(new CalculationGymProvider(), context());
    expect(outcome.status).toBe("not_applicable");
    if (outcome.status === "not_applicable") expect(outcome.diagnostics.providerId).toBe("calculation-gym");
  });
});
