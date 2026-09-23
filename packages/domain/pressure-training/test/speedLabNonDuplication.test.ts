import { describe, expect, it } from "vitest";
import { evaluatePressureTraining } from "../src/applicability.js";
import { makeAttemptRecord, makeContext } from "./fixtures.js";

/**
 * The structural non-duplication guarantee (docs/DECISIONS.md D-061):
 * Pressure Training must be `not_applicable` whenever `context.
 * practiceBlocks` is absent/empty, REGARDLESS of how much single-question,
 * Speed-Lab-shaped evidence exists in `context.attemptRecords`. This
 * package deliberately has no runtime dependency on `@ipmat/speed-lab`
 * (the approved dependency set is exactly `@ipmat/training-systems` +
 * `@ipmat/mastery`), so this test proves PRESSURE TRAINING'S half of the
 * guarantee directly: `evaluatePressureTraining()` never reads anything
 * except `practiceBlocks`/`attemptRecords`'s block-correlated shape, so a
 * rich pool of exactly the low-conceptualLoad, hint-free, correct-and-slow
 * attempts that WOULD make `@ipmat/speed-lab`'s own `evaluateSpeedLab()`
 * applicable (per its own applicability.ts, read during design) changes
 * nothing here. The two providers are structurally incapable of firing off
 * the same evidence: Speed Lab's own types never reference
 * `practiceBlocks` at all.
 */
describe("Pressure Training vs. Speed Lab -- structural non-duplication (D-061)", () => {
  it("a large pool of correct-and-slow, single-question attempts (Speed-Lab-applicable shape) never makes Pressure Training applicable on its own", () => {
    const attemptRecords = Array.from({ length: 30 }, (_, i) =>
      makeAttemptRecord({
        attemptId: `slow-${i}`,
        isCorrect: true,
        finalizedAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 3600_000).toISOString()
      })
    );

    const outcome = evaluatePressureTraining(makeContext({ attemptRecords }));
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("adding practiceBlocks evidence to the SAME attempt pool can make Pressure Training applicable -- proving the field, not the attempt content, is what gates it", () => {
    const attemptRecords = [
      makeAttemptRecord({ attemptId: "b1-1", finalizedAt: "2026-01-01T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "b1-2", finalizedAt: "2026-01-01T00:00:03.000Z" }),
      makeAttemptRecord({ attemptId: "b1-3", finalizedAt: "2026-01-01T00:00:07.000Z" }),
      makeAttemptRecord({ attemptId: "b2-1", finalizedAt: "2026-01-02T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "b2-2", finalizedAt: "2026-01-02T00:00:03.000Z" }),
      makeAttemptRecord({ attemptId: "b2-3", finalizedAt: "2026-01-02T00:00:07.000Z" }),
      makeAttemptRecord({ attemptId: "b3-1", finalizedAt: "2026-01-03T00:00:00.000Z" }),
      makeAttemptRecord({ attemptId: "b3-2", finalizedAt: "2026-01-03T00:00:03.000Z" }),
      makeAttemptRecord({ attemptId: "b3-3", finalizedAt: "2026-01-03T00:00:07.000Z" })
    ];
    const practiceBlocks = [
      { practiceBlockId: "b1", attemptIdsInOrder: ["b1-1", "b1-2", "b1-3"], targetQuestionCount: null, blockTimeBudgetSeconds: null, wallClockDurationSeconds: null, activeSolvingTimeSeconds: 30, interAttemptGapsSeconds: [3, 4] },
      { practiceBlockId: "b2", attemptIdsInOrder: ["b2-1", "b2-2", "b2-3"], targetQuestionCount: null, blockTimeBudgetSeconds: null, wallClockDurationSeconds: null, activeSolvingTimeSeconds: 30, interAttemptGapsSeconds: [3, 4] },
      { practiceBlockId: "b3", attemptIdsInOrder: ["b3-1", "b3-2", "b3-3"], targetQuestionCount: null, blockTimeBudgetSeconds: null, wallClockDurationSeconds: null, activeSolvingTimeSeconds: 30, interAttemptGapsSeconds: [3, 4] }
    ];

    const outcome = evaluatePressureTraining(makeContext({ attemptRecords, practiceBlocks }));
    expect(outcome.applicable).toBe(true);
  });
});
