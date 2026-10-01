import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { TrainingSessionError } from "../src/errors.js";
import { buildTrainingObjective, parseTrainingObjective } from "../src/objective.js";
import { findTrainingSystem } from "../src/catalog.js";
import { runTrainingSystem, toAvailability } from "../src/runSystem.js";
import { makeCandidate, makeExposureBatch, STUDENT } from "./fixtures.js";

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

// Concept cleared its standard baseline; novel_representation/novel_context are exposed, so novel_combination is the one target.
const NOVELTY_HISTORY = [...makeExposureBatch(3, { noveltyLevel: "standard" }), ...makeExposureBatch(3, { noveltyLevel: "novel_representation" }), ...makeExposureBatch(3, { noveltyLevel: "novel_context" })];

describe("runTrainingSystem -- the extension point", () => {
  it("an unknown system fails closed with unknown_system", () => {
    expect(() => runTrainingSystem("nope", context())).toThrow(TrainingSessionError);
    try {
      runTrainingSystem("nope", context());
    } catch (error) {
      expect((error as TrainingSessionError).code).toBe("unknown_system");
    }
  });

  it("a system with no engine reports not_built and never runs anything", () => {
    for (const id of ["revision", "overtraining"]) {
      const run = runTrainingSystem(id, context());
      expect(run.status).toBe("not_built");
      expect(toAvailability(run)).toBe("not_built");
    }
  });

  it("routes to the real provider and returns its outcome unmodified: not_applicable with no evidence", () => {
    const run = runTrainingSystem("novelty-training", context());
    expect(run.status).toBe("ran");
    expect(toAvailability(run)).toBe("not_applicable");
  });

  it("selected end to end through the real novelty provider; the published question comes straight from the candidate pool", () => {
    const candidate = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_combination" });
    const run = runTrainingSystem("novelty-training", context({ attemptRecords: NOVELTY_HISTORY, candidates: [candidate] }));
    expect(toAvailability(run)).toBe("available");
    if (run.status === "ran" && run.outcome.status === "selected") {
      expect(run.outcome.question.questionId).toBe(candidate.question.questionId);
    } else throw new Error("expected selected");
  });

  it("applicable but no qualifying question is no_eligible_question, distinct from not_applicable", () => {
    const run = runTrainingSystem("novelty-training", context({ attemptRecords: NOVELTY_HISTORY, candidates: [] }));
    expect(toAvailability(run)).toBe("no_eligible_question");
  });

  it("the same context always yields the same outcome (deterministic)", () => {
    const candidates = [makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_combination", questionId: "q-b" }), makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_combination", questionId: "q-a" })];
    const a = runTrainingSystem("novelty-training", context({ attemptRecords: NOVELTY_HISTORY, candidates }));
    const b = runTrainingSystem("novelty-training", context({ attemptRecords: NOVELTY_HISTORY, candidates: [...candidates].reverse() }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("an unpublished candidate is never selected, even when it is the only match", () => {
    const draft = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_combination" }, { validationState: "ai_validated" });
    const run = runTrainingSystem("novelty-training", context({ attemptRecords: NOVELTY_HISTORY, candidates: [draft] }));
    expect(toAvailability(run)).toBe("no_eligible_question");
  });
});

describe("training objective", () => {
  it("is built from the catalog's authored words plus the provider's own named target", () => {
    const run = runTrainingSystem("novelty-training", context({ attemptRecords: NOVELTY_HISTORY, candidates: [makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_combination" })] }));
    if (run.status !== "ran" || run.outcome.status !== "selected") throw new Error("expected selected");
    const objective = buildTrainingObjective(findTrainingSystem("novelty-training")!, run.outcome.requirement);
    // the provider DID name a target concept, but Novelty's target rotates, so the (start-time) objective deliberately does not repeat it (D-079)
    expect(objective).toMatchObject({ systemId: "novelty-training", dimension: "novelty", targetConceptName: null });
    expect(objective.statement).toContain("This session is expanding the kinds of questions you've encountered.");
    const speed = buildTrainingObjective(findTrainingSystem("calculation-gym")!, { targetConceptName: "Percentages" } as never);
    expect(speed.targetConceptName).toBe("Percentages"); // a system whose target does not rotate still names its concept
  });

  it("round-trips through persistence and rejects a malformed stored value", () => {
    const objective = { systemId: "speed-lab", dimension: "speed" as const, statement: "x", targetConceptName: null };
    expect(parseTrainingObjective(JSON.parse(JSON.stringify(objective)))).toEqual(objective);
    expect(parseTrainingObjective(null)).toBeNull();
    expect(parseTrainingObjective({ systemId: 1 })).toBeNull();
    expect(parseTrainingObjective({ ...objective, targetConceptName: 5 })).toBeNull();
  });

  it("carries no field about confidence, emotion, motivation or any inferred mental state", () => {
    const keys = Object.keys(buildTrainingObjective(findTrainingSystem("speed-lab")!, {})).join(" ").toLowerCase();
    for (const banned of ["confidence", "emotion", "motivation", "anxiety", "mood", "intelligence", "careless"]) expect(keys).not.toContain(banned);
  });
});
