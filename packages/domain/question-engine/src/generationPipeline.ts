import type { ConceptGraph } from "@ipmat/concept-graph";
import {
  answerReverificationAiSchema,
  generateStructured,
  questionCandidateAiSchema,
  validationJudgeAiSchema,
  AiGenerationError,
  type AiProvider,
  type AiResultMetadata,
  type QuestionCandidateAiOutput
} from "@ipmat/ai";
import {
  checkDuplicateRisk,
  compareReverification,
  fail,
  interpretJudgeVerdict,
  validateCandidateStructurally,
  verifyComputation,
  type ValidationIssue,
  type ValidationResult
} from "@ipmat/validation";
import type { QuestionBlueprint } from "./blueprint.js";
import { DEFAULT_SINGLE_RUN_LIMITS, validateGenerationLimits, type GenerationLimits } from "./generationLimits.js";
import { computeLifecycleStatus, type QuestionLifecycleStatus } from "./lifecycle.js";
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  buildReverificationSystemPrompt,
  buildReverificationUserPrompt
} from "./prompts.js";
import { toJudgeView, toPresentedQuestionView } from "./verifierView.js";

export interface GenerationPipelineInput {
  blueprint: QuestionBlueprint;
  aiProvider: AiProvider;
  graph: ConceptGraph;
  existingQuestionStems: string[];
  provenanceSourceType: string | null;
  /** Defaults to DEFAULT_SINGLE_RUN_LIMITS (one blueprint, one candidate) — validated before any AI call is made (Phase 3.1 §9). */
  limits?: GenerationLimits;
}

export interface GenerationPipelineResult {
  blueprint: QuestionBlueprint;
  candidate: QuestionCandidateAiOutput | null;
  metadata: {
    generation: AiResultMetadata | null;
    reverification: AiResultMetadata | null;
    judge: AiResultMetadata | null;
  };
  checks: {
    structural: ValidationResult;
    computation: ValidationResult;
    reverification: ValidationResult;
    duplicateRisk: ValidationResult;
    judge: ValidationResult;
  };
  status: QuestionLifecycleStatus;
  rejectionReasons: ValidationIssue[];
}

/**
 * INPUT (one blueprint) -> AI generation -> independent verification ->
 * quality validation -> Final Question Candidate (docs/QUESTION_ENGINE.md
 * §5c / Phase 3 §13). Every step's AI call goes through generateStructured
 * — nothing here parses raw text or trusts unvalidated JSON. A failure at
 * the generation step itself (the AI call errors out after retries) is
 * treated as a rejection, not an unhandled exception — "a failed
 * generation must terminate safely" (Phase 3 §11).
 */
export async function runGenerationPipeline(input: GenerationPipelineInput): Promise<GenerationPipelineResult> {
  const limits = input.limits ?? DEFAULT_SINGLE_RUN_LIMITS;
  validateGenerationLimits(limits); // throws before any AI call if the limits themselves are unsafe

  let runningCostUsd = 0;
  const trackCost = (metadata: AiResultMetadata | null) => {
    if (metadata?.estimatedCostUsd) runningCostUsd += metadata.estimatedCostUsd;
  };
  const overBudget = () => runningCostUsd > limits.maxEstimatedBudgetUsd;

  const blueprintExpectation = {
    id: input.blueprint.id,
    conceptName: input.blueprint.conceptName,
    patternFamilyName: input.blueprint.patternFamilyName,
    difficultyTier: input.blueprint.difficultyTier,
    requiredTestingModes: input.blueprint.testingModes,
    trapErrorTaxonomyCode: input.blueprint.trapErrorTaxonomyCode,
    combinationConcepts: input.blueprint.combinationConcepts
  };

  let candidate: QuestionCandidateAiOutput;
  let generationMetadata: AiResultMetadata;
  try {
    const result = await generateStructured(input.aiProvider, {
      task: "question-generation",
      promptVersion: "question-generation-v1",
      systemPrompt: buildGenerationSystemPrompt(),
      userPrompt: buildGenerationUserPrompt(input.blueprint),
      schema: questionCandidateAiSchema,
      options: { maxRetries: limits.maxRetries, timeoutMs: 30_000 }
    });
    candidate = result.data;
    generationMetadata = result.metadata;
    trackCost(generationMetadata);
  } catch (error) {
    const aiError = error instanceof AiGenerationError ? error : null;
    const failure = fail("malformed_output", "generation", aiError?.message ?? "Generation call failed");
    return {
      blueprint: input.blueprint,
      candidate: null,
      metadata: { generation: aiError?.metadata ?? null, reverification: null, judge: null },
      checks: { structural: failure, computation: failure, reverification: failure, duplicateRisk: failure, judge: failure },
      status: "rejected",
      rejectionReasons: failure.issues
    };
  }

  const structural = validateCandidateStructurally(candidate, input.graph, blueprintExpectation, input.provenanceSourceType);

  const computation = verifyComputation({
    computation: candidate.groundTruthDerivation.computation,
    expectedAnswer: candidate.groundTruthDerivation.expectedAnswer,
    correctAnswer: candidate.correctAnswer
  });

  let reverification: ValidationResult;
  let reverificationMetadata: AiResultMetadata | null;
  if (overBudget()) {
    reverificationMetadata = null;
    reverification = fail(
      "budget_exceeded",
      "reverification",
      `Skipped: running estimated cost ($${runningCostUsd.toFixed(4)}) already exceeds maxEstimatedBudgetUsd ($${limits.maxEstimatedBudgetUsd})`
    );
  } else {
    try {
      const result = await generateStructured(input.aiProvider, {
        task: "answer-reverification",
        promptVersion: "answer-reverification-v1",
        systemPrompt: buildReverificationSystemPrompt(),
        userPrompt: buildReverificationUserPrompt(toPresentedQuestionView(candidate)),
        schema: answerReverificationAiSchema,
        options: { maxRetries: limits.maxRetries, timeoutMs: 30_000 }
      });
      reverificationMetadata = result.metadata;
      trackCost(reverificationMetadata);
      reverification = compareReverification({ candidateAnswer: candidate.correctAnswer, reDerivedAnswer: result.data.derivedAnswer });
    } catch (error) {
      const aiError = error instanceof AiGenerationError ? error : null;
      reverificationMetadata = aiError?.metadata ?? null;
      trackCost(reverificationMetadata);
      reverification = fail("answer_mismatch", "reDerivedAnswer", `Independent re-derivation call failed: ${aiError?.message ?? "unknown error"}`);
    }
  }

  const duplicateRisk = checkDuplicateRisk(candidate.stem, input.existingQuestionStems);

  let judge: ValidationResult;
  let judgeMetadata: AiResultMetadata | null;
  if (overBudget()) {
    judgeMetadata = null;
    judge = fail(
      "budget_exceeded",
      "judge",
      `Skipped: running estimated cost ($${runningCostUsd.toFixed(4)}) already exceeds maxEstimatedBudgetUsd ($${limits.maxEstimatedBudgetUsd})`
    );
  } else {
    try {
      const result = await generateStructured(input.aiProvider, {
        task: "validation-judge",
        promptVersion: "validation-judge-v1",
        systemPrompt: buildJudgeSystemPrompt(),
        userPrompt: buildJudgeUserPrompt(toJudgeView(candidate)),
        schema: validationJudgeAiSchema,
        options: { maxRetries: limits.maxRetries, timeoutMs: 30_000 }
      });
      judgeMetadata = result.metadata;
      trackCost(judgeMetadata);
      judge = interpretJudgeVerdict(result.data);
    } catch (error) {
      const aiError = error instanceof AiGenerationError ? error : null;
      judgeMetadata = aiError?.metadata ?? null;
      trackCost(judgeMetadata);
      judge = fail("judge_ambiguous", "judge", `Validation-judge call failed: ${aiError?.message ?? "unknown error"}`);
    }
  }

  const checks = { structural, computation, reverification, duplicateRisk, judge };
  const allChecksPassed = Object.values(checks).every((result) => result.valid);
  const status = computeLifecycleStatus({ allChecksPassed, difficultyTier: candidate.questionDna.difficultyTier });

  return {
    blueprint: input.blueprint,
    candidate,
    metadata: { generation: generationMetadata, reverification: reverificationMetadata, judge: judgeMetadata },
    checks,
    status,
    rejectionReasons: Object.values(checks).flatMap((result) => result.issues)
  };
}
