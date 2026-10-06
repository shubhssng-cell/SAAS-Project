import { loadPreferencesForRequest, personalizeTutorRequest, resolveHelpIntent, type PreferenceStore } from "@ipmat/personalization";
import type { QuestionGenerationService } from "@ipmat/question-generation";
import { type TutorOwnershipPort, type TutorRequest, type TutorResponse, type TutorService } from "@ipmat/tutor";
import { classifyThrown } from "./orchestrator.js";
import type { CapabilityHandler, CapabilityResult, FailureKind, StructuredFailure } from "./types.js";

/**
 * Adapters turn EXISTING services into capability handlers. They add no policy: each maps the service's own
 * outcome onto a distinct failure kind (so "the tutor could not ground its answer" is never reported as "the
 * provider timed out"), keeps the service's own result as the output, and names the validation that already
 * ran inside it. None of them calls a model itself or reads a key.
 */
const fail = (kind: FailureKind, code: string, message: string): StructuredFailure => ({ kind, code, message });

/** The existing tutor service. Its own answer-key, ownership and grounding rules are untouched: this only classifies the outcome. */
export function tutorCapability(service: TutorService): CapabilityHandler {
  return async (input) => {
    let response: TutorResponse;
    try {
      response = await service.answer(input.request as TutorRequest);
    } catch (error) {
      return { ok: false, failure: classifyThrown(error) };
    }
    const validation = { ran: ["tutor_grounding"], status: response.outcome === "answered" ? ("passed" as const) : ("failed" as const) };
    switch (response.outcome) {
      case "answered":
        return { ok: true, output: response, validation };
      case "insufficient_context":
        return { ok: false, output: response, validation: { ran: ["tutor_context_requirements"], status: "not_applicable" }, failure: fail("insufficient_context", response.uncertainty.missing[0] ?? "insufficient_context", "there is not enough verified context to answer") };
      case "rejected_ungrounded":
        return { ok: false, output: response, validation, failure: fail("grounding_failure", response.grounding.violations[0]?.code ?? "ungrounded", "the answer could not be verified against the available context") };
      case "provider_failure": {
        const kind = response.audit.failure;
        return { ok: false, output: response, validation: { ran: [], status: "not_applicable" }, failure: kind === "timeout" ? fail("provider_timeout", "timeout", "the model provider timed out") : kind === "malformed_output" ? fail("malformed_output", "malformed_output", "the model returned an unusable response") : fail("provider_error", "provider_error", "the model provider failed") };
      }
    }
  };
}

/**
 * The existing Unit 4 personalization, as a deterministic, model-free capability. It resolves the student's EXPLICIT
 * preferences into a tutor presentation and, for a help request, the intent. It reads no evidence and writes nothing.
 */
export function personalizationCapability(deps: { ownership: TutorOwnershipPort; store: PreferenceStore }): CapabilityHandler {
  return async (input) => {
    const request = input.request as TutorRequest & { intent?: TutorRequest["intent"] };
    try {
      const { preferences } = await loadPreferencesForRequest(deps, request);
      const decisions = [];
      let intent = request.intent;
      if (input.resolveIntent === true) {
        // `hasSubmittedAttempt` is unknown here, so the conservative label (limited by the answer-key policy) is used; the tutor's own policy decides disclosure either way.
        const resolved = resolveHelpIntent({ preferences, hasSubmittedAttempt: false });
        decisions.push(resolved.decision);
        if (resolved.intent === null) return { ok: false, failure: fail("insufficient_context", "intent_required", "no help preference is set and no intent was named; the caller must choose") };
        intent = resolved.intent;
      }
      const personalized = personalizeTutorRequest({ ...request, intent } as TutorRequest, preferences);
      return { ok: true, output: { request: personalized.request, decisions: [...decisions, ...personalized.decisions] }, validation: { ran: ["preference_validation"], status: "passed" } };
    } catch (error) {
      return { ok: false, failure: classifyThrown(error) };
    }
  };
}

/** The existing question-generation service. It stores candidates only (never publishes); each of its outcomes maps to its own failure kind. */
export function generationCapability(service: QuestionGenerationService): CapabilityHandler {
  return async (input) => {
    let outcome;
    try {
      outcome = await service.generateOne(input.spec as Parameters<QuestionGenerationService["generateOne"]>[0]);
    } catch (error) {
      return { ok: false, failure: classifyThrown(error) };
    }
    const validation = { ran: ["generation_pipeline_checks", "authoring_gates"], status: outcome.kind === "ai_validated_awaiting_review" ? ("passed" as const) : ("failed" as const) };
    switch (outcome.kind) {
      case "ai_validated_awaiting_review":
        return { ok: true, output: outcome, validation };
      case "spec_invalid":
        return { ok: false, output: outcome, validation: { ran: ["spec_validation"], status: "failed" }, failure: fail("invalid_request", "spec_invalid", "the generation spec failed validation") };
      case "generation_failed": {
        const code = outcome.reasons[0]?.code ?? "generation_failed";
        return { ok: false, output: outcome, validation: { ran: [], status: "not_applicable" }, failure: fail(code === "unverifiable_cost" ? "policy_refusal" : /timed? ?out/i.test(JSON.stringify(outcome.reasons)) ? "provider_timeout" : "malformed_output", code, "no candidate was produced") };
      }
      case "exact_duplicate":
        return { ok: false, output: outcome, validation, failure: fail("no_eligible_content", "exact_duplicate", "an identical question already exists in this exam") };
      case "skipped_budget":
      case "duplicate_spec_in_batch":
        return { ok: false, output: outcome, validation, failure: fail("policy_refusal", outcome.kind, "the generation limits refused this spec") };
      default:
        return { ok: false, output: outcome, validation, failure: fail("validation_failure", outcome.kind, "the candidate did not pass the authoring checks") };
    }
  };
}

/**
 * Wraps an existing read-only composer (adaptive curriculum, revision intelligence, simulation intelligence, exam
 * intelligence). The composer is injected - in a deployment it is the existing `@ipmat/training-recommendation` function
 * bound to its database dependencies - so this package holds no database and recomputes nothing. A `null` result is
 * reported as `not_available`, never turned into an empty success.
 */
export function readerCapability(read: (input: Record<string, unknown>) => Promise<unknown | null>): CapabilityHandler {
  return async (input): Promise<CapabilityResult> => {
    try {
      const value = await read(input);
      if (value === null || value === undefined) return { ok: false, failure: fail("not_available", "no_result", "no result is available for this student and exam") };
      return { ok: true, output: value, validation: { ran: [], status: "not_applicable" } };
    } catch (error) {
      return { ok: false, failure: classifyThrown(error) };
    }
  };
}

