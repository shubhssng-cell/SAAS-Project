import { describe, expect, it } from "vitest";
import { selectPressureTrainingQuestion } from "../src/selection.js";
import type { PressureTrainingRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, makeContext, STUDENT } from "./fixtures.js";

const requirement: PressureTrainingRequirement = { targetConceptName: "Percentages", evidencedDimension: "reduced_recovery", notes: [] };

describe("selectPressureTrainingQuestion", () => {
  it("excludes unpublished candidates", () => {
    const candidate = makeCandidate({ conceptName: "Percentages" }, { validationState: "draft" });
    const outcome = selectPressureTrainingQuestion("pressure-training", makeContext({ candidates: [candidate] }), requirement, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes candidates from a different concept", () => {
    const candidate = makeCandidate({ conceptName: "Ratio" });
    const outcome = selectPressureTrainingQuestion("pressure-training", makeContext({ candidates: [candidate] }), requirement, "test");
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("excludes structurally malformed candidates (no patternTaxonomyCellId)", () => {
    const candidate = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "" });
    const outcome = selectPressureTrainingQuestion("pressure-training", makeContext({ candidates: [candidate] }), requirement, "test");
    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status !== "error") expect(outcome.diagnostics.excludedMalformedCount).toBe(1);
  });

  it("selects the sole matching, published, structurally valid candidate", () => {
    const candidate = makeCandidate({ conceptName: "Percentages" });
    const outcome = selectPressureTrainingQuestion("pressure-training", makeContext({ candidates: [candidate] }), requirement, "test");
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe(candidate.question.questionId);
  });

  it("prefers an unseen taxonomy cell over a seen one", () => {
    const seenCell = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-seen" });
    const unseenCell = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-unseen" });
    const priorAttempt = makeAttemptRecord({ attemptId: "prior-1", patternTaxonomyCellId: "cell-seen" });
    const outcome = selectPressureTrainingQuestion(
      "pressure-training",
      makeContext({ candidates: [seenCell, unseenCell], attemptRecords: [priorAttempt] }),
      requirement,
      "test"
    );
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.patternTaxonomyCellId).toBe("cell-unseen");
  });

  it("falls back to the full pool when every candidate's cell has been seen", () => {
    const cellA = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-a", questionId: "question-a" });
    const cellB = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-b", questionId: "question-b" });
    const priorA = makeAttemptRecord({ attemptId: "prior-a", patternTaxonomyCellId: "cell-a" });
    const priorB = makeAttemptRecord({ attemptId: "prior-b", patternTaxonomyCellId: "cell-b", questionId: "question-b" });
    const outcome = selectPressureTrainingQuestion(
      "pressure-training",
      makeContext({ candidates: [cellA, cellB], attemptRecords: [priorA, priorB] }),
      requirement,
      "test"
    );
    // Both seen -- falls back to full pool, then prefers lower exposure. question-a has 0 exposure (prior-a's own questionId differs), question-b has 1.
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe(cellA.question.questionId);
  });

  it("prefers the lowest per-question exposure count within the chosen partition", () => {
    const lowExposure = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-x", questionId: "question-low" });
    const highExposure = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-x", questionId: "question-high" });
    const attempts = [
      makeAttemptRecord({ attemptId: "e1", patternTaxonomyCellId: "cell-x", questionId: "question-high" }),
      makeAttemptRecord({ attemptId: "e2", patternTaxonomyCellId: "cell-x", questionId: "question-high" })
    ];
    const outcome = selectPressureTrainingQuestion(
      "pressure-training",
      makeContext({ candidates: [lowExposure, highExposure], attemptRecords: attempts }),
      requirement,
      "test"
    );
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("question-low");
  });

  it("breaks a final tie by lexicographic questionId", () => {
    const b = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-z1" }, {});
    const a = makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-z2" }, {});
    // Force identical exposure (0) and both unseen -- pure alphabetical tie-break on questionId.
    const outcome = selectPressureTrainingQuestion("pressure-training", makeContext({ candidates: [b, a] }), requirement, "test");
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      const expectedWinnerId = [a.question.questionId, b.question.questionId].sort()[0];
      expect(outcome.question.questionId).toBe(expectedWinnerId);
    }
  });

  it("diagnostics always reports studentId and candidatesConsidered", () => {
    const candidate = makeCandidate({ conceptName: "Percentages" });
    const outcome = selectPressureTrainingQuestion("pressure-training", makeContext({ candidates: [candidate] }), requirement, "test");
    if (outcome.status !== "error") {
      expect(outcome.diagnostics.studentId).toBe(STUDENT);
      expect(outcome.diagnostics.candidatesConsidered).toBe(1);
    }
  });
});
