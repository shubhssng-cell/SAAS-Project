import { describe, expect, it } from "vitest";
import { computeNoveltyExposureEvidence, distinctConceptNames } from "../src/noveltyEvidence.js";
import { makeAttemptRecord, makeExposureBatch, STUDENT } from "./fixtures.js";

function dimensionFor(evidence: ReturnType<typeof computeNoveltyExposureEvidence>, level: "novel_representation" | "novel_combination" | "novel_context") {
  return evidence.dimensions.find((d) => d.noveltyLevel === level)!;
}

describe("computeNoveltyExposureEvidence", () => {
  it("zero history -> zero standard exposure and all three dimensions empty", () => {
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", []);
    expect(evidence.standardExposureCount).toBe(0);
    expect(evidence.dimensions).toHaveLength(3);
    for (const dimension of evidence.dimensions) expect(dimension.distinctQuestionIds).toEqual([]);
  });

  it("standard-only history -> standard count reflects it, all non-standard dimensions remain at zero", () => {
    const records = makeExposureBatch(5, { noveltyLevel: "standard" });
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(evidence.standardExposureCount).toBe(5);
    for (const dimension of evidence.dimensions) expect(dimension.distinctQuestionIds).toHaveLength(0);
  });

  it("0/1/2/3 distinct novelty exposures are counted precisely", () => {
    const zero = computeNoveltyExposureEvidence(STUDENT, "Percentages", []);
    expect(dimensionFor(zero, "novel_representation").distinctQuestionIds).toHaveLength(0);

    const one = computeNoveltyExposureEvidence(STUDENT, "Percentages", makeExposureBatch(1, { noveltyLevel: "novel_representation" }));
    expect(dimensionFor(one, "novel_representation").distinctQuestionIds).toHaveLength(1);

    const two = computeNoveltyExposureEvidence(STUDENT, "Percentages", makeExposureBatch(2, { noveltyLevel: "novel_representation" }));
    expect(dimensionFor(two, "novel_representation").distinctQuestionIds).toHaveLength(2);

    const three = computeNoveltyExposureEvidence(STUDENT, "Percentages", makeExposureBatch(3, { noveltyLevel: "novel_representation" }));
    expect(dimensionFor(three, "novel_representation").distinctQuestionIds).toHaveLength(3);
  });

  it("the same question retried many times contributes at most ONE distinct exposure", () => {
    const sharedQuestionId = "same-question";
    const records = Array.from({ length: 5 }, () => makeAttemptRecord({ questionId: sharedQuestionId, noveltyLevel: "novel_context" }));
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_context").distinctQuestionIds).toEqual([sharedQuestionId]);
  });

  it("wrong answers still count as exposure -- this is an exposure model, not an accuracy model", () => {
    const records = makeExposureBatch(3, { noveltyLevel: "novel_representation", isCorrect: false });
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_representation").distinctQuestionIds).toHaveLength(3);
  });

  it("skipped attempts are excluded", () => {
    const records = [...makeExposureBatch(2, { noveltyLevel: "novel_representation" }), makeAttemptRecord({ noveltyLevel: "novel_representation", status: "skipped", isCorrect: null })];
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_representation").distinctQuestionIds).toHaveLength(2);
  });

  it("abandoned attempts are excluded", () => {
    const records = [...makeExposureBatch(2, { noveltyLevel: "novel_representation" }), makeAttemptRecord({ noveltyLevel: "novel_representation", status: "abandoned", isCorrect: null })];
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_representation").distinctQuestionIds).toHaveLength(2);
  });

  it("cross-student isolation: another student's attempts never contribute", () => {
    const records = [...makeExposureBatch(2, { noveltyLevel: "novel_representation" }), ...makeExposureBatch(5, { noveltyLevel: "novel_representation", studentId: "someone-else" })];
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_representation").distinctQuestionIds).toHaveLength(2);
  });

  it("cross-concept isolation: another concept's attempts never contribute", () => {
    const records = [...makeExposureBatch(2, { noveltyLevel: "novel_representation", conceptName: "Percentages" }), ...makeExposureBatch(5, { noveltyLevel: "novel_representation", conceptName: "Ratio" })];
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_representation").distinctQuestionIds).toHaveLength(2);
  });

  it("combinesWithConcepts diagnostics populate only for novel_combination, never for the other two levels", () => {
    const records = [
      ...makeExposureBatch(1, { noveltyLevel: "novel_combination", combinesWithConcepts: ["Ratio", "Averages"] }),
      ...makeExposureBatch(1, { noveltyLevel: "novel_representation", combinesWithConcepts: ["Ratio"] })
    ];
    const evidence = computeNoveltyExposureEvidence(STUDENT, "Percentages", records);
    expect(dimensionFor(evidence, "novel_combination").combinedConceptNames.sort()).toEqual(["Averages", "Ratio"]);
    expect(dimensionFor(evidence, "novel_representation").combinedConceptNames).toEqual([]);
  });

  it("distinctConceptNames derives the concept set purely from graded attempt history", () => {
    const records = [makeAttemptRecord({ conceptName: "Percentages" }), makeAttemptRecord({ conceptName: "Ratio" }), makeAttemptRecord({ conceptName: "Percentages", status: "skipped", isCorrect: null })];
    expect(distinctConceptNames(STUDENT, records)).toEqual(["Percentages", "Ratio"]);
  });
});
