import { describe, expect, it } from "vitest";
import { evaluateRevision } from "../src/applicability.js";
import { DORMANCY_MS, MS_PER_DAY, REVISION_CONSTANTS } from "../src/constants.js";
import type { RevisionTrainingRequirement } from "../src/types.js";
import { daysAgo, makeAttemptRecord, makeCandidate, makeConceptHistory, makeContext, NOW, STUDENT } from "./fixtures.js";

function target(result: ReturnType<typeof evaluateRevision>): string | null {
  return result.applicable ? (result.requirement as RevisionTrainingRequirement).targetConceptName : null;
}

describe("Revision constants (provisional, deterministic, not a decay model)", () => {
  it("are the specified named values", () => {
    expect(REVISION_CONSTANTS.MIN_GRADED_ATTEMPTS).toBe(3);
    expect(REVISION_CONSTANTS.DORMANCY_DAYS).toBe(14);
    expect(DORMANCY_MS).toBe(14 * MS_PER_DAY);
  });
});

describe("evaluateRevision -- concept-level eligibility", () => {
  it("no history at all: not applicable (insufficient_evidence)", () => {
    const result = evaluateRevision(makeContext());
    expect(result).toMatchObject({ applicable: false, reason: "insufficient_evidence" });
  });

  it("fewer than 3 graded attempts is not eligible, however old", () => {
    for (const count of [1, 2]) {
      expect(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", count, 90) })).applicable, `${count} attempts`).toBe(false);
    }
  });

  it("exactly 3 graded attempts and dormant is eligible", () => {
    expect(target(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 3, 20) })))).toBe("Percentages");
  });

  it("3+ graded attempts but the latest attempt is under 14 days old is not eligible", () => {
    expect(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 5, 13) })).applicable).toBe(false);
    expect(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 5, 1) })).applicable).toBe(false);
  });

  it("exact 14-day boundary: exactly 14 days is eligible, one millisecond less is not", () => {
    const exact = makeConceptHistory("Percentages", 3, 14);
    expect(evaluateRevision(makeContext({ attemptRecords: exact })).applicable).toBe(true);
    const latestShort = [makeAttemptRecord({ finalizedAt: daysAgo(20) }), makeAttemptRecord({ finalizedAt: daysAgo(19) }), makeAttemptRecord({ finalizedAt: new Date(Date.parse(NOW) - DORMANCY_MS + 1).toISOString() })];
    expect(evaluateRevision(makeContext({ attemptRecords: latestShort })).applicable).toBe(false);
  });

  it("the dormancy is measured from the MOST RECENT graded attempt, not the oldest or an average", () => {
    const records = [...makeConceptHistory("Percentages", 3, 40), makeAttemptRecord({ finalizedAt: daysAgo(2) })];
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(false);
  });

  it("only some concepts qualify: the others never count", () => {
    const records = [
      ...makeConceptHistory("Percentages", 4, 30),
      ...makeConceptHistory("Ratio", 3, 5), // recent
      ...makeConceptHistory("Averages", 2, 60) // too few
    ];
    expect(target(evaluateRevision(makeContext({ attemptRecords: records })))).toBe("Percentages");
  });

  it("no eligible concepts across several: not applicable", () => {
    const records = [...makeConceptHistory("Ratio", 3, 5), ...makeConceptHistory("Averages", 2, 60)];
    expect(evaluateRevision(makeContext({ attemptRecords: records }))).toMatchObject({ applicable: false, reason: "insufficient_evidence" });
  });

  it("a graded attempt split across concepts is not pooled (2 + 2 is not 3 of one)", () => {
    const records = [...makeConceptHistory("Percentages", 2, 30), ...makeConceptHistory("Ratio", 2, 30)];
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(false);
  });
});

describe("evaluateRevision -- what counts as a graded attempt", () => {
  it("skipped and abandoned attempts never count", () => {
    const records = [...makeConceptHistory("Percentages", 2, 30), makeAttemptRecord({ status: "skipped", finalizedAt: daysAgo(30) }), makeAttemptRecord({ status: "abandoned", finalizedAt: daysAgo(30) })];
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(false);
  });

  it("a skipped attempt inside the window does not make the concept recent (it is not a graded attempt)", () => {
    const records = [...makeConceptHistory("Percentages", 3, 30), makeAttemptRecord({ status: "skipped", finalizedAt: daysAgo(1) })];
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(true);
  });

  it("correctness never matters: three incorrect attempts are as eligible as three correct ones", () => {
    expect(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 3, 20, { isCorrect: false }) })).applicable).toBe(true);
    expect(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 3, 20, { isCorrect: true }) })).applicable).toBe(true);
  });

  it("another student's attempts never count", () => {
    expect(evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 4, 30, { studentId: "someone-else" }) })).applicable).toBe(false);
  });

  it("a graded attempt with a missing or unparseable finalizedAt is excluded (fail closed), not guessed", () => {
    const records = [...makeConceptHistory("Percentages", 2, 30), makeAttemptRecord({ finalizedAt: null }), makeAttemptRecord({ finalizedAt: "not-a-date" })];
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(false);
  });

  it("a retried question counts once per graded attempt (attempts, not distinct questions)", () => {
    const records = [0, 1, 2].map((i) => makeAttemptRecord({ questionId: "same-question", finalizedAt: daysAgo(20 + i) }));
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(true);
  });
});

describe("evaluateRevision -- target concept", () => {
  it("the concept whose most recent graded attempt is OLDEST wins", () => {
    const records = [...makeConceptHistory("Ratio", 3, 20), ...makeConceptHistory("Percentages", 3, 45), ...makeConceptHistory("Averages", 3, 30)];
    expect(target(evaluateRevision(makeContext({ attemptRecords: records })))).toBe("Percentages");
  });

  it("an exact tie in last-attempt time breaks on conceptName ascending, independent of record order", () => {
    const at = daysAgo(30);
    const mk = (name: string) => [0, 1, 2].map(() => makeAttemptRecord({ conceptName: name, finalizedAt: at }));
    const forward = [...mk("Averages"), ...mk("Ratio"), ...mk("Percentages")];
    const reversed = [...forward].reverse();
    expect(target(evaluateRevision(makeContext({ attemptRecords: forward })))).toBe("Averages");
    expect(target(evaluateRevision(makeContext({ attemptRecords: reversed })))).toBe("Averages");
  });

  it("the requirement carries the target concept only: no stage, no day count, no timestamp, no number", () => {
    const result = evaluateRevision(makeContext({ attemptRecords: makeConceptHistory("Percentages", 3, 20) }));
    expect(result.applicable).toBe(true);
    if (!result.applicable) return;
    expect(Object.keys(result.requirement).sort()).toEqual(["notes", "targetConceptName"]);
  });
});

describe("evaluateRevision -- fail closed on time, and purity", () => {
  it("a missing or unparseable `now` is never guessed: not applicable", () => {
    const records = makeConceptHistory("Percentages", 3, 20);
    expect(evaluateRevision(makeContext({ attemptRecords: records, now: undefined })).applicable).toBe(false);
    expect(evaluateRevision(makeContext({ attemptRecords: records, now: "garbage" })).applicable).toBe(false);
  });

  it("is a pure function of its inputs: same context, same answer; `now` moves the answer deterministically", () => {
    const records = makeConceptHistory("Percentages", 3, 10);
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(false);
    const later = new Date(Date.parse(NOW) + 5 * MS_PER_DAY).toISOString();
    expect(evaluateRevision(makeContext({ attemptRecords: records, now: later })).applicable).toBe(true);
    expect(evaluateRevision(makeContext({ attemptRecords: records, now: later }))).toEqual(evaluateRevision(makeContext({ attemptRecords: records, now: later })));
  });

  it("candidate-pool invariance: applicability and target are identical for any candidate pool (never reads candidates)", () => {
    const records = [...makeConceptHistory("Percentages", 3, 20), ...makeConceptHistory("Ratio", 3, 40)];
    const pools = [[], [makeCandidate()], [makeCandidate({ conceptName: "Ratio" }), makeCandidate({ conceptName: "Percentages" })], Array.from({ length: 25 }, () => makeCandidate({ conceptName: "Averages" }))];
    const baseline = evaluateRevision(makeContext({ attemptRecords: records, candidates: [] }));
    for (const candidates of pools) expect(evaluateRevision(makeContext({ attemptRecords: records, candidates }))).toEqual(baseline);
    expect(target(baseline)).toBe("Ratio");
  });

  it("history: after a revision attempt on the dormant concept, it no longer qualifies (its latest graded attempt is now recent)", () => {
    const records = makeConceptHistory("Percentages", 3, 20);
    expect(evaluateRevision(makeContext({ attemptRecords: records })).applicable).toBe(true);
    const revised = [...records, makeAttemptRecord({ conceptName: "Percentages", finalizedAt: daysAgo(0) })];
    expect(evaluateRevision(makeContext({ attemptRecords: revised })).applicable).toBe(false);
  });

  it("history: with two dormant concepts, revising the first makes the SECOND the target", () => {
    const records = [...makeConceptHistory("Percentages", 3, 40), ...makeConceptHistory("Ratio", 3, 20)];
    expect(target(evaluateRevision(makeContext({ attemptRecords: records })))).toBe("Percentages");
    const afterOne = [...records, makeAttemptRecord({ conceptName: "Percentages", finalizedAt: daysAgo(0) })];
    expect(target(evaluateRevision(makeContext({ attemptRecords: afterOne })))).toBe("Ratio");
  });

  it("does not read trap codes, novelty levels, practice blocks, mastery or the taxonomy: poisoning them changes nothing", () => {
    const records = makeConceptHistory("Percentages", 3, 20);
    const baseline = evaluateRevision(makeContext({ attemptRecords: records }));
    const poisoned = evaluateRevision(
      makeContext({
        attemptRecords: records.map((r) => ({ ...r, question: { ...r.question, trapErrorTaxonomyCode: "x", noveltyLevel: "novel_context" as const } })),
        practiceBlocks: [{ practiceBlockId: "b", attemptIdsInOrder: ["x"], targetQuestionCount: 1, blockTimeBudgetSeconds: 1, wallClockDurationSeconds: 1, activeSolvingTimeSeconds: 99999, interAttemptGapsSeconds: [0] }],
        errorTaxonomy: [],
        masteryByConcept: []
      })
    );
    expect(poisoned).toEqual(baseline);
    expect(STUDENT).toBe("student-1");
  });
});
