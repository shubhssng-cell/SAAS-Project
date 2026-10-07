import { toPublicOrchestrationView, type FailureKind, type OrchestrationResult, type Orchestrator, type TaskId } from "@ipmat/ai-orchestration";
import { TUTOR_CONTEXT_LIMITS, type StudentTutorView } from "@ipmat/tutor";
import { AssistantApiError, invalidRequest, isRecord, notAvailable, requireOnlyKeys, type StudentClaim } from "./errors.js";

/**
 * The student tutor operation (Phase 9 Unit 2, D-098). The browser asks for ONE named help operation; this service maps it to a
 * fixed Phase 8 task and runs the existing deterministic orchestrator. Everything that decides what runs or who it runs for is
 * server-side and fixed here:
 *   - the actor is the authenticated student + their current enrollment (the `StudentClaim`), never a request field;
 *   - the task comes from a closed table below, never from the request text or a model;
 *   - `presentation` (language/verbosity) is NOT accepted from the client: it is resolved by the personalization capability from the
 *     student's stored explicit preferences, so a request cannot alter how disclosure or style is chosen;
 *   - the answer is projected through the existing `toStudentTutorView` (via `toPublicOrchestrationView`) and then a smaller DTO:
 *     no steps, capability names, audit, grounding report, violation codes, ids or provider payload.
 */
export const TUTOR_OPERATIONS = ["explain_question", "explain_concept", "give_hint", "guide_with_question", "explain_mistake", "clarify_solution", "help"] as const;
export type TutorOperation = (typeof TUTOR_OPERATIONS)[number];

const TASK_FOR_OPERATION: Readonly<Record<TutorOperation, TaskId>> = Object.freeze({
  explain_question: "explain_question",
  explain_concept: "explain_concept",
  give_hint: "give_hint",
  guide_with_question: "guide_with_question",
  explain_mistake: "explain_mistake",
  clarify_solution: "clarify_solution",
  help: "get_help"
});

const REQUEST_KEYS = ["operation", "questionId", "conceptName", "focus", "priorInteraction"] as const;

/** Student-safe, fixed wording per failure kind. The domain's own `code` and message never reach the client. */
const SAFE_FAILURE: Readonly<Record<FailureKind, { code: string; message: string }>> = Object.freeze({
  invalid_request: { code: "invalid_request", message: "That request could not be understood." },
  authorization_denied: { code: "not_permitted", message: "You can't use the tutor for that." },
  policy_refusal: { code: "not_permitted", message: "The tutor can't help with that request." },
  capability_unavailable: { code: "not_available", message: "The tutor isn't available right now." },
  not_available: { code: "not_available", message: "That question or topic isn't available." },
  insufficient_context: { code: "needs_more_information", message: "The tutor doesn't have enough to answer this yet." },
  no_eligible_content: { code: "not_available", message: "Nothing is available for that request." },
  provider_timeout: { code: "temporarily_unavailable", message: "The tutor took too long. Please try again." },
  provider_error: { code: "temporarily_unavailable", message: "The tutor is temporarily unavailable. Please try again." },
  malformed_output: { code: "temporarily_unavailable", message: "The tutor couldn't produce a usable answer. Please try again." },
  grounding_failure: { code: "could_not_verify", message: "The tutor couldn't produce an answer it could verify. Please try again or rephrase." },
  validation_failure: { code: "could_not_verify", message: "The tutor couldn't produce an answer it could verify." },
  handler_error: { code: "temporarily_unavailable", message: "Something went wrong. Please try again." }
});

export interface TutorAnswerDto {
  /** `answered` only when the existing validation passed; otherwise the tutor's own fixed message is in `tutor.message`. */
  status: "answered" | "not_answered";
  tutor: StudentTutorView | null;
  /** Plain sentences describing which of the student's OWN preferences changed the presentation. */
  preferenceNotes: string[];
  failure: { code: string; message: string } | null;
}

export interface TutorApiDependencies {
  orchestrator: Orchestrator;
  /** False when no model provider is configured: the tutor then answers `not_available` instead of pretending. */
  tutorAvailable: boolean;
}

function parsePriorInteraction(value: unknown): Array<{ mode: string; text: string; studentReply?: string }> {
  if (!Array.isArray(value) || value.length > TUTOR_CONTEXT_LIMITS.MAX_PRIOR_ACTIONS) throw invalidRequest("priorInteraction must be a short list.");
  return value.map((item) => {
    if (!isRecord(item)) throw invalidRequest("priorInteraction entries must be objects.");
    requireOnlyKeys(item, ["mode", "text", "studentReply"]);
    if (typeof item.mode !== "string" || typeof item.text !== "string" || item.text.length > TUTOR_CONTEXT_LIMITS.MAX_PRIOR_TEXT_CHARS) throw invalidRequest("priorInteraction entries are malformed.");
    if (item.studentReply !== undefined && (typeof item.studentReply !== "string" || item.studentReply.length > TUTOR_CONTEXT_LIMITS.MAX_PRIOR_REPLY_CHARS)) throw invalidRequest("priorInteraction entries are malformed.");
    return { mode: item.mode, text: item.text, ...(item.studentReply !== undefined ? { studentReply: item.studentReply } : {}) };
  });
}

export class TutorApiService {
  constructor(private readonly deps: TutorApiDependencies) {}

  /** Validates the body strictly (unknown keys - studentId, enrollmentId, examCode, capability, workflow, actor, role, presentation... - are refused), runs the approved task, returns the student-safe DTO. */
  async ask(claim: StudentClaim, body: unknown): Promise<TutorAnswerDto> {
    if (!isRecord(body)) throw invalidRequest("The request body must be a JSON object.");
    requireOnlyKeys(body, REQUEST_KEYS);
    const operation = body.operation;
    if (typeof operation !== "string" || !(TUTOR_OPERATIONS as readonly string[]).includes(operation)) throw invalidRequest("Choose one of the supported tutor operations.");
    const params: Record<string, unknown> = {};
    for (const key of ["questionId", "conceptName", "focus"] as const) {
      const v = body[key];
      if (v === undefined) continue;
      const max = key === "focus" ? TUTOR_CONTEXT_LIMITS.MAX_FOCUS_CHARS : TUTOR_CONTEXT_LIMITS.MAX_ID_CHARS;
      if (typeof v !== "string" || v.trim() === "" || v.length > max) throw invalidRequest(`${key} is malformed.`);
      params[key] = v;
    }
    if (body.priorInteraction !== undefined) params.priorInteraction = parsePriorInteraction(body.priorInteraction);
    if (operation === "explain_concept") {
      if (params.conceptName === undefined) throw invalidRequest("conceptName is required for this operation.");
      if (params.questionId !== undefined) throw invalidRequest("questionId is not used by this operation.");
    } else if (params.questionId === undefined) {
      throw invalidRequest("questionId is required for this operation.");
    } else if (params.conceptName !== undefined) {
      throw invalidRequest("conceptName is not used by this operation.");
    }
    if (!this.deps.tutorAvailable) throw notAvailable("The tutor isn't available right now.");

    const actor = { kind: "student" as const, studentId: claim.studentId, enrollmentId: claim.enrollmentId };
    let result: OrchestrationResult;
    try {
      result = await this.deps.orchestrator.run({ task: TASK_FOR_OPERATION[operation as TutorOperation], actor, params });
    } catch {
      throw new AssistantApiError("infrastructure_failure", "Something went wrong. Please try again.", 500);
    }
    return this.project(result, actor);
  }

  private project(result: OrchestrationResult, actor: { kind: "student"; studentId: string; enrollmentId: string }): TutorAnswerDto {
    const view = toPublicOrchestrationView(result, actor);
    if (view.status === "completed" && view.tutor !== null && view.tutor.outcome === "answered") {
      return { status: "answered", tutor: view.tutor, preferenceNotes: view.personalization ?? [], failure: null };
    }
    const kind: FailureKind = view.failure?.kind ?? view.steps.find((s) => s.failure)?.failure?.kind ?? "handler_error";
    // Request and authorization problems are HTTP errors; everything else is a normal "not answered" result carrying the tutor's own fixed message.
    if (kind === "invalid_request") throw new AssistantApiError("invalid_request", SAFE_FAILURE.invalid_request.message, 400);
    if (kind === "authorization_denied") throw new AssistantApiError("forbidden", SAFE_FAILURE.authorization_denied.message, 403);
    if (kind === "capability_unavailable") throw notAvailable(SAFE_FAILURE.capability_unavailable.message);
    return { status: "not_answered", tutor: view.tutor && view.tutor.outcome !== "answered" ? view.tutor : null, preferenceNotes: [], failure: { ...SAFE_FAILURE[kind] } };
  }
}
