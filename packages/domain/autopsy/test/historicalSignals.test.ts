import { describe, expect, it } from "vitest";
import { deriveHistoricalSignals } from "../src/historicalSignals.js";
import { buildEvidence } from "../fixtures/evidence.js";
import {
  percentagesHardNovelPressureQuestionContext,
  percentagesQuestionContext,
  ratioQuestionContext
} from "../fixtures/questionContext.js";
import type { HistoricalAttemptRecord } from "../src/types.js";

function record(overrides: Parameters<typeof buildEvidence>[0], question = percentagesQuestionContext): HistoricalAttemptRecord {
  return { evidence: buildEvidence(overrides), question };
}

describe("deriveHistoricalSignals — observable repetition counts only (Phase 5A §7)", () => {
  it("returns null entirely when no prior attempts are supplied", () => {
    const current = record({ isCorrect: false, finalAnswer: "420" });
    expect(deriveHistoricalSignals(current, [])).toBeNull();
  });

  it("repeated concept failure: 3 incorrect attempts on the same concept (2 prior + current) are counted, with attempt ids preserved", () => {
    const prior = [record({ isCorrect: false, finalAnswer: "420" }), record({ isCorrect: false, finalAnswer: "450" })];
    const current = record({ isCorrect: false, finalAnswer: "500" });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedConceptFailure?.count).toBe(3);
    expect(signals?.repeatedConceptFailure?.attemptIds.length).toBe(3);
  });

  it("repeated pattern-family failure is scoped correctly (same concept, same pattern family)", () => {
    const prior = [record({ isCorrect: false })];
    const current = record({ isCorrect: false });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedPatternFamilyFailure?.count).toBe(2);
  });

  it("repeated taxonomy-cell failure requires the SAME cell — a different cell for the same concept does not count", () => {
    const prior = [record({ isCorrect: false }, percentagesHardNovelPressureQuestionContext)]; // different cell
    const current = record({ isCorrect: false }, percentagesQuestionContext);
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedTaxonomyCellFailure).toBeNull(); // only 1 on this specific cell
    expect(signals?.repeatedConceptFailure?.count).toBe(2); // but both are the same concept
  });

  it("a single prior failure plus a current SUCCESS does not report repeated concept failure (threshold is on FAILURES, not attempts)", () => {
    const prior = [record({ isCorrect: false })];
    const current = record({ isCorrect: true });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedConceptFailure).toBeNull();
  });

  it("repeated slow performance across correct and incorrect attempts alike", () => {
    const prior = [record({ isCorrect: true, timeTakenSeconds: 200, expectedTimeSeconds: 90 })];
    const current = record({ isCorrect: false, timeTakenSeconds: 250, expectedTimeSeconds: 90 });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedSlowPerformance?.count).toBe(2);
  });

  it("repeated hint use counts prior + current attempts that used a hint; a single solution-opening does not cross the repeated threshold", () => {
    const prior = [record({ hintsUsed: 1 }), record({ solutionOpenedAt: "2026-09-22T10:00:20.000Z" })];
    const current = record({ hintsUsed: 2 });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedHintUse?.count).toBe(2); // prior[0] + current
    expect(signals?.repeatedSolutionOpening).toBeNull(); // only prior[1] opened a solution — below the repeated threshold
  });

  it("repeated novelty difficulty only counts INCORRECT attempts on non-standard noveltyLevel questions", () => {
    const prior = [
      record({ isCorrect: false }, percentagesHardNovelPressureQuestionContext),
      record({ isCorrect: true }, percentagesHardNovelPressureQuestionContext) // correct, should not count
    ];
    const current = record({ isCorrect: false }, percentagesHardNovelPressureQuestionContext);
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedNoveltyDifficulty?.count).toBe(2);
  });

  it("repeated pressure difficulty is null (not zero) when no pressure-context question exists in the history at all", () => {
    const prior = [record({ isCorrect: false })]; // percentagesQuestionContext has no time_pressured mode
    const current = record({ isCorrect: false });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedPressureDifficulty).toBeNull();
  });

  it("repeated pressure difficulty counts INCORRECT attempts specifically on time_pressured questions, when that context exists", () => {
    const prior = [record({ isCorrect: false }, percentagesHardNovelPressureQuestionContext)];
    const current = record({ isCorrect: false }, percentagesHardNovelPressureQuestionContext);
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedPressureDifficulty?.count).toBe(2);
  });

  it("solutionOpenedAfterPriorIncorrectAttempt is true only when a PRIOR attempt on the SAME question was incorrect and the current attempt opened the solution", () => {
    const prior = [record({ isCorrect: false })];
    const current = record({ isCorrect: true, solutionOpenedAt: "2026-09-22T10:00:20.000Z" });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.solutionOpenedAfterPriorIncorrectAttempt).toBe(true);
  });

  it("solutionOpenedAfterPriorIncorrectAttempt is false when the prior incorrect attempt was on a DIFFERENT question", () => {
    const prior = [{ evidence: buildEvidence({ isCorrect: false, questionId: "some-other-question" }), question: ratioQuestionContext }];
    const current = record({ isCorrect: true, solutionOpenedAt: "2026-09-22T10:00:20.000Z" });
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.solutionOpenedAfterPriorIncorrectAttempt).toBe(false);
  });

  it("historical signals for a different concept do not contaminate the current concept's counts", () => {
    const prior = [record({ isCorrect: false }, ratioQuestionContext), record({ isCorrect: false }, ratioQuestionContext)];
    const current = record({ isCorrect: false }, percentagesQuestionContext);
    const signals = deriveHistoricalSignals(current, prior);
    expect(signals?.repeatedConceptFailure).toBeNull(); // only 1 percentages failure (current itself)
    expect(signals?.totalPriorAttempts).toBe(2);
  });
});
