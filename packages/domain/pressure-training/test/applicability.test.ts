import { describe, expect, it } from "vitest";
import { evaluatePressureTraining } from "../src/applicability.js";
import type { PressureTrainingRequirement } from "../src/types.js";
import { makeAttemptRecord, makeBlockContext, makeContext, makeQualifyingBlock } from "./fixtures.js";

function asRequirement(requirement: unknown): PressureTrainingRequirement {
  return requirement as PressureTrainingRequirement;
}

describe("evaluatePressureTraining", () => {
  it("practiceBlocks absent -> not_applicable: insufficient_evidence", () => {
    const outcome = evaluatePressureTraining(makeContext());
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("practiceBlocks empty array -> not_applicable: insufficient_evidence", () => {
    const outcome = evaluatePressureTraining(makeContext({ practiceBlocks: [] }));
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("structural non-duplication: rich single-question, Speed-Lab-shaped evidence in attemptRecords is IGNORED when practiceBlocks is absent", () => {
    // 20 slow-but-correct single-question attempts -- exactly the shape that would make Speed Lab applicable -- but no block grouping at all.
    const attemptRecords = Array.from({ length: 20 }, (_, i) => makeAttemptRecord({ attemptId: `slow-${i}`, isCorrect: true, finalizedAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 60_000).toISOString() }));
    const outcome = evaluatePressureTraining(makeContext({ attemptRecords }));
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("fewer than 3 qualifying blocks for the only concept with any evidence -> insufficient_evidence", () => {
    const b1 = makeQualifyingBlock("b1", 3);
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const outcome = evaluatePressureTraining(makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts], practiceBlocks: [b1.block, b2.block] }));
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("exactly 3 qualifying blocks, none triggering -> sufficient_blocks_no_pressure_detected", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    const outcome = evaluatePressureTraining(
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block] })
    );
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("sufficient_blocks_no_pressure_detected");
  });

  it("reduced_recovery dimension alone triggers applicable", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    // b3 has short gaps -- the one block that triggers.
    const b3attempts = [
      makeAttemptRecord({ attemptId: "b3-1", finalizedAt: "2026-01-03T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "b3-2", finalizedAt: "2026-01-03T00:00:03.000Z" }),
      makeAttemptRecord({ attemptId: "b3-3", finalizedAt: "2026-01-03T00:00:07.000Z" })
    ];
    const b3block = makeBlockContext({ attemptIdsInOrder: ["b3-1", "b3-2", "b3-3"], interAttemptGapsSeconds: [3, 4] });
    const outcome = evaluatePressureTraining(
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3attempts], practiceBlocks: [b1.block, b2.block, b3block] })
    );
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).evidencedDimension).toBe("reduced_recovery");
  });

  it("within_block_degradation dimension alone triggers applicable", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 5, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z"), correctness: [true, true, true, false, false] });
    const outcome = evaluatePressureTraining(
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block] })
    );
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).evidencedDimension).toBe("within_block_degradation");
  });

  it("budget_consumption dimension alone triggers applicable", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    b3.block.blockTimeBudgetSeconds = 100;
    b3.block.activeSolvingTimeSeconds = 200;
    const outcome = evaluatePressureTraining(
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block] })
    );
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).evidencedDimension).toBe("budget_consumption");
  });

  it("multi-trigger same concept: within_block_degradation takes precedence over reduced_recovery and budget_consumption", () => {
    const b1attempts = [
      makeAttemptRecord({ attemptId: "b1-1", isCorrect: true, finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "b1-2", isCorrect: true, finalizedAt: "2026-01-01T00:01:00.000Z" }),
      makeAttemptRecord({ attemptId: "b1-3", isCorrect: true, finalizedAt: "2026-01-01T00:02:00.000Z" }),
      makeAttemptRecord({ attemptId: "b1-4", isCorrect: false, finalizedAt: "2026-01-01T00:03:00.000Z" }),
      makeAttemptRecord({ attemptId: "b1-5", isCorrect: false, finalizedAt: "2026-01-01T00:04:00.000Z" })
    ];
    // Same block ALSO has short gaps and an exceeded budget -- degradation must still win.
    const b1block = makeBlockContext({
      attemptIdsInOrder: ["b1-1", "b1-2", "b1-3", "b1-4", "b1-5"],
      interAttemptGapsSeconds: [1, 1, 1, 1],
      blockTimeBudgetSeconds: 10,
      activeSolvingTimeSeconds: 500
    });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    const outcome = evaluatePressureTraining(
      makeContext({ attemptRecords: [...b1attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1block, b2.block, b3.block] })
    );
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).evidencedDimension).toBe("within_block_degradation");
  });

  it("cross-concept tie-break: dimension tier first, then lexicographic conceptName", () => {
    // "Ratio" triggers only budget_consumption (tier 2); "Percentages" triggers only reduced_recovery (tier 1) -- Percentages must win despite "Ratio" sorting first alphabetically among R/P... (P < R lexicographically anyway, but the REAL point is tier beats alphabetical order).
    const percentagesAttempts = [
      makeAttemptRecord({ attemptId: "p1", conceptName: "Percentages", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "p2", conceptName: "Percentages", finalizedAt: "2026-01-01T00:00:03.000Z" }),
      makeAttemptRecord({ attemptId: "p3", conceptName: "Percentages", finalizedAt: "2026-01-01T00:00:07.000Z" })
    ];
    const percentagesBlocks = [
      makeBlockContext({ practiceBlockId: "p-block-1", attemptIdsInOrder: ["p1", "p2", "p3"], interAttemptGapsSeconds: [3, 4] })
    ];
    // Pad Percentages to 3 qualifying blocks with non-triggering ones.
    const pB2 = makeQualifyingBlock("pB2", 3, { conceptName: "Percentages", startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const pB3 = makeQualifyingBlock("pB3", 3, { conceptName: "Percentages", startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });

    const ratioB1 = makeQualifyingBlock("rB1", 3, { conceptName: "Ratio", startEpochMs: Date.parse("2026-01-04T00:00:00.000Z") });
    ratioB1.block.blockTimeBudgetSeconds = 10;
    ratioB1.block.activeSolvingTimeSeconds = 500;
    const ratioB2 = makeQualifyingBlock("rB2", 3, { conceptName: "Ratio", startEpochMs: Date.parse("2026-01-05T00:00:00.000Z") });
    const ratioB3 = makeQualifyingBlock("rB3", 3, { conceptName: "Ratio", startEpochMs: Date.parse("2026-01-06T00:00:00.000Z") });

    const outcome = evaluatePressureTraining(
      makeContext({
        attemptRecords: [...percentagesAttempts, ...pB2.attempts, ...pB3.attempts, ...ratioB1.attempts, ...ratioB2.attempts, ...ratioB3.attempts],
        practiceBlocks: [...percentagesBlocks, pB2.block, pB3.block, ratioB1.block, ratioB2.block, ratioB3.block]
      })
    );
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) {
      expect(asRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
      expect(asRequirement(outcome.requirement).evidencedDimension).toBe("reduced_recovery");
    }
  });

  it("invalid blocks are excluded and never crash evaluation of the remaining valid blocks", () => {
    const malformed = makeBlockContext({ attemptIdsInOrder: [] });
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    expect(() =>
      evaluatePressureTraining(makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [malformed, b1.block, b2.block, b3.block] }))
    ).not.toThrow();
  });
});
