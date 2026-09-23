import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { selectCalculationGymQuestion } from "../src/selection.js";
import type { CalculationGymRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

const MIXED_REQUIREMENT: CalculationGymRequirement = {
  targetConceptName: "Percentages",
  stage: "mixed",
  minComputationalLoad: 0.5,
  requireMultiStep: false,
  requireTimePressured: false
};

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

describe("selectCalculationGymQuestion", () => {
  it("no_eligible_question when the pool is empty", () => {
    const outcome = selectCalculationGymQuestion("calculation-gym", context(), MIXED_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes unpublished candidates, correctly counted as ineligible", () => {
    const outcome = selectCalculationGymQuestion(
      "calculation-gym",
      context({ candidates: [makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.6, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } }, { validationState: "draft" })] }),
      MIXED_REQUIREMENT,
      "test"
    );
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") expect(outcome.diagnostics.excludedIneligibleCount).toBe(1);
  });

  it("excludes candidates below the required computationalLoad floor", () => {
    const lowLoad = makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.1, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } });
    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [lowLoad] }), MIXED_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes candidates that don't match the target concept", () => {
    const wrongConcept = makeCandidate({ conceptName: "Ratio", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.9, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } });
    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [wrongConcept] }), MIXED_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("requireTimePressured excludes candidates without the testingMode, even at sufficient load", () => {
    const noPressure = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.9, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 },
      testingModes: ["direct"]
    });
    const requirement: CalculationGymRequirement = { ...MIXED_REQUIREMENT, stage: "time_pressured", requireTimePressured: true };
    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [noPressure] }), requirement, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes a structurally malformed candidate (missing difficultyDimensions), counted separately from ineligible", () => {
    const malformed = makeCandidate({ conceptName: "Percentages" });
    // @ts-expect-error -- deliberately corrupting the fixture to prove the malformed-candidate guard.
    malformed.question.difficultyDimensions = undefined;
    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [malformed] }), MIXED_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") {
      expect(outcome.diagnostics.excludedMalformedCount).toBe(1);
      expect(outcome.diagnostics.excludedIneligibleCount).toBe(0);
    }
  });

  it("tie-break: prefers the least-exposed qualifying candidate first", () => {
    const seen = makeCandidate(
      { conceptName: "Percentages", questionId: "seen-question", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.5, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } }
    );
    const unseen = makeCandidate(
      { conceptName: "Percentages", questionId: "unseen-question", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.5, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } }
    );
    const attemptRecords = [makeAttemptRecord({ studentId: STUDENT, questionId: "seen-question" }), makeAttemptRecord({ studentId: STUDENT, questionId: "seen-question" })];

    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [seen, unseen], attemptRecords }), MIXED_REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-question");
  });

  it("tie-break: among equally-exposed candidates, prefers computationalLoad closest to the requirement's floor", () => {
    const closer = makeCandidate({
      conceptName: "Percentages",
      questionId: "closer-question",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.55, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const farther = makeCandidate({
      conceptName: "Percentages",
      questionId: "farther-question",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.95, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });

    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [farther, closer] }), MIXED_REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("closer-question");
  });

  it("tie-break: falls back to lexicographic questionId as the final deterministic break", () => {
    const b = makeCandidate({
      conceptName: "Percentages",
      questionId: "b-question",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.5, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const a = makeCandidate({
      conceptName: "Percentages",
      questionId: "a-question",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.5, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });

    const outcome = selectCalculationGymQuestion("calculation-gym", context({ candidates: [b, a] }), MIXED_REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("a-question");
  });
});
