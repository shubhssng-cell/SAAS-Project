import { z } from "zod";
import { difficultyDimensionsSchema, errorCategorySchema, testingModeSchema } from "./shared.js";

/**
 * Task: "examiner-lens-analysis" (regeneration). The model is given a
 * concept plus its neighbors' names/descriptions WITHOUT being told the
 * real relationship types or rationale (see docs/QUESTION_ENGINE.md §2a)
 * — otherwise it would just be echoing the graph, not proposing anything.
 * `combinations` here is deliberately a lighter shape than the domain's
 * CombinationCandidate: the AI proposes a concept + its own rationale;
 * turning an accepted proposal into a governed ConceptRelation edge
 * (with certainty, requirementLevel, source) is a human/application
 * decision, never the AI's to make unilaterally.
 */
export const examinerLensAnalysisAiSchema = z.object({
  concept: z.string().min(1),
  whatIsTested: z.object({
    concept: z.string().min(1),
    subconcept: z.string().min(1),
    skill: z.string().min(5),
    prerequisite: z.string().nullable()
  }),
  testingModes: z.array(testingModeSchema).min(1),
  suggestedCombinations: z
    .array(
      z.object({
        concept: z.string().min(1),
        rationale: z.string().min(10)
      })
    )
    .default([]),
  errorModes: z
    .array(
      z.object({
        category: errorCategorySchema,
        description: z.string().min(10)
      })
    )
    .min(1),
  difficultyDimensions: difficultyDimensionsSchema
});

export type ExaminerLensAnalysisAiOutput = z.infer<typeof examinerLensAnalysisAiSchema>;
