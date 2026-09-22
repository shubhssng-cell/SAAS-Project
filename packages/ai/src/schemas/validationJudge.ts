import { z } from "zod";

/**
 * Task: "validation-judge" — the AI-judge pass named in docs/AI_
 * ARCHITECTURE.md §3 since Phase 1, now actually implemented. Catches the
 * things deterministic checks structurally cannot: ambiguity and
 * contradictory conditions require reading and understanding the stem's
 * natural language, not just recomputing its arithmetic. `issues` must be
 * concrete and specific — this schema has no field that could express
 * "looks fine overall" without saying why.
 */
export const validationJudgeAiSchema = z.object({
  syllabusRelevant: z.boolean(),
  hasExactlyOneDefensibleAnswer: z.boolean(),
  isAmbiguous: z.boolean(),
  hasContradictoryConditions: z.boolean(),
  difficultyTierIsHonest: z.boolean(),
  issues: z.array(z.string()),
  verdict: z.enum(["pass", "fail"])
});

export type ValidationJudgeAiOutput = z.infer<typeof validationJudgeAiSchema>;
