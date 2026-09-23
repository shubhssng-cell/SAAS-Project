import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { NoveltyTrainingProvider } from "../src/provider.js";
import type { NoveltyTrainingRequirement } from "../src/types.js";
import { makeCandidate, makeExposureBatch, STUDENT } from "./fixtures.js";

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function asRequirement(requirement: unknown): NoveltyTrainingRequirement {
  return requirement as NoveltyTrainingRequirement;
}

const CLEARED_BASELINE = makeExposureBatch(3, { noveltyLevel: "standard" });

describe("NoveltyTrainingProvider -- end-to-end via runTrainingSystemProvider()", () => {
  it("not_applicable when there is no evidence at all, and select() is never reached", () => {
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context());
    expect(outcome.status).toBe("not_applicable");
  });

  it("applicable + selected end to end when exposure evidence and a qualifying candidate both exist", () => {
    // Sufficiently expose novel_representation/novel_context so novel_combination is the sole,
    // unambiguous target (0 exposure) -- avoids relying on the 3-way tie-break's exact ordering.
    const attemptRecords = [...CLEARED_BASELINE, ...makeExposureBatch(3, { noveltyLevel: "novel_representation" }), ...makeExposureBatch(3, { noveltyLevel: "novel_context" })];
    const candidate = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_combination" });
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context({ attemptRecords, candidates: [candidate] }));

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(asRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
      expect(asRequirement(outcome.requirement).targetNoveltyLevel).toBe("novel_combination");
    }
  });

  it("applicable but no_eligible_question end to end when no candidate matches the target level", () => {
    const wrongLevel = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_context" });
    // Force the target to be "novel_representation" by making it the only underexposed dimension.
    const attemptRecords = [...CLEARED_BASELINE, ...makeExposureBatch(3, { noveltyLevel: "novel_combination" }), ...makeExposureBatch(3, { noveltyLevel: "novel_context" })];
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context({ attemptRecords, candidates: [wrongLevel] }));
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("applicable end to end even with ZERO candidates supplied", () => {
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context({ attemptRecords: CLEARED_BASELINE, candidates: [] }));
    expect(outcome.status).toBe("no_eligible_question"); // applicable, but nothing to select from
  });

  it("providerId is consistent across outcomes", () => {
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context());
    expect(outcome.status).toBe("not_applicable");
    if (outcome.status === "not_applicable") expect(outcome.diagnostics.providerId).toBe("novelty-training");
  });
});
