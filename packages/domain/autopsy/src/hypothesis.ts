import { autopsyHypothesisAiSchema, generateStructured, type AiCallOptions, type AiProvider } from "@ipmat/ai";
import { buildHypothesisSystemPrompt, buildHypothesisUserPrompt } from "./hypothesisPrompts.js";
import { HypothesisError, type AutopsyHypothesis, type AutopsyOutput, type ConfirmationResponse } from "./types.js";

export interface HypothesisGenerationInput {
  autopsyOutput: AutopsyOutput;
  /** The student's own stated reasoning for this attempt, when available — Phase 4A's `AttemptAutopsyEvidence` deliberately does not carry this (reserved for this phase, docs/DECISIONS.md D-011), so it is supplied here directly rather than by widening that already-committed contract. */
  reasoningText?: string | null;
}

/**
 * The HYPOTHESIS layer's real entry point (Phase 5B §1/§3). Goes through
 * `@ipmat/ai`'s `generateStructured()` — no direct provider SDK call, no
 * raw prompt string built anywhere else, no unvalidated JSON ever trusted
 * (docs/AI_ARCHITECTURE.md §1-3). The model's output is schema-validated
 * and otherwise UNTRUSTED; this function's own job is only to wrap it into
 * a domain `AutopsyHypothesis`, always starting at `confirmationStatus:
 * "awaiting_confirmation"` — there is no parameter through which a caller
 * could create one pre-confirmed.
 *
 * Fails closed BEFORE making any AI call if there is nothing to diagnose
 * (`candidateErrorEvidence` is null — the attempt was correct, skipped,
 * abandoned, or still in progress) — generating a hypothesis about a
 * non-error would be nonsensical and would spend a call for nothing.
 */
export async function generateHypothesis(
  provider: AiProvider,
  input: HypothesisGenerationInput,
  options?: AiCallOptions
): Promise<AutopsyHypothesis> {
  if (input.autopsyOutput.candidateErrorEvidence === null) {
    throw new HypothesisError(
      "no_evidence_to_diagnose",
      "Cannot generate a hypothesis: this attempt has no candidate error evidence (it was correct, skipped, abandoned, or still in_progress) — there is nothing to diagnose"
    );
  }

  const result = await generateStructured(provider, {
    task: "autopsy-hypothesis",
    promptVersion: "autopsy-hypothesis-v1",
    systemPrompt: buildHypothesisSystemPrompt(),
    userPrompt: buildHypothesisUserPrompt(input),
    schema: autopsyHypothesisAiSchema,
    options
  });

  return {
    attemptId: input.autopsyOutput.attemptFacts.attemptId,
    proposedErrorCategory: result.data.proposedErrorCategory,
    proposedExplanation: result.data.proposedExplanation,
    supportingEvidence: result.data.supportingEvidence,
    contradictoryEvidence: result.data.contradictoryEvidence,
    missingEvidence: result.data.missingEvidence,
    modelConfidence: result.data.modelConfidence,
    confirmationRequired: true,
    confirmationStatus: "awaiting_confirmation",
    studentCorrectionText: null,
    respondedAt: null,
    generationMetadata: result.metadata
  };
}

function assertExists(hypothesis: AutopsyHypothesis | null | undefined): asserts hypothesis is AutopsyHypothesis {
  if (!hypothesis) {
    throw new HypothesisError("hypothesis_not_found", "Cannot operate on a nonexistent hypothesis");
  }
}

/**
 * The single, shared confirmation-state transition (Phase 5B §4) — pure,
 * never mutates `hypothesis`. A hypothesis can reach `"confirmed"` ONLY
 * through this function being called with `{type: "confirmed"}`; nothing
 * else in this package can set that status (docs/DECISIONS.md D-006).
 * Fails closed with `already_decided` if the hypothesis is not still
 * `awaiting_confirmation` — a response can be applied exactly once.
 */
export function applyConfirmationResponse(
  hypothesis: AutopsyHypothesis | null | undefined,
  response: ConfirmationResponse,
  input: { now: string }
): AutopsyHypothesis {
  assertExists(hypothesis);
  if (hypothesis.confirmationStatus !== "awaiting_confirmation") {
    throw new HypothesisError(
      "already_decided",
      `Cannot apply a confirmation response: hypothesis is already "${hypothesis.confirmationStatus}"`
    );
  }

  switch (response.type) {
    case "confirmed":
      return { ...hypothesis, confirmationStatus: "confirmed", respondedAt: input.now, studentCorrectionText: null };
    case "rejected":
      return { ...hypothesis, confirmationStatus: "rejected", respondedAt: input.now, studentCorrectionText: null };
    case "corrected": {
      if (response.correctedExplanation.trim().length === 0) {
        throw new HypothesisError("malformed_correction", "correctedExplanation must be a non-empty string");
      }
      // Preserved as NEW evidence alongside the original — proposedExplanation is never overwritten (Phase 5B §4).
      return {
        ...hypothesis,
        confirmationStatus: "corrected",
        respondedAt: input.now,
        studentCorrectionText: response.correctedExplanation
      };
    }
  }
}

/** Convenience wrapper — equivalent to `applyConfirmationResponse(hypothesis, {type: "confirmed"}, input)`. */
export function confirmHypothesis(hypothesis: AutopsyHypothesis | null | undefined, input: { now: string }): AutopsyHypothesis {
  return applyConfirmationResponse(hypothesis, { type: "confirmed" }, input);
}

/** Convenience wrapper — equivalent to `applyConfirmationResponse(hypothesis, {type: "rejected"}, input)`. */
export function rejectHypothesis(hypothesis: AutopsyHypothesis | null | undefined, input: { now: string }): AutopsyHypothesis {
  return applyConfirmationResponse(hypothesis, { type: "rejected" }, input);
}

/** Convenience wrapper — equivalent to `applyConfirmationResponse(hypothesis, {type: "corrected", correctedExplanation}, input)`. */
export function correctHypothesis(
  hypothesis: AutopsyHypothesis | null | undefined,
  correctedExplanation: string,
  input: { now: string }
): AutopsyHypothesis {
  return applyConfirmationResponse(hypothesis, { type: "corrected", correctedExplanation }, input);
}
