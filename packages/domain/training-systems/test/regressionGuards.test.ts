import { describe, expect, it } from "vitest";
import type { TrainingCandidateQuestion, TrainingSystemContext, TrainingSystemDiagnostics, TrainingSystemSelectionOutcome } from "../src/types.js";
import { makeCandidate, makeQuestion, STUDENT } from "./fixtures.js";

/**
 * Compile-time guards against a FUTURE caller (or a careless edit)
 * accidentally widening these types to accept arbitrary "mastery" numbers
 * or hidden-confidence/psychological fields — the same discipline
 * `@ipmat/adaptive-selection` (D-051) and `@ipmat/training-orchestration`
 * (D-052) already established, extended here to the shared provider
 * contract itself.
 */
describe("training-systems — regression guards: no hidden score/confidence/mastery-shortcut fields", () => {
  it("TrainingSystemContext rejects a raw numeric 'masteryScore' shortcut in place of real MasteryStateResult[]", () => {
    const context: TrainingSystemContext = {
      studentId: STUDENT,
      // @ts-expect-error -- masteryByConcept must be MasteryStateResult[], never a bare number/score.
      masteryByConcept: 0.75,
      attemptRecords: [],
      candidates: []
    };
    void context;
  });

  it("TrainingSystemContext rejects a hidden confidence/motivation/emotion field", () => {
    const context: TrainingSystemContext = {
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [],
      // @ts-expect-error -- TrainingSystemContext has no confidence field and must never gain one.
      confidence: 0.9
    };
    void context;
  });

  it("TrainingCandidateQuestion rejects a caller-supplied 'predictedAbility' field", () => {
    const candidate: TrainingCandidateQuestion = {
      question: makeQuestion(),
      expectedTimeSeconds: 90,
      validationState: "published",
      // @ts-expect-error -- TrainingCandidateQuestion has no such field and must never gain one.
      predictedAbility: 0.5
    };
    void candidate;
  });

  it("TrainingSystemDiagnostics rejects an 'overallMastery'/'score' field attached after the fact", () => {
    const base: TrainingSystemDiagnostics = {
      providerId: "p",
      studentId: STUDENT,
      eligible: true,
      candidatesConsidered: 0,
      excludedMalformedCount: 0,
      excludedIneligibleCount: 0,
      notes: []
    };
    // @ts-expect-error -- TrainingSystemDiagnostics has no overallMastery/score field and must never gain one.
    const withScore: TrainingSystemDiagnostics = { ...base, overallMastery: 0.8 };
    void withScore;
  });

  it("a selected outcome rejects a 'motivation' field even alongside otherwise-valid data", () => {
    const outcome: TrainingSystemSelectionOutcome = {
      status: "selected",
      question: makeQuestion(),
      requirement: {},
      explanation: "test",
      diagnostics: { providerId: "p", studentId: STUDENT, eligible: true, candidatesConsidered: 1, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] },
      // @ts-expect-error -- TrainingSystemSelectionOutcome's "selected" variant has no motivation field and must never gain one.
      motivation: "high"
    };
    void outcome;
  });

  it("sanity: a well-formed candidate still passes the type checker (proves the @ts-expect-error cases above are catching the ADDED field, not something else)", () => {
    const candidate = makeCandidate();
    expect(candidate.question.questionId).toBeTruthy();
  });
});
