import type { TutorOwnershipPort } from "@ipmat/tutor";
import { InputError, RequestError, buildCapabilityInput, digestInput, validateParams, type PriorStep } from "./context.js";
import { CAPABILITY_REGISTRY, type CapabilityDescriptor } from "./registry.js";
import { NON_FALLBACKABLE, TASK_IDS, type Actor, type CapabilityHandler, type CapabilityId, type CapabilityResult, type FailureKind, type OrchestrationAudit, type OrchestrationAuditSink, type OrchestrationRequest, type OrchestrationResult, type OrchestrationStatus, type Scope, type StepRecord, type StructuredFailure, type TaskId } from "./types.js";
import { SHIPPED_WORKFLOWS, validateWorkflowDefinition, type WorkflowDefinition, type WorkflowStep } from "./workflows.js";

export interface OrchestratorDeps {
  /** The tutor's own ownership port: a student's enrollment is verified BEFORE any capability runs. */
  ownership: TutorOwnershipPort;
  /** The implementations of the capabilities that exist in this deployment. A missing one is an explicit `capability_unavailable`, never a substitution. */
  handlers: Partial<Record<CapabilityId, CapabilityHandler>>;
  /**
   * Code-level workflow overrides (a deployment decision, validated at construction - an invalid definition makes
   * construction FAIL). Never settable from a request, a model output or a capability result.
   */
  workflows?: readonly WorkflowDefinition[];
  audit?: OrchestrationAuditSink;
  now?: () => Date;
  newRequestId?: () => string;
}

const fail = (kind: FailureKind, code: string, message: string): StructuredFailure => ({ kind, code, message });

/** Which existing policy ends a failed workflow - named, so "who decided" is never "the AI". */
const DECIDED_BY: Record<FailureKind, string> = {
  invalid_request: "request validation",
  authorization_denied: "authorization (ownership / actor / exam scope)",
  policy_refusal: "system policy",
  capability_unavailable: "capability registry (no implementation available)",
  not_available: "the capability's own availability rule",
  insufficient_context: "the capability's own context requirements",
  no_eligible_content: "the capability's own eligibility rules",
  provider_timeout: "provider isolation (timeout)",
  provider_error: "provider isolation (provider error)",
  malformed_output: "output schema validation",
  grounding_failure: "existing tutor grounding validation",
  validation_failure: "existing authoring validation",
  handler_error: "capability error isolation"
};

/** Authorization for ONE capability, re-checked per step (defence in depth on top of the workflow-level check). */
export function authorizeCapability(actor: Actor, capability: CapabilityDescriptor, scope: Scope): StructuredFailure | null {
  if (!capability.actors.includes(actor.kind)) return fail("authorization_denied", "actor_not_permitted", "this actor may not use this capability");
  if (actor.kind === "staff") {
    if (!capability.staffRoles.includes(actor.role)) return fail("authorization_denied", "role_not_permitted", "this role may not use this capability");
    if (!actor.examCodes.includes(scope.examCode)) return fail("authorization_denied", "exam_not_permitted", "this exam is outside the actor's scope");
  } else if (capability.studentScope === "own" && (scope.studentId === null || scope.studentId !== actor.studentId || scope.enrollmentId !== actor.enrollmentId)) {
    return fail("authorization_denied", "student_scope_mismatch", "the scope does not belong to this student");
  }
  return null;
}

/**
 * The orchestrator. Deterministic and model-free: it routes a task by the fixed route table, authorizes
 * before anything runs, hands each capability only its minimum input, keeps every output independent and
 * unmodified, records a metadata-only trace, and never lets a failure silently become another capability.
 * It has no loop, no planning step, no tool selection and no memory.
 */
export function createOrchestrator(deps: OrchestratorDeps) {
  const now = deps.now ?? (() => new Date());
  let counter = 0;
  const newRequestId = deps.newRequestId ?? (() => `orch-${now().getTime().toString(36)}-${(counter++).toString(36)}`);

  // ---- construction: validate every workflow, fail closed -----------------
  const byTask = new Map<TaskId, WorkflowDefinition>();
  for (const w of SHIPPED_WORKFLOWS) byTask.set(w.task, w);
  for (const w of deps.workflows ?? []) {
    const issues = validateWorkflowDefinition(w);
    if (issues.length > 0) throw new Error(`invalid workflow "${w.id}": ${issues.map((i) => i.code).join(", ")}`);
    byTask.set(w.task, w);
  }
  for (const w of SHIPPED_WORKFLOWS) {
    const issues = validateWorkflowDefinition(w);
    if (issues.length > 0) throw new Error(`invalid shipped workflow "${w.id}": ${issues.map((i) => i.code).join(", ")}`);
  }

  function refuse(requestId: string, task: TaskId | null, actor: Actor | null, failure: StructuredFailure, workflow: WorkflowDefinition | null, scope: Scope | null): OrchestrationResult {
    const at = now().toISOString();
    const audit: OrchestrationAudit = {
      requestId,
      at,
      task: (task ?? "explain_question") as TaskId,
      workflowId: workflow?.id ?? null,
      actorKind: actor?.kind === "staff" ? "staff" : "student",
      studentId: scope?.studentId ?? (actor?.kind === "student" ? actor.studentId : null),
      examCode: scope?.examCode ?? null,
      status: "refused",
      steps: [],
      fallbackOccurred: false,
      selectionRule: workflow ? `ROUTE:${workflow.id}` : "no route",
      decidedBy: DECIDED_BY[failure.kind]
    };
    return {
      requestId,
      task: (task ?? "explain_question") as TaskId,
      workflowId: workflow?.id ?? null,
      status: "refused",
      selection: { rule: audit.selectionRule, reason: workflow ? workflow.routeReason : "the request did not reach routing" },
      ordering: workflow?.ordering ?? "single_step",
      steps: [],
      outputs: {},
      failure,
      fallback: { occurred: false, from: null, to: null },
      decidedBy: DECIDED_BY[failure.kind],
      notes: [],
      audit
    };
  }

  async function emit(result: OrchestrationResult): Promise<OrchestrationResult> {
    try {
      await deps.audit?.record(result.audit);
    } catch {
      // An audit sink failure never changes what the caller receives.
    }
    return result;
  }

  async function invoke(capability: CapabilityId, input: Record<string, unknown>, requestId: string, scope: Scope): Promise<CapabilityResult> {
    const handler = deps.handlers[capability];
    if (!handler) return { ok: false, failure: fail("capability_unavailable", "no_handler", "this capability is not available in this deployment") };
    try {
      const out = await handler(input, { requestId, scope });
      if (!out || typeof out !== "object" || typeof (out as { ok?: unknown }).ok !== "boolean") return { ok: false, failure: fail("malformed_output", "bad_capability_result", "the capability returned a result in an unexpected shape") };
      return out;
    } catch (error) {
      return { ok: false, failure: classifyThrown(error) };
    }
  }

  async function run(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const requestId = newRequestId();
    const task = request?.task;
    if (typeof task !== "string" || !(TASK_IDS as readonly string[]).includes(task)) return emit(refuse(requestId, null, null, fail("invalid_request", "unknown_task", "unknown task"), null, null));
    const actor = request.actor;
    const workflow = byTask.get(task);
    if (!workflow) return emit(refuse(requestId, task, null, fail("invalid_request", "no_route", "no workflow is defined for this task"), null, null));
    if (!actor || (actor.kind !== "student" && actor.kind !== "staff")) return emit(refuse(requestId, task, null, fail("authorization_denied", "no_actor", "an authenticated actor is required"), workflow, null));

    let params: Record<string, unknown>;
    try {
      params = validateParams(task, request.params);
    } catch (error) {
      const code = error instanceof RequestError ? error.code : "invalid_param";
      return emit(refuse(requestId, task, actor, fail("invalid_request", code, error instanceof RequestError ? error.message : "invalid parameters"), workflow, null));
    }

    // ---- authorization BEFORE any capability runs -------------------------
    // First the scope-independent part: may this KIND of actor (and role) use every capability the workflow names? A
    // staff member asking for a tutor answer, or a student asking for generation, is refused here, before any scope is derived.
    for (const step of workflow.steps) {
      const d = CAPABILITY_REGISTRY[step.capability];
      if (!d.actors.includes(actor.kind)) return emit(refuse(requestId, task, actor, fail("authorization_denied", "actor_not_permitted", "this actor may not use this capability"), workflow, null));
      if (actor.kind === "staff" && !d.staffRoles.includes(actor.role)) return emit(refuse(requestId, task, actor, fail("authorization_denied", "role_not_permitted", "this role may not use this capability"), workflow, null));
    }
    let scope: Scope;
    if (actor.kind === "student") {
      if (typeof actor.studentId !== "string" || typeof actor.enrollmentId !== "string" || !actor.studentId || !actor.enrollmentId) return emit(refuse(requestId, task, actor, fail("authorization_denied", "bad_student_actor", "a student and an enrollment are required"), workflow, null));
      const enrollment = await deps.ownership.resolveEnrollment(actor.studentId, actor.enrollmentId);
      // One answer for "missing" and "someone else's": no enumeration. The exam is the ENROLLMENT's, never the request's.
      if (!enrollment || enrollment.studentId !== actor.studentId || enrollment.enrollmentId !== actor.enrollmentId || !enrollment.examCode) {
        return emit(refuse(requestId, task, actor, fail("authorization_denied", "enrollment_not_available", "this enrollment is not available to this student"), workflow, null));
      }
      scope = { examCode: enrollment.examCode, studentId: enrollment.studentId, enrollmentId: enrollment.enrollmentId };
    } else {
      const spec = params.spec as { blueprint?: { examCode?: unknown } } | undefined;
      const examCode = spec?.blueprint?.examCode;
      if (typeof examCode !== "string") return emit(refuse(requestId, task, actor, fail("invalid_request", "missing_exam", "the spec must name its exam"), workflow, null));
      scope = { examCode, studentId: null, enrollmentId: null };
    }
    for (const step of workflow.steps) {
      const denied = authorizeCapability(actor, CAPABILITY_REGISTRY[step.capability], scope);
      if (denied) return emit(refuse(requestId, task, actor, denied, workflow, scope));
    }

    // ---- run the workflow, step by step, exactly as defined ----------------
    const steps: StepRecord[] = [];
    const outputs: Record<string, unknown> = {};
    const prior = new Map<string, PriorStep>();
    const satisfied = new Set<string>();
    let stopped = false;
    let fallbackInfo: OrchestrationResult["fallback"] = { occurred: false, from: null, to: null };
    const notes: string[] = [];
    let lastFailure: StructuredFailure | null = null;

    const record = (step: WorkflowStep, capability: CapabilityId, partial: Partial<StepRecord> & Pick<StepRecord, "status">, isFallback: boolean, stepId = step.id): StepRecord => {
      const r: StepRecord = { stepId, capabilityId: capability, skippedBecause: null, failure: null, validation: null, inputDigest: null, startedAt: null, endedAt: null, isFallback, ...partial };
      steps.push(r);
      return r;
    };

    async function execute(step: WorkflowStep, capability: CapabilityId, isFallback: boolean): Promise<{ ok: boolean; failure: StructuredFailure | null }> {
      const stepId = isFallback ? `${step.id}.fallback` : step.id;
      const descriptor = CAPABILITY_REGISTRY[capability];
      const denied = authorizeCapability(actor, descriptor, scope);
      if (denied) {
        record(step, capability, { status: "failed", failure: denied }, isFallback, stepId);
        return { ok: false, failure: denied };
      }
      let input: Record<string, unknown>;
      try {
        input = buildCapabilityInput(capability, { task, params, scope, actor, prior });
      } catch (error) {
        const failure = error instanceof InputError ? fail("insufficient_context", "missing_input", error.message) : fail("handler_error", "input_build", "the capability input could not be built");
        record(step, capability, { status: "failed", failure }, isFallback, stepId);
        return { ok: false, failure };
      }
      const startedAt = now().toISOString();
      const result = await invoke(capability, input, requestId, scope);
      const endedAt = now().toISOString();
      const digest = digestInput(input);
      if (result.ok) {
        outputs[stepId] = result.output;
        prior.set(stepId, { status: "succeeded", output: result.output });
        record(step, capability, { status: "succeeded", validation: result.validation, inputDigest: digest, startedAt, endedAt }, isFallback, stepId);
        return { ok: true, failure: null };
      }
      if (result.output !== undefined) outputs[stepId] = result.output; // a failed capability's own (e.g. rejected) result is preserved, never discarded or altered
      prior.set(stepId, { status: "failed", output: result.output });
      record(step, capability, { status: "failed", failure: result.failure, validation: result.validation ?? null, inputDigest: digest, startedAt, endedAt }, isFallback, stepId);
      return { ok: false, failure: result.failure };
    }

    for (const step of workflow.steps) {
      if ((step.dependsOn ?? []).some((d) => !satisfied.has(d))) {
        record(step, step.capability, { status: "skipped", skippedBecause: "dependency_failed" }, false);
        continue;
      }
      if (stopped) {
        record(step, step.capability, { status: "skipped", skippedBecause: "stopped_after_failure" }, false);
        continue;
      }
      if (!deps.handlers[step.capability] && step.optional) {
        record(step, step.capability, { status: "skipped", skippedBecause: "optional_capability_unavailable" }, false);
        notes.push(`optional step "${step.id}" was skipped: capability ${step.capability} is not available`);
        continue;
      }
      const out = await execute(step, step.capability, false);
      if (out.ok) {
        satisfied.add(step.id);
        continue;
      }
      lastFailure = out.failure;
      const fb = step.fallback;
      if (fb && out.failure && fb.onKinds.includes(out.failure.kind) && !NON_FALLBACKABLE.includes(out.failure.kind)) {
        const fbOut = await execute(step, fb.capability, true);
        fallbackInfo = { occurred: true, from: step.id, to: fb.capability };
        notes.push(`fallback: step "${step.id}" failed (${out.failure.kind}); ${fb.capability} ran as declared: ${fb.reason}`);
        if (fbOut.ok) {
          satisfied.add(step.id);
          continue;
        }
        lastFailure = fbOut.failure;
      }
      if (step.onFailure === "stop") stopped = true;
    }

    const failed = steps.filter((s) => s.status === "failed" && !s.isFallback);
    const succeeded = steps.filter((s) => s.status === "succeeded");
    // A failed step the workflow declared `stop` is ESSENTIAL (the workflow cannot deliver without it): the result is `failed`.
    // Only `continue` steps failing, with others succeeding, is `partial`; a fallback that ran is never reported as `completed`.
    const stopStepIds = new Set(workflow.steps.filter((w) => w.onFailure === "stop").map((w) => w.id));
    const essentialFailed = failed.some((f) => stopStepIds.has(f.stepId));
    let status: OrchestrationStatus;
    if (failed.length === 0 && !fallbackInfo.occurred) status = "completed";
    else if (essentialFailed && !fallbackInfo.occurred) status = "failed";
    else status = succeeded.length > 0 ? "partial" : "failed";
    const decidedBy = status === "completed" ? "the capabilities' own validations" : lastFailure ? DECIDED_BY[lastFailure.kind] : "workflow definition";
    const audit: OrchestrationAudit = {
      requestId,
      at: now().toISOString(),
      task,
      workflowId: workflow.id,
      actorKind: actor.kind,
      studentId: scope.studentId,
      examCode: scope.examCode,
      status,
      steps: steps.map((s) => ({ stepId: s.stepId, capabilityId: s.capabilityId, status: s.status, skippedBecause: s.skippedBecause, inputDigest: s.inputDigest, isFallback: s.isFallback, failureKind: s.failure?.kind ?? null, failureCode: s.failure?.code ?? null, validationStatus: s.validation?.status ?? null })),
      fallbackOccurred: fallbackInfo.occurred,
      selectionRule: `ROUTE:${workflow.id}`,
      decidedBy
    };
    return emit({
      requestId,
      task,
      workflowId: workflow.id,
      status,
      selection: { rule: `ROUTE:${workflow.id}`, reason: workflow.routeReason },
      ordering: workflow.ordering,
      steps,
      outputs,
      failure: null,
      fallback: fallbackInfo,
      decidedBy,
      notes,
      audit
    });
  }

  return { run, workflowFor: (task: TaskId): WorkflowDefinition | undefined => byTask.get(task) };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;

/** Thrown errors are classified by their stable `code`/`name` only - their MESSAGES are never copied (a provider error may contain a secret). */
export function classifyThrown(error: unknown): StructuredFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TutorError" || name === "PreferenceError") {
    switch (code) {
      case "ownership_denied":
        return fail("authorization_denied", "ownership_denied", "this enrollment is not available to this student");
      case "question_unavailable":
      case "concept_unavailable":
        return fail("not_available", String(code), "the requested question or concept is not available in this exam");
      case "invalid_request":
      case "unknown_intent":
      case "invalid_input":
      case "unsupported_field":
      case "inferred_attribute_not_allowed":
      case "invalid_value":
        return fail("invalid_request", String(code), "the capability refused the request as invalid");
      case "attempt_ownership_violation":
        return fail("authorization_denied", "attempt_ownership_violation", "an attempt that does not belong to this student was refused");
    }
  }
  if (name === "AuthoringError" || name === "CurriculumError" || name === "RevisionError") return fail("validation_failure", typeof code === "string" ? code : String(name), "the capability's own validation refused the request");
  return fail("handler_error", typeof name === "string" ? name : "unexpected", "the capability failed unexpectedly");
}

