import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { selectNoveltyTrainingQuestion } from "../src/selection.js";
import type { NoveltyTrainingRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

const REQUIREMENT: NoveltyTrainingRequirement = { targetConceptName: "Percentages", targetNoveltyLevel: "novel_representation" };

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

describe("selectNoveltyTrainingQuestion", () => {
  it("no_eligible_question when the pool is empty", () => {
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context(), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes a candidate for the wrong concept", () => {
    const wrongConcept = makeCandidate({ conceptName: "Ratio", noveltyLevel: "novel_representation" });
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [wrongConcept] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes a candidate with the wrong novelty level", () => {
    const wrongLevel = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_context" });
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [wrongLevel] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes unpublished candidates, correctly counted as ineligible", () => {
    const draft = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation" }, { validationState: "draft" });
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [draft] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") expect(outcome.diagnostics.excludedIneligibleCount).toBe(1);
  });

  it("excludes a structurally malformed candidate, counted separately from ineligible", () => {
    const malformed = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation" });
    // @ts-expect-error -- deliberately corrupting the fixture to prove the malformed-candidate guard.
    malformed.question.patternTaxonomyCellId = undefined;
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [malformed] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") {
      expect(outcome.diagnostics.excludedMalformedCount).toBe(1);
      expect(outcome.diagnostics.excludedIneligibleCount).toBe(0);
    }
  });

  it("accepts a candidate matching concept and novelty level exactly", () => {
    const matching = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation" });
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [matching] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("selected");
  });

  it("prefers a candidate whose taxonomy cell the student has NOT previously attempted at this novelty level", () => {
    const seenCell = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", patternTaxonomyCellId: "cell-seen", questionId: "seen-cell-question" });
    const unseenCell = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", patternTaxonomyCellId: "cell-unseen", questionId: "unseen-cell-question" });
    const attemptRecords = [makeAttemptRecord({ conceptName: "Percentages", noveltyLevel: "novel_representation", patternTaxonomyCellId: "cell-seen" })];

    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [seenCell, unseenCell], attemptRecords }), REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-cell-question");
  });

  it("falls back to the full qualifying pool when every candidate's cell has already been seen at this level", () => {
    const onlySeen = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", patternTaxonomyCellId: "cell-seen" });
    const attemptRecords = [makeAttemptRecord({ conceptName: "Percentages", noveltyLevel: "novel_representation", patternTaxonomyCellId: "cell-seen" })];

    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [onlySeen], attemptRecords }), REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
  });

  it("within the same partition, prefers the least-exposed candidate", () => {
    const seen = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", questionId: "seen-question" });
    const unseen = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", questionId: "unseen-question" });
    const attemptRecords = [makeAttemptRecord({ questionId: "seen-question" }), makeAttemptRecord({ questionId: "seen-question" })];

    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [seen, unseen], attemptRecords }), REQUIREMENT, "test");

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("unseen-question");
  });

  it("falls back to lexicographic questionId as the final deterministic tie-break", () => {
    const b = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", questionId: "b-question" });
    const a = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", questionId: "a-question" });
    const outcome = selectNoveltyTrainingQuestion("novelty-training", context({ candidates: [b, a] }), REQUIREMENT, "test");
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("a-question");
  });

  it("repeated invocation with identical input gives an identical answer (determinism)", () => {
    const candidates = [makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", questionId: "b-question" }), makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation", questionId: "a-question" })];
    const ctx = context({ candidates });
    const first = selectNoveltyTrainingQuestion("novelty-training", ctx, REQUIREMENT, "test");
    const second = selectNoveltyTrainingQuestion("novelty-training", ctx, REQUIREMENT, "test");
    expect(first).toEqual(second);
  });
});
