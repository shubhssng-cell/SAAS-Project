import { z } from "zod";

/**
 * Restated here rather than imported from @ipmat/examiner-lens /
 * @ipmat/question-engine — see the note in ../types.ts on why this
 * package has no domain-package dependency. Keep these in sync by hand
 * with the domain vocabularies they mirror; a mismatch would surface
 * immediately as a schema-validation failure on every AI call, not
 * silently.
 */

export const testingModeSchema = z.enum([
  "direct",
  "reverse",
  "transformed",
  "combined",
  "contextualized",
  "represented_differently",
  "constrained",
  "time_pressured",
  "multi_step",
  "novel_representation"
]);

export const errorCategorySchema = z.enum([
  "misconception",
  "trap",
  "calculation_mistake",
  "interpretation_mistake",
  "method_selection_mistake"
]);

export const difficultyTierSchema = z.enum(["standard", "advanced", "hard", "extreme", "novel"]);

export const difficultyDimensionsSchema = z.object({
  conceptualLoad: z.number().min(0).max(1),
  computationalLoad: z.number().min(0).max(1),
  trapDensity: z.number().min(0).max(1),
  representationNovelty: z.number().min(0).max(1),
  timePressure: z.number().min(0).max(1),
  multiStepDepth: z.number().min(0).max(1)
});

export const noveltyLevelSchema = z.enum(["standard", "novel_representation", "novel_combination", "novel_context"]);
export const examRelevanceSchema = z.enum(["core", "peripheral", "stretch"]);
