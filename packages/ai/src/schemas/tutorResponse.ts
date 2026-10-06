import { z } from "zod";

/**
 * Task: "tutor-response" (Phase 8 Unit 1) - the one task through which the
 * AI Tutor's model produces text. Restated here (never imported from
 * `@ipmat/tutor` or any domain package; D-017): what a model is allowed to
 * return is a fixed trust-boundary contract.
 *
 * The model returns CONCLUSIONS, never a reasoning trace: there is no field
 * for chain-of-thought, and zod's default object behaviour STRIPS any extra
 * key (a model-supplied `reasoning`/`chainOfThought` is dropped here and can
 * never travel further). Every reference the model cites must exist in the
 * context it was given; that is verified deterministically by
 * `@ipmat/tutor`'s grounding validator, not trusted from this schema.
 */
export const tutorResponseTypeSchema = z.enum([
  "explanation",
  "hint",
  "guided_question",
  "mistake_explanation",
  "concept_explanation",
  "solution_clarification",
  "insufficient_context"
]);

export const tutorRelationTypeSchema = z.enum([
  "prerequisite",
  "foundational",
  "directly_related",
  "commonly_combined",
  "application",
  "dependent",
  "advanced_extension",
  "related_but_distinct"
]);

const part = z.string().trim().min(1).max(800);

/**
 * The explanation quality contract's named parts (Phase 8 Unit 2). Which parts
 * a teaching mode REQUIRES, or FORBIDS (a hint or a withheld-key explanation
 * must not carry worked steps), is decided by `@ipmat/tutor`'s policy - this
 * schema only fixes their shape. They are concise pedagogical content, never a
 * reasoning trace.
 */
export const tutorExplanationPartsSchema = z.object({
  asked: part.optional(),
  concept: part.optional(),
  steps: z.array(part).max(12).optional(),
  whyCorrect: part.optional(),
  whyIncorrectPathFails: part.optional(),
  takeaway: part.optional(),
  tryNext: part.optional()
});

/**
 * One Socratic step as a TEACHING ACTION: what is being checked, the question,
 * the concept and evidence it rests on, and what the student's reply would
 * reveal. It records what the tutor DOES, not why the model thought so.
 */
export const tutorSocraticStepSchema = z.object({
  checks: z.string().trim().min(1).max(300),
  question: z.string().trim().min(1).max(500),
  conceptRef: z.string().trim().min(1).max(200),
  evidenceRefs: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  learnsFromReply: z.string().trim().min(1).max(300)
});

export const tutorResponseAiSchema = z.object({
  responseType: tutorResponseTypeSchema,
  /** The conclusion/explanation shown to the student. Never a reasoning trace. */
  text: z.string().trim().min(1).max(4000),
  /** Reference ids (as listed in the supplied context) the text relies on. Anything not in the context is rejected downstream. */
  citations: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  /** Hedged proposals about the student's attempt - separate from `text`, each tied to attempt evidence. Only ever a hypothesis. */
  hypotheses: z
    .array(z.object({ text: z.string().trim().min(1).max(500), evidenceRefs: z.array(z.string().trim().min(1).max(200)).min(1).max(10) }))
    .max(3)
    .default([]),
  /** Every concept relationship the text asserts, so each can be checked against the supplied graph. */
  relationClaims: z
    .array(z.object({ from: z.string().trim().min(1).max(120), to: z.string().trim().min(1).max(120), type: tutorRelationTypeSchema }))
    .max(10)
    .default([]),
  /** Verbatim quotations from the question/the student's working, so they can be checked against the supplied context. */
  questionQuotes: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  /** Named explanation parts (explanation / full solution / mistake / concept modes). */
  parts: tutorExplanationPartsSchema.optional(),
  /** Required for the guided-question mode, forbidden elsewhere. */
  socraticStep: tutorSocraticStepSchema.optional(),
  /**
   * The same message in the student's chosen language (Phase 8 Unit 4). `text` stays the canonical, fully
   * validated English; this is a presentation of it, validated separately and never trusted to add facts.
   */
  localizedText: z.string().trim().min(1).max(4000).optional(),
  /** What the model could not ground, when it says so. */
  missingContext: z.array(z.string().trim().min(1).max(200)).max(10).default([])
});

export type TutorResponseAiOutput = z.infer<typeof tutorResponseAiSchema>;
