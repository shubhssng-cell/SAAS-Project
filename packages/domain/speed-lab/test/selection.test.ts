import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { selectSpeedLabQuestion } from "../src/selection.js";
import type { SpeedLabRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

const STEADY_REQUIREMENT: SpeedLabRequirement = {
  targetConceptName: "Percentages",
  stage: "steady_pace",
  maxConceptualLoad: 0.5,
  requireTimePressured: false
};

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

describe("selectSpeedLabQuestion", () => {
  it("no_eligible_question when the pool is empty", () => {
    const outcome = selectSpeedLabQuestion("speed-lab", context(), STEADY_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes unpublished candidates, correctly counted as ineligible", () => {
    const candidate = makeCandidate(
      { conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } },
      { validationState: "draft" }
    );
    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [candidate] }), STEADY_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") expect(outcome.diagnostics.excludedIneligibleCount).toBe(1);
  });

  it("excludes candidates at or above the requirement's maxConceptualLoad ceiling", () => {
    const highLoad = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.9, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [highLoad] }), STEADY_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes candidates that don't match the target concept", () => {
    const wrongConcept = makeCandidate({
      conceptName: "Ratio",
      difficultyDimensions: { conceptualLoad: 0.1, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [wrongConcept] }), STEADY_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("requireTimePressured excludes candidates without the testingMode, even below the load ceiling", () => {
    const noPressure = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.1, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 },
      testingModes: ["direct"]
    });
    const requirement: SpeedLabRequirement = { ...STEADY_REQUIREMENT, stage: "time_constrained", maxConceptualLoad: null, requireTimePressured: true };
    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [noPressure] }), requirement, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("a null maxConceptualLoad imposes no ceiling", () => {
    const highLoad = makeCandidate({
      conceptName: "Percentages",
      difficultyDimensions: { conceptualLoad: 0.95, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const requirement: SpeedLabRequirement = { ...STEADY_REQUIREMENT, stage: "mixed_pace", maxConceptualLoad: null };
    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [highLoad] }), requirement, "test");
    expect(outcome.status).toBe("selected");
  });

  it("excludes a structurally malformed candidate (missing difficultyDimensions), counted separately from ineligible", () => {
    const malformed = makeCandidate({ conceptName: "Percentages" });
    // @ts-expect-error -- deliberately corrupting the fixture to prove the malformed-candidate guard.
    malformed.question.difficultyDimensions = undefined;
    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [malformed] }), STEADY_REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") {
      expect(outcome.diagnostics.excludedMalformedCount).toBe(1);
      expect(outcome.diagnostics.excludedIneligibleCount).toBe(0);
    }
  });

  it("tie-break: prefers the least-exposed qualifying candidate first", () => {
    const seen = makeCandidate({
      conceptName: "Percentages",
      questionId: "seen-question",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const unseen = makeCandidate({
      conceptName: "Percentages",
      questionId: "unseen-question",
      difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 }
    });
    const attemptRecords = [makeAttemptRecord({ studentId: STUDENT, questionId: "seen-question" }), makeAttemptRecord({ studentId: STUDENT, questionId: "seen-question" })];

    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [seen, unseen], attemptRecords }), STEADY_REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-question");
  });

  it("tie-break: among equally-exposed candidates, prefers the LOWEST expectedTimeSeconds (a deterministic preference for the tighter budget, never claimed to be a harder/better/maximum stimulus)", () => {
    const tighter = makeCandidate(
      { conceptName: "Percentages", questionId: "tighter-question", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } },
      { expectedTimeSeconds: 60 }
    );
    const looser = makeCandidate(
      { conceptName: "Percentages", questionId: "looser-question", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } },
      { expectedTimeSeconds: 120 }
    );

    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [looser, tighter] }), STEADY_REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("tighter-question");
  });

  it("tie-break: falls back to lexicographic questionId as the final deterministic break", () => {
    const b = makeCandidate(
      { conceptName: "Percentages", questionId: "b-question", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } },
      { expectedTimeSeconds: 90 }
    );
    const a = makeCandidate(
      { conceptName: "Percentages", questionId: "a-question", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 } },
      { expectedTimeSeconds: 90 }
    );

    const outcome = selectSpeedLabQuestion("speed-lab", context({ candidates: [b, a] }), STEADY_REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("a-question");
  });
});
