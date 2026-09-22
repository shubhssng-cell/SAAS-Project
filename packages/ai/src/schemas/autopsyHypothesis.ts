import { z } from "zod";
import { errorCategorySchema } from "./shared.js";

/**
 * Task: "autopsy-hypothesis" (Phase 5B) — the HYPOTHESIS layer named since
 * Phase 1 (docs/AI_ARCHITECTURE.md §10), now actually implemented. The
 * model is given deterministic EVIDENCE already computed by
 * `@ipmat/autopsy` (Phase 5A) — behavior signals, historical/repeated
 * counts, and a candidate error match — and asked to propose ONE
 * hypothesis, phrased as a hypothesis, never a certainty.
 *
 * `modelConfidence` is the model's own confidence in THIS hypothesis, for
 * internal ranking only (Phase 5B §2) — it is never the student's
 * confidence in anything, and the prompt (`hypothesisPrompts.ts`)
 * explicitly tells the model so. There is no field anywhere in this
 * schema for the student's motivation, emotion, intelligence, anxiety, or
 * intent — those are not observable facts (docs/DECISIONS.md D-005, D-006).
 */
export const autopsyHypothesisAiSchema = z.object({
  proposedErrorCategory: errorCategorySchema.nullable(),
  /** Must be phrased AS a hypothesis (e.g. "may have...", "this pattern is consistent with...") — enforced by prompt instruction, not by this schema (schemas validate shape, not tone). */
  proposedExplanation: z.string().min(10),
  /** References to the evidence that supports this hypothesis — must cite what was actually supplied, never invented (enforced by prompt instruction; see hypothesisPrompts.ts). */
  supportingEvidence: z.array(z.string()).min(1),
  contradictoryEvidence: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  /** The MODEL's own confidence in this specific hypothesis (0-1), for ranking only. Null if the model has no basis to estimate one. NEVER the student's confidence — see the module doc comment. */
  modelConfidence: z.number().min(0).max(1).nullable()
});

export type AutopsyHypothesisAiOutput = z.infer<typeof autopsyHypothesisAiSchema>;
