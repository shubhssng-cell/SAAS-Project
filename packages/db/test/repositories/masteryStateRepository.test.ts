import { recordAttemptEvent, startAttempt, submitAttempt, toMasteryContribution, type AttemptQuestionContext } from "@ipmat/attempt";
import type { AutopsyQuestionContext } from "@ipmat/autopsy";
import { computeMasteryState, type MasteryAttemptRecord } from "@ipmat/mastery";
import { describe, expect, it } from "vitest";
import { InMemoryMasteryStateRepository } from "../fixtures/inMemoryRepositories.js";

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

const attemptQuestionContext: AttemptQuestionContext = {
  questionId: "question-mastery-repo-1",
  conceptId: "concept-percentages",
  answerFormat: "multiple_choice",
  options: ["420", "450", "480", "500"],
  correctAnswer: "480",
  expectedTimeSeconds: 90
};

const autopsyQuestionContext: AutopsyQuestionContext = {
  questionId: attemptQuestionContext.questionId,
  examCode: "IPMAT_INDORE",
  sectionName: "Quant",
  chapterName: "Percentages",
  conceptName: "Percentages",
  patternFamilyName: "Reverse Percentage",
  patternTaxonomyCellId: "cell-mastery-repo-1",
  difficultyTier: "advanced",
  difficultyDimensions: { conceptualLoad: 0.4, computationalLoad: 0.3, trapDensity: 0.5, representationNovelty: 0.2, timePressure: 0.3, multiStepDepth: 0.4 },
  noveltyLevel: "standard",
  examRelevance: "core",
  testingModes: ["reverse"],
  trapErrorTaxonomyCode: "base_confusion",
  combinesWithConcepts: ["Ratio"]
};

function buildAttemptRecord(id: string, studentId: string, offsetSeconds: number, isCorrect: boolean, selected: string): MasteryAttemptRecord {
  const claim = { studentId, questionId: attemptQuestionContext.questionId };
  let attempt = startAttempt({ id, studentId, questionId: attemptQuestionContext.questionId, enrollmentId: "enrollment-1", now: t(offsetSeconds) });
  attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: t(offsetSeconds + 1), selectedAnswer: selected }, claim);
  attempt = submitAttempt(attempt, claim, attemptQuestionContext, { now: t(offsetSeconds + 30) });
  expect(attempt.isCorrect).toBe(isCorrect);
  return { contribution: toMasteryContribution(attempt, attemptQuestionContext), question: autopsyQuestionContext };
}

describe("PrismaMasteryStateRepository semantics — the three-state model (Phase 5C-1, docs/DECISIONS.md D-043), verified against InMemoryMasteryStateRepository (no live DB)", () => {
  it("returns null and writes nothing when there are zero contributing attempts", async () => {
    const result = computeMasteryState([], { studentId: "student-1", conceptId: "concept-percentages", conceptName: "Percentages", now: t(100) });
    const repo = new InMemoryMasteryStateRepository();

    expect(await repo.save(result)).toBeNull();
    expect(await repo.findByStudentAndConcept("student-1", "concept-percentages")).toBeNull();
  });

  it("writes a row with per-dimension NULLs once any attempt exists, even below the observation threshold", async () => {
    const records = [buildAttemptRecord("attempt-mastery-repo-1", "student-1", 0, true, "480")];
    const result = computeMasteryState(records, { studentId: "student-1", conceptId: "concept-percentages", conceptName: "Percentages", now: t(100) });
    const repo = new InMemoryMasteryStateRepository();

    const stored = await repo.save(result);
    expect(stored).not.toBeNull();
    expect(stored?.accuracy).toBeNull();
    expect(stored?.speedRatio).toBeNull();

    const found = await repo.findByStudentAndConcept("student-1", "concept-percentages");
    expect(found).toEqual(stored);
  });

  it("persists a genuine 0% accuracy as the number 0, never confused with the NULL 'insufficient data' state", async () => {
    const records = [
      buildAttemptRecord("attempt-mastery-repo-a", "student-2", 0, false, "420"),
      buildAttemptRecord("attempt-mastery-repo-b", "student-2", 60, false, "420"),
      buildAttemptRecord("attempt-mastery-repo-c", "student-2", 120, false, "420")
    ];
    const result = computeMasteryState(records, { studentId: "student-2", conceptId: "concept-percentages", conceptName: "Percentages", now: t(200) });
    expect(result.measures.accuracy).toBe(0);

    const repo = new InMemoryMasteryStateRepository();
    const stored = await repo.save(result);
    expect(stored?.accuracy).toBe(0);
    expect(stored?.accuracy).not.toBeNull();

    const found = await repo.findByStudentAndConcept("student-2", "concept-percentages");
    expect(found?.accuracy).toBe(0);
  });

  it("saving twice for the same (studentId, conceptId) upserts the same row rather than creating a second one", async () => {
    const first = computeMasteryState([buildAttemptRecord("attempt-mastery-repo-up1", "student-3", 0, true, "480")], {
      studentId: "student-3",
      conceptId: "concept-percentages",
      conceptName: "Percentages",
      now: t(0)
    });
    const repo = new InMemoryMasteryStateRepository();
    const stored1 = await repo.save(first);

    const second = computeMasteryState(
      [
        buildAttemptRecord("attempt-mastery-repo-up1", "student-3", 0, true, "480"),
        buildAttemptRecord("attempt-mastery-repo-up2", "student-3", 60, true, "480")
      ],
      { studentId: "student-3", conceptId: "concept-percentages", conceptName: "Percentages", now: t(60) }
    );
    const stored2 = await repo.save(second);

    expect(stored2?.id).toBe(stored1?.id);
    const found = await repo.findByStudentAndConcept("student-3", "concept-percentages");
    expect(found?.id).toBe(stored1?.id);
  });

  it("rejects a record with a non-finite measure (invalid state combination — corrupted input)", async () => {
    const base = computeMasteryState([buildAttemptRecord("attempt-mastery-repo-bad", "student-4", 0, true, "480")], {
      studentId: "student-4",
      conceptId: "concept-percentages",
      conceptName: "Percentages",
      now: t(0)
    });
    const corrupted = { ...base, measures: { ...base.measures, accuracy: NaN } };
    const repo = new InMemoryMasteryStateRepository();

    await expect(repo.save(corrupted)).rejects.toThrow(/must be null or a finite number/);
  });

  it("rejects a record with an empty studentId (invalid state combination — corrupted input, since a real computed result always has a real studentId)", async () => {
    const base = computeMasteryState([buildAttemptRecord("attempt-mastery-repo-empty", "student-5", 0, true, "480")], {
      studentId: "student-5",
      conceptId: "concept-percentages",
      conceptName: "Percentages",
      now: t(0)
    });
    // computeMasteryState always echoes back a real studentId — corrupt it directly to
    // exercise the repository's own defensive guard, independent of the domain layer.
    const corrupted = { ...base, studentId: "" };
    const repo = new InMemoryMasteryStateRepository();

    await expect(repo.save(corrupted)).rejects.toThrow(/studentId/);
  });
});
