import { z } from "zod";
import {
  difficultyDimensionsSchema,
  difficultyTierSchema,
  examRelevanceSchema,
  noveltyLevelSchema,
  testingModeSchema
} from "./shared.js";

/**
 * Task: "question-generation". The model must echo back `blueprintId` so
 * the pipeline can detect (and reject) any attempt to silently answer a
 * different blueprint than the one it was given (docs/QUESTION_ENGINE.md
 * §5). `groundTruthDerivation.computation` must be a plain arithmetic
 * expression string (numbers and + - * / ^ ( ) only) that an independent,
 * non-LLM evaluator can recompute — see @ipmat/validation's
 * verifyComputation(). The model's stated `correctAnswer` is NEVER trusted
 * on its own; it exists so a mismatch against the independently recomputed
 * value is itself a rejection signal.
 */
export const questionCandidateAiSchema = z.object({
  blueprintId: z.string().min(1),
  stem: z.string().min(20),
  answerFormat: z.enum(["multiple_choice", "numeric_entry"]),
  options: z.array(z.string().min(1)).nullable(),
  correctAnswer: z.string().min(1),
  explanation: z.string().min(20),
  solutionSteps: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(10),
  groundTruthDerivation: z.object({
    computation: z.string().min(1),
    expectedAnswer: z.number()
  }),
  questionDna: z.object({
    conceptName: z.string().min(1),
    subconcepts: z.array(z.string()),
    prerequisites: z.array(z.string()),
    combinesWithConcepts: z.array(z.string()),
    patternFamilyName: z.string().min(1),
    skill: z.string().min(5),
    difficultyTier: difficultyTierSchema,
    difficultyDimensions: difficultyDimensionsSchema,
    noveltyLevel: noveltyLevelSchema,
    examRelevance: examRelevanceSchema,
    expectedTimeSeconds: z.number().int().positive(),
    testingModes: z.array(testingModeSchema).min(1),
    trapErrorTaxonomyCode: z.string().nullable()
  })
});

export type QuestionCandidateAiOutput = z.infer<typeof questionCandidateAiSchema>;
