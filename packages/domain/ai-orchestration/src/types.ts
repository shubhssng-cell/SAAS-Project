/**
 * AI intelligence orchestration (Phase 8 Unit 5, docs/DECISIONS.md D-096).
 *
 * A DETERMINISTIC router over capabilities that already exist. There is no model in the
 * orchestrator, no planner, no loop and no tool use: a task maps by a fixed table to a fixed,
 * code-defined workflow; each step invokes one registered capability with the minimum input it
 * needs; every step is verified, traced and kept independent. The existing systems stay
 * authoritative for their own decisions - the orchestrator never overrides, re-ranks or
 * "resolves" one of them.
 */

/** Every task a caller may name. Closed: there is no free-form task and no semantic routing. */
export const TASK_IDS = [
  "explain_question",
  "explain_concept",
  "give_hint",
  "guide_with_question",
  "explain_mistake",
  "clarify_solution",
  "get_help",
  "generate_question",
  "review_revision_and_curriculum",
  "review_exam_performance"
] as const;
export type TaskId = (typeof TASK_IDS)[number];

/** Every capability that exists. Registered capabilities only - nothing is registered because it sounds useful. */
export const CAPABILITY_IDS = ["tutor_response", "personalization", "question_generation", "adaptive_curriculum", "revision_intelligence", "simulation_intelligence", "exam_intelligence"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/**
 * WHO is asking, established by the caller's authentication BEFORE orchestration. A student actor is
 * additionally verified against the enrollment through the ownership port; a staff actor is trusted as
 * handed over (the same convention as `ContentPrincipal`: this package never constructs a role).
 * A model's text can never become an actor.
 */
export type Actor = { kind: "student"; studentId: string; enrollmentId: string } | { kind: "staff"; role: "content_admin" | "content_reviewer"; examCodes: readonly string[] };

export interface OrchestrationRequest {
  task: TaskId;
  actor: Actor;
  /** Task-specific parameters. STRICTLY validated per task: unknown keys (including any capability/workflow/actor field) are refused. */
  params?: Record<string, unknown>;
}

/** The authorized scope, derived by the orchestrator - never read from the request. */
export interface Scope {
  examCode: string;
  studentId: string | null;
  enrollmentId: string | null;
}

/** Distinct failure kinds: a failure is never flattened into "the AI couldn't answer". */
export const FAILURE_KINDS = [
  "invalid_request",
  "authorization_denied",
  "policy_refusal",
  "capability_unavailable",
  "not_available",
  "insufficient_context",
  "no_eligible_content",
  "provider_timeout",
  "provider_error",
  "malformed_output",
  "grounding_failure",
  "validation_failure",
  "handler_error"
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** Security and policy outcomes are final: they never trigger a fallback, whatever a workflow says (validated). */
export const NON_FALLBACKABLE: readonly FailureKind[] = ["authorization_denied", "policy_refusal", "invalid_request"];

export interface StructuredFailure {
  kind: FailureKind;
  /** Stable machine-readable code from the capability or the orchestrator. */
  code: string;
  /** A fixed, safe sentence. Never provider text, never a model string. */
  message: string;
}

export interface Validation {
  /** The validators that ran for this step (named, e.g. "tutor_grounding", "authoring_gates"). */
  ran: string[];
  status: "passed" | "failed" | "not_applicable";
}

export type CapabilityResult = { ok: true; output: unknown; validation: Validation } | { ok: false; failure: StructuredFailure; output?: unknown; validation?: Validation };

export interface CapabilityContext {
  requestId: string;
  scope: Scope;
}

/** A capability's implementation. Injected (never constructed here), so the orchestrator holds no model, key or database. */
export type CapabilityHandler = (input: Record<string, unknown>, context: CapabilityContext) => Promise<CapabilityResult>;

export type StepStatus = "succeeded" | "failed" | "skipped";

export interface StepRecord {
  stepId: string;
  capabilityId: CapabilityId;
  status: StepStatus;
  /** Why it was skipped (an explicit reason, never silent). */
  skippedBecause: "dependency_failed" | "stopped_after_failure" | "optional_capability_unavailable" | null;
  failure: StructuredFailure | null;
  validation: Validation | null;
  /** sha256 of the canonical minimum input given to the capability - a digest, never the input. */
  inputDigest: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** True when this step's capability ran as a declared fallback for another step. */
  isFallback: boolean;
}

export interface OrchestrationAudit {
  requestId: string;
  at: string;
  task: TaskId;
  workflowId: string | null;
  actorKind: "student" | "staff";
  studentId: string | null;
  examCode: string | null;
  status: OrchestrationStatus;
  steps: Array<Pick<StepRecord, "stepId" | "capabilityId" | "status" | "skippedBecause" | "inputDigest" | "isFallback"> & { failureKind: FailureKind | null; failureCode: string | null; validationStatus: Validation["status"] | null }>;
  fallbackOccurred: boolean;
  /** The rule that selected the workflow and the policy that decided the final status. Concise; never reasoning. */
  selectionRule: string;
  decidedBy: string;
}

export type OrchestrationStatus = "completed" | "partial" | "failed" | "refused";

export interface OrchestrationResult {
  requestId: string;
  task: TaskId;
  workflowId: string | null;
  status: OrchestrationStatus;
  /** Why this workflow: the fixed route table entry. */
  selection: { rule: string; reason: string };
  /** For multi-capability workflows: whether the order is defined by the workflow or deliberately unspecified. */
  ordering: "single_step" | "fixed_by_definition" | "unspecified";
  steps: StepRecord[];
  /** Each capability's output, preserved INDEPENDENTLY and unmodified, keyed by step id. Never merged, scored or re-ranked. */
  outputs: Record<string, unknown>;
  /** The orchestration-level failure (refusal / invalid request / no route), if no workflow ran. */
  failure: StructuredFailure | null;
  fallback: { occurred: boolean; from: string | null; to: string | null };
  /** Which policy produced the final status, in one phrase (e.g. "existing tutor grounding", "ownership check"). */
  decidedBy: string;
  notes: string[];
  audit: OrchestrationAudit;
}

export interface OrchestrationAuditSink {
  /** Metadata only: no prompt, response, params or output. */
  record(entry: OrchestrationAudit): void | Promise<void>;
}
