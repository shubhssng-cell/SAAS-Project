import { runTrainingSystemProvider } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { PressureTrainingProvider } from "../src/provider.js";
import type { PressureTrainingRequirement } from "../src/types.js";
import { makeAttemptRecord, makeBlockContext, makeCandidate, makeContext, makeQualifyingBlock } from "./fixtures.js";

function asRequirement(requirement: unknown): PressureTrainingRequirement {
  return requirement as PressureTrainingRequirement;
}

function riskyBlock(prefix: string, startEpochMs: number) {
  return makeQualifyingBlock(prefix, 3, { startEpochMs });
}

describe("PressureTrainingProvider -- end-to-end via runTrainingSystemProvider()", () => {
  it("not_applicable when practiceBlocks is absent, and select() is never reached", () => {
    const outcome = runTrainingSystemProvider(new PressureTrainingProvider(), makeContext());
    expect(outcome.status).toBe("not_applicable");
  });

  it("applicable + selected end to end when block evidence and a qualifying candidate both exist", () => {
    const b1 = riskyBlock("b1", Date.parse("2026-01-01T00:00:00.000Z"));
    const b2 = riskyBlock("b2", Date.parse("2026-01-02T00:00:00.000Z"));
    const b3attempts = [
      { attemptId: "b3-1", finalizedAt: "2026-01-03T00:00:00.000Z" },
      { attemptId: "b3-2", finalizedAt: "2026-01-03T00:00:03.000Z" },
      { attemptId: "b3-3", finalizedAt: "2026-01-03T00:00:07.000Z" }
    ];
    const attempts = b3attempts.map((a) => makeAttemptRecord({ attemptId: a.attemptId, finalizedAt: a.finalizedAt }));
    const block = makeBlockContext({ attemptIdsInOrder: b3attempts.map((a) => a.attemptId), interAttemptGapsSeconds: [3, 4] });

    const candidate = makeCandidate({ conceptName: "Percentages" });
    const outcome = runTrainingSystemProvider(
      new PressureTrainingProvider(),
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...attempts], practiceBlocks: [b1.block, b2.block, block], candidates: [candidate] })
    );

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(asRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
      expect(asRequirement(outcome.requirement).evidencedDimension).toBe("reduced_recovery");
      expect(outcome.question.questionId).toBe(candidate.question.questionId);
    }
  });

  it("applicable but no_eligible_question end to end when no candidate matches", () => {
    const b1 = riskyBlock("b1", Date.parse("2026-01-01T00:00:00.000Z"));
    const b2 = riskyBlock("b2", Date.parse("2026-01-02T00:00:00.000Z"));
    const b3 = riskyBlock("b3", Date.parse("2026-01-03T00:00:00.000Z"));
    b3.block.blockTimeBudgetSeconds = 10;
    b3.block.activeSolvingTimeSeconds = 999;

    const wrongConceptCandidate = makeCandidate({ conceptName: "Ratio" });
    const outcome = runTrainingSystemProvider(
      new PressureTrainingProvider(),
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block], candidates: [wrongConceptCandidate] })
    );
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("applicable end to end even with ZERO candidates supplied", () => {
    const b1 = riskyBlock("b1", Date.parse("2026-01-01T00:00:00.000Z"));
    const b2 = riskyBlock("b2", Date.parse("2026-01-02T00:00:00.000Z"));
    const b3 = riskyBlock("b3", Date.parse("2026-01-03T00:00:00.000Z"));
    b3.block.blockTimeBudgetSeconds = 10;
    b3.block.activeSolvingTimeSeconds = 999;

    const outcome = runTrainingSystemProvider(
      new PressureTrainingProvider(),
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block], candidates: [] })
    );
    expect(outcome.status).toBe("no_eligible_question"); // applicable, but nothing to select from
  });

  it("providerId is consistent across outcomes", () => {
    const outcome = runTrainingSystemProvider(new PressureTrainingProvider(), makeContext());
    expect(outcome.status).toBe("not_applicable");
    if (outcome.status === "not_applicable") expect(outcome.diagnostics.providerId).toBe("pressure-training");
  });

  it("select() defensively returns an error if ever invoked with a foreign requirement shape", () => {
    const provider = new PressureTrainingProvider();
    const outcome = provider.select(makeContext(), { requirement: { testingModes: ["direct"] }, explanation: "not really pressure training" });
    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.code).toBe("invalid_context");
  });
});
