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
import { computeLifecycleStatus, type QuestionLifecycleStatus } from "./lifecycle.js";
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  buildReverificationSystemPrompt
} from "./prompts.js";

export interface GenerationPipelineInput {
  blueprint: QuestionBlueprint;
  aiProvider: AiProvider;
  graph: ConceptGraph;
  existingQuestionStems: string[];
  provenanceSourceType: string | null;
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
  const blueprintExpectation = {
    id: input.blueprint.id,
    conceptName: input.blueprint.conceptName,
    patternFamilyName: input.blueprint.patternFamilyName
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
      options: { maxRetries: 2, timeoutMs: 30_000 }
    });
    candidate = result.data;
    generationMetadata = result.metadata;
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
  try {
    const result = await generateStructured(input.aiProvider, {
      task: "answer-reverification",
      promptVersion: "answer-reverification-v1",
      systemPrompt: buildReverificationSystemPrompt(),
      userPrompt: candidate.stem,
      schema: answerReverificationAiSchema,
      options: { maxRetries: 1, timeoutMs: 30_000 }
    });
    reverificationMetadata = result.metadata;
    reverification = compareReverification({ candidateAnswer: candidate.correctAnswer, reDerivedAnswer: result.data.derivedAnswer });
  } catch (error) {
    const aiError = error instanceof AiGenerationError ? error : null;
    reverificationMetadata = aiError?.metadata ?? null;
    reverification = fail("answer_mismatch", "reDerivedAnswer", `Independent re-derivation call failed: ${aiError?.message ?? "unknown error"}`);
  }

  const duplicateRisk = checkDuplicateRisk(candidate.stem, input.existingQuestionStems);

  let judge: ValidationResult;
  let judgeMetadata: AiResultMetadata | null;
  try {
    const result = await generateStructured(input.aiProvider, {
      task: "validation-judge",
      promptVersion: "validation-judge-v1",
      systemPrompt: buildJudgeSystemPrompt(),
      userPrompt: buildJudgeUserPrompt(candidate),
      schema: validationJudgeAiSchema,
      options: { maxRetries: 1, timeoutMs: 30_000 }
    });
    judgeMetadata = result.metadata;
    judge = interpretJudgeVerdict(result.data);
  } catch (error) {
    const aiError = error instanceof AiGenerationError ? error : null;
    judgeMetadata = aiError?.metadata ?? null;
    judge = fail("judge_ambiguous", "judge", `Validation-judge call failed: ${aiError?.message ?? "unknown error"}`);
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
