import { describe, expect, it } from "vitest";
import type { AdaptiveCandidateQuestion, AdaptiveSelectionInput, AdaptiveSelectionResult } from "../src/types.js";
import { makeCandidate, makeQuestion, STUDENT } from "./fixtures.js";

/**
 * Compile-time guards against a FUTURE caller (or a careless edit)
 * accidentally widening these types to accept arbitrary "mastery" numbers
 * or hidden-confidence/psychological fields the selector was never
 * designed to trust. TypeScript's excess-property check on an OBJECT
 * LITERAL assigned directly to a typed variable is what makes these real,
 * enforced checks — not just documentation. If any `@ts-expect-error`
 * below stops erroring, it means the type was actually widened to accept
 * the forbidden field, and this test file will fail to typecheck.
 */
describe("adaptive-selection — regression guards: no hidden score/confidence/mastery-shortcut fields", () => {
  it("AdaptiveSelectionInput rejects a raw numeric 'masteryScore' shortcut in place of real MasteryStateResult[]", () => {
    const input: AdaptiveSelectionInput = {
      studentId: STUDENT,
      // @ts-expect-error -- masteryByConcept must be MasteryStateResult[], never a bare number/score.
      masteryByConcept: 0.75,
      attemptRecords: [],
      candidates: []
    };
    void input;
  });

  it("AdaptiveSelectionInput rejects a hidden confidence/motivation/emotion field", () => {
    const input: AdaptiveSelectionInput = {
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [],
      // @ts-expect-error -- AdaptiveSelectionInput has no confidence field and must never gain one.
      confidence: 0.9
    };
    void input;
  });

  it("AdaptiveCandidateQuestion rejects a caller-supplied 'motivation' or 'predictedAbility' field", () => {
    const candidate: AdaptiveCandidateQuestion = {
      question: makeQuestion(),
      expectedTimeSeconds: 90,
      validationState: "published",
      // @ts-expect-error -- AdaptiveCandidateQuestion has no such fields and must never gain one.
      predictedAbility: 0.5
    };
    void candidate;
  });

  it("AdaptiveSelectionResult rejects a caller/implementation attaching an 'overallMastery' or 'score' field", () => {
    const base: AdaptiveSelectionResult = {
      question: makeQuestion(),
      primaryReason: "coverage_gap",
      allReasonsSatisfied: ["coverage_gap"],
      targetConceptName: "Percentages",
      isFallback: false,
      explanation: "test",
      coverageGapAddressed: null,
      rankedAlternatives: [],
      candidatesConsidered: 1,
      excludedMalformedCount: 0,
      excludedUnpublishedCount: 0
    };
    // @ts-expect-error -- AdaptiveSelectionResult has no overallMastery/score field and must never gain one.
    const withScore: AdaptiveSelectionResult = { ...base, overallMastery: 0.8 };
    void withScore;
  });

  it("sanity: a well-formed candidate still passes the type checker (proves the @ts-expect-error cases above are catching the ADDED field, not something else)", () => {
    const candidate = makeCandidate();
    expect(candidate.question.questionId).toBeTruthy();
  });
});
