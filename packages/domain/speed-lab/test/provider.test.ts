import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { SpeedLabProvider } from "../src/provider.js";
import type { SpeedLabRequirement } from "../src/types.js";
import { makeCandidate, makeFastCorrectBatch, makeSlowCorrectBatch, STUDENT } from "./fixtures.js";

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function asSpeedLabRequirement(requirement: unknown): SpeedLabRequirement {
  return requirement as SpeedLabRequirement;
}

describe("SpeedLabProvider -- end-to-end via runTrainingSystemProvider()", () => {
  it("not_applicable when there is no evidence at all, and select() is never reached", () => {
    const outcome = runTrainingSystemProvider(new SpeedLabProvider(), context({ candidates: [makeCandidate({ conceptName: "Percentages" })] }));
    expect(outcome.status).toBe("not_applicable");
  });

  it("applicable + selected end to end when speed-inefficiency evidence and a qualifying candidate both exist", () => {
    const attemptRecords = makeSlowCorrectBatch(5, { conceptualLoad: 0.1 });
    const candidate = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });

    const outcome = runTrainingSystemProvider(new SpeedLabProvider(), context({ attemptRecords, candidates: [candidate] }));

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.question.conceptName).toBe("Percentages");
      expect(asSpeedLabRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
    }
  });

  it("applicable but no_eligible_question end to end when inefficiency is detected but no candidate qualifies", () => {
    const attemptRecords = makeSlowCorrectBatch(5, { conceptualLoad: 0.1 });
    const highLoadCandidate = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.9, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });

    const outcome = runTrainingSystemProvider(new SpeedLabProvider(), context({ attemptRecords, candidates: [highLoadCandidate] }));

    expect(outcome.status).toBe("no_eligible_question");
  });

  it("a fast student is not_applicable end to end", () => {
    const attemptRecords = makeFastCorrectBatch(5, { conceptualLoad: 0.1 });
    const outcome = runTrainingSystemProvider(new SpeedLabProvider(), context({ attemptRecords, candidates: [makeCandidate({ conceptName: "Percentages" })] }));
    expect(outcome.status).toBe("not_applicable");
  });

  it("providerId is consistent across outcomes", () => {
    const outcome = runTrainingSystemProvider(new SpeedLabProvider(), context());
    expect(outcome.status).toBe("not_applicable");
    if (outcome.status === "not_applicable") expect(outcome.diagnostics.providerId).toBe("speed-lab");
  });
});
