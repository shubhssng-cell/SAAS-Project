import type {
  AutopsyQuestionContext,
  TrainingCandidateQuestion,
  TrainingRequirement,
  TrainingSystemContext,
  TrainingSystemProvider,
  TrainingSystemSelectionOutcome
} from "../src/types.js";
import { buildTrainingSystemDiagnostics } from "../src/diagnostics.js";

export const STUDENT = "student-1";

let questionIdCounter = 0;
export function makeQuestion(overrides: Partial<AutopsyQuestionContext> = {}): AutopsyQuestionContext {
  questionIdCounter += 1;
  return {
    questionId: `question-${questionIdCounter}`,
    examCode: "IPMAT_INDORE",
    sectionName: "Quant",
    chapterName: "Percentages",
    conceptName: "Percentages",
    patternFamilyName: "Reverse Percentage",
    patternTaxonomyCellId: "cell-reverse-standard",
    difficultyTier: "standard",
    difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 },
    noveltyLevel: "standard",
    examRelevance: "core",
    testingModes: ["reverse"],
    trapErrorTaxonomyCode: "base_confusion",
    combinesWithConcepts: [],
    ...overrides
  };
}

export function makeCandidate(
  questionOverrides: Partial<AutopsyQuestionContext> = {},
  candidateOverrides: Partial<Omit<TrainingCandidateQuestion, "question">> = {}
): TrainingCandidateQuestion {
  return { question: makeQuestion(questionOverrides), expectedTimeSeconds: 90, validationState: "published", ...candidateOverrides };
}

export function baseContext(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

/**
 * A deliberately minimal, deterministic MOCK provider for testing the
 * shared contract/runner in isolation, WITHOUT building a real training
 * mode (no concrete provider is built in this unit). Its "select" logic
 * is intentionally trivial (first published candidate wins) precisely
 * BECAUSE it must never resemble a real ranking algorithm.
 */
export function makeMockProvider(options: {
  providerId?: string;
  applicable?: boolean;
  applicabilityReason?: string;
  requirement?: TrainingRequirement;
  forceSelectResult?: TrainingSystemSelectionOutcome;
} = {}): { provider: TrainingSystemProvider; selectCallCount: () => number } {
  let selectCalls = 0;
  const providerId = options.providerId ?? "mock-provider";

  const provider: TrainingSystemProvider = {
    providerId,
    evaluate(_context) {
      if (options.applicable === false) {
        return { applicable: false, reason: options.applicabilityReason ?? "mock_not_applicable", explanation: "Mock provider is not applicable for this context." };
      }
      return { applicable: true, requirement: options.requirement ?? {}, explanation: "Mock provider is applicable." };
    },
    select(context, applicability) {
      selectCalls += 1;
      if (options.forceSelectResult) return options.forceSelectResult;

      const eligible = context.candidates.filter((c) => c.validationState === "published");
      if (eligible.length === 0) {
        return {
          status: "no_eligible_question",
          requirement: applicability.requirement,
          explanation: "No published candidate satisfies the mock requirement.",
          diagnostics: buildTrainingSystemDiagnostics({
            providerId,
            studentId: context.studentId,
            eligible: true,
            candidatesConsidered: context.candidates.length,
            excludedIneligibleCount: context.candidates.length
          })
        };
      }

      return {
        status: "selected",
        question: eligible[0]!.question,
        requirement: applicability.requirement,
        explanation: "Mock provider selected the first published candidate.",
        diagnostics: buildTrainingSystemDiagnostics({ providerId, studentId: context.studentId, eligible: true, candidatesConsidered: context.candidates.length })
      };
    }
  };

  return { provider, selectCallCount: () => selectCalls };
}
