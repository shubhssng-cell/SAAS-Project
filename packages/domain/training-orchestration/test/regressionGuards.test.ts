import { describe, expect, it } from "vitest";
import type { TrainingCandidateQuestion, TrainingOrchestrationInput, TrainingOrchestrationSelectedAdaptive } from "../src/types.js";
import { makeCandidate, makeQuestion, STUDENT } from "./fixtures.js";

/**
 * Compile-time guards against a FUTURE caller (or a careless edit)
 * accidentally widening these types to accept arbitrary "mastery" numbers
 * or hidden-confidence/psychological fields — the same discipline
 * `@ipmat/adaptive-selection`'s own `regressionGuards.test.ts` already
 * established for this codebase (D-051), extended here to the
 * orchestration layer.
 */
describe("training-orchestration — regression guards: no hidden score/confidence/mastery-shortcut fields", () => {
  it("TrainingOrchestrationInput rejects a raw numeric 'masteryScore' shortcut in place of real MasteryStateResult[]", () => {
    const input: TrainingOrchestrationInput = {
      studentId: STUDENT,
      activeRepairPlans: [],
      // @ts-expect-error -- masteryByConcept must be MasteryStateResult[], never a bare number/score.
      masteryByConcept: 0.75,
      attemptRecords: [],
      candidates: []
    };
    void input;
  });

  it("TrainingOrchestrationInput rejects a hidden confidence/motivation/emotion field", () => {
    const input: TrainingOrchestrationInput = {
      studentId: STUDENT,
      activeRepairPlans: [],
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [],
      // @ts-expect-error -- TrainingOrchestrationInput has no confidence field and must never gain one.
      confidence: 0.9
    };
    void input;
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

  it("a selected adaptive_practice result rejects an 'overallMastery'/'score' field attached after the fact", () => {
    const base: TrainingOrchestrationSelectedAdaptive = {
      status: "selected",
      actionType: "adaptive_practice",
      question: makeQuestion(),
      explanation: "test",
      providerResult: {
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
      },
      wasFallbackFromRepair: false,
      wasFallbackFromTrainingSystems: false,
      diagnostics: {
        repairPlansSupplied: 0,
        repairPlansExcludedAsUnconfirmed: 0,
        repairPlanChosen: null,
        repairAttempted: false,
        repairOutcome: null,
        trainingSystemProviderOutcomes: [],
        trainingSystemProviderChosen: null,
        adaptiveAttempted: true,
        adaptiveOutcome: null,
        fallbackPermittedByPolicy: true,
        fallbackOccurred: false,
        fallbackPermittedToTrainingSystemsPolicy: true,
        fallbackPermittedToAdaptiveAfterTrainingSystemsPolicy: true
      }
    };
    // @ts-expect-error -- TrainingOrchestrationSelectedAdaptive has no overallMastery/score field and must never gain one.
    const withScore: TrainingOrchestrationSelectedAdaptive = { ...base, overallMastery: 0.8 };
    void withScore;
  });

  it("sanity: a well-formed candidate still passes the type checker (proves the @ts-expect-error cases above are catching the ADDED field, not something else)", () => {
    const candidate = makeCandidate();
    expect(candidate.question.questionId).toBeTruthy();
  });
});
