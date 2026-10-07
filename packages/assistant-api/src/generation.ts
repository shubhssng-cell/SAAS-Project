import { toPublicOrchestrationView, type Actor, type Orchestrator } from "@ipmat/ai-orchestration";
import { AssistantApiError, invalidRequest, isRecord, requireOnlyKeys } from "./errors.js";

/**
 * Staff question generation (Phase 9 Unit 2, D-098). NO HTTP route exists for it: the repository has no staff identity or role
 * model (authentication is student sessions only), and inventing one is not this unit's call. This service is the application
 * boundary a future staff-authenticated route would call: it accepts only a `StaffClaim` that TRUSTED code constructed after its
 * own authentication, and refuses anything else. It runs the fixed `generate_question` task through the orchestrator - which
 * re-authorizes the actor and the spec's exam and calls the existing generation service - and returns codes about the
 * candidate, never its content. It has no publish operation and must never gain one: a candidate lands as an `ai_generated`
 * DRAFT and publication is the authoring lifecycle's explicit human step.
 */
export interface StaffClaim {
  kind: "staff";
  role: "content_admin" | "content_reviewer";
  examCodes: readonly string[];
}

export interface GenerationResultDto {
  outcome: string;
  reasonCodes: string[];
  reviewRequired: boolean;
  /** Always false here: nothing this service does publishes. */
  published: false;
}

export class ContentGenerationApiService {
  constructor(private readonly orchestrator: Orchestrator) {}

  async generate(claim: StaffClaim, body: unknown): Promise<GenerationResultDto> {
    if (!isRecord(claim) || claim.kind !== "staff" || (claim.role !== "content_admin" && claim.role !== "content_reviewer") || !Array.isArray(claim.examCodes)) {
      throw new AssistantApiError("forbidden", "Content generation is for authorized staff only.", 403);
    }
    if (!isRecord(body)) throw invalidRequest("The request body must be a JSON object.");
    requireOnlyKeys(body, ["spec"]);
    if (!isRecord(body.spec)) throw invalidRequest("A generation spec is required.");
    const actor: Actor = { kind: "staff", role: claim.role, examCodes: [...claim.examCodes] };
    let result;
    try {
      result = await this.orchestrator.run({ task: "generate_question", actor, params: { spec: body.spec } });
    } catch {
      throw new AssistantApiError("infrastructure_failure", "Something went wrong.", 500);
    }
    const view = toPublicOrchestrationView(result, actor);
    if (view.failure?.kind === "authorization_denied") throw new AssistantApiError("forbidden", "Content generation is for authorized staff only.", 403);
    if (view.failure?.kind === "invalid_request") throw invalidRequest("The generation spec was not accepted.");
    if (view.generation === null) throw new AssistantApiError("not_available", "Generation isn't available.", 503);
    return { outcome: view.generation.outcome, reasonCodes: view.generation.reasonCodes, reviewRequired: view.generation.reviewRequired, published: false };
  }
}
