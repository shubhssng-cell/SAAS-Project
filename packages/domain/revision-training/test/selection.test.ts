import { runTrainingSystemProvider } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { RevisionTrainingProvider } from "../src/provider.js";
import { daysAgo, makeAttemptRecord, makeCandidate, makeConceptHistory, makeContext } from "./fixtures.js";

const provider = new RevisionTrainingProvider();
const dormant = (concept = "Percentages", count = 3) => makeConceptHistory(concept, count, 30, { cell: "cell-seen" });
const run = (overrides: Parameters<typeof makeContext>[0]) => runTrainingSystemProvider(provider, makeContext(overrides));

function selectedId(outcome: ReturnType<typeof run>): string {
  if (outcome.status !== "selected") throw new Error(`expected selected, got ${outcome.status}`);
  return outcome.question.questionId;
}

describe("Revision selection -- the pool", () => {
  it("serves only published, structurally valid questions of the exact target concept", () => {
    const keep = makeCandidate({ questionId: "q-keep", patternTaxonomyCellId: "cell-new" });
    const outcome = run({
      attemptRecords: dormant(),
      candidates: [
        makeCandidate({ questionId: "q-draft", patternTaxonomyCellId: "cell-new" }, { validationState: "ai_validated" }),
        makeCandidate({ questionId: "q-other-concept", conceptName: "Ratio", patternTaxonomyCellId: "cell-new" }),
        makeCandidate({ questionId: "q-bad-cell", patternTaxonomyCellId: "" }),
        makeCandidate({ questionId: "q-bad-time" }, { expectedTimeSeconds: Number.NaN as unknown as number }),
        keep
      ]
    });
    expect(selectedId(outcome)).toBe("q-keep");
    if (outcome.status === "selected") expect([outcome.diagnostics.candidatesConsidered, outcome.diagnostics.excludedMalformedCount, outcome.diagnostics.excludedIneligibleCount]).toEqual([5, 2, 2]);
  });

  it("an empty target pool is the explicit no_eligible_question outcome -- it NEVER switches to another concept", () => {
    const outcome = run({
      attemptRecords: [...dormant("Percentages"), ...makeConceptHistory("Ratio", 3, 20)],
      candidates: [makeCandidate({ questionId: "q-ratio", conceptName: "Ratio" }), makeCandidate({ questionId: "q-draft", conceptName: "Percentages" }, { validationState: "human_reviewed" })]
    });
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") expect(outcome.requirement).toMatchObject({ targetConceptName: "Percentages" });
  });

  it("no candidates at all while applicable is no_eligible_question (distinct from not_applicable)", () => {
    expect(run({ attemptRecords: dormant(), candidates: [] }).status).toBe("no_eligible_question");
    expect(run({ attemptRecords: [], candidates: [] }).status).toBe("not_applicable");
  });
});

describe("Revision selection -- preference order", () => {
  it("1. prefers a taxonomy cell the student has not seen at this concept", () => {
    const outcome = run({
      attemptRecords: dormant(),
      candidates: [makeCandidate({ questionId: "q-a-seen-cell", patternTaxonomyCellId: "cell-seen" }), makeCandidate({ questionId: "q-z-new-cell", patternTaxonomyCellId: "cell-new" })]
    });
    expect(selectedId(outcome)).toBe("q-z-new-cell"); // not the lexicographically first
  });

  it("falls back to the whole pool when every cell has been seen", () => {
    const outcome = run({ attemptRecords: dormant(), candidates: [makeCandidate({ questionId: "q-2", patternTaxonomyCellId: "cell-seen" }), makeCandidate({ questionId: "q-1", patternTaxonomyCellId: "cell-seen" })] });
    expect(selectedId(outcome)).toBe("q-1");
  });

  it("2. then the least prior exposure", () => {
    const history = [...dormant(), makeAttemptRecord({ questionId: "q-a", cell: "cell-seen", finalizedAt: daysAgo(30) }), makeAttemptRecord({ questionId: "q-a", cell: "cell-seen", finalizedAt: daysAgo(31) }), makeAttemptRecord({ questionId: "q-b", cell: "cell-seen", finalizedAt: daysAgo(32) })];
    const outcome = run({
      attemptRecords: history,
      candidates: [makeCandidate({ questionId: "q-a", patternTaxonomyCellId: "cell-n" }), makeCandidate({ questionId: "q-b", patternTaxonomyCellId: "cell-n" }), makeCandidate({ questionId: "q-c", patternTaxonomyCellId: "cell-n" })]
    });
    expect(selectedId(outcome)).toBe("q-c"); // exposure 0 beats 1 and 2
  });

  it("3. then questionId ascending, independent of the candidate order", () => {
    const candidates = ["q-3", "q-1", "q-2"].map((id) => makeCandidate({ questionId: id, patternTaxonomyCellId: "cell-n" }));
    expect(selectedId(run({ attemptRecords: dormant(), candidates }))).toBe("q-1");
    expect(selectedId(run({ attemptRecords: dormant(), candidates: [...candidates].reverse() }))).toBe("q-1");
  });

  it("preference order is lexicographic: an unseen cell beats lower exposure on a seen cell", () => {
    const history = [...dormant(), makeAttemptRecord({ questionId: "q-new", cell: "cell-x", finalizedAt: daysAgo(30), conceptName: "Percentages" })];
    const outcome = run({
      attemptRecords: history,
      candidates: [makeCandidate({ questionId: "q-new", patternTaxonomyCellId: "cell-x" }), makeCandidate({ questionId: "q-zzz", patternTaxonomyCellId: "cell-fresh" })]
    });
    expect(selectedId(outcome)).toBe("q-zzz");
  });
});

describe("Revision provider contract", () => {
  it("select() with a requirement it did not produce is an error, never a guess", () => {
    const outcome = provider.select(makeContext(), { requirement: { notes: [] }, explanation: "x" });
    expect(outcome).toMatchObject({ status: "error", code: "invalid_context" });
  });

  it("not_applicable carries the provider's own reason and never reaches select()", () => {
    expect(run({ attemptRecords: [] })).toMatchObject({ status: "not_applicable", reason: "insufficient_evidence" });
  });

  it("select() output has no stage, no score and no day count anywhere", () => {
    const outcome = run({ attemptRecords: dormant(), candidates: [makeCandidate({ questionId: "q-1", patternTaxonomyCellId: "cell-n" })] });
    const text = JSON.stringify(outcome);
    expect(text).not.toMatch(/stage|score|priority|decay|probab|forgot|dormancyDays/i);
  });
});
