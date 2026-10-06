import { CAPABILITY_REGISTRY, isRegisteredCapability } from "./registry.js";
import { NON_FALLBACKABLE, TASK_IDS, type CapabilityId, type FailureKind, type TaskId } from "./types.js";

/**
 * EXPLICIT WORKFLOWS. A workflow is code a developer wrote and reviewed: an ordered list of steps, each
 * naming one registered capability. Nothing here is generated, chosen or edited by a model at run time.
 * Every dependency and every fallback is spelled out, so "what can run, in what order, and what happens on
 * failure" is answerable from this file alone.
 */
export interface WorkflowFallback {
  /** The ONLY other capability that may run if the step fails with one of `onKinds`. */
  capability: CapabilityId;
  onKinds: readonly FailureKind[];
  /** Why this fallback is defined (a fixed sentence recorded in the trace). */
  reason: string;
}

export interface WorkflowStep {
  id: string;
  capability: CapabilityId;
  /** Earlier steps that must have succeeded; otherwise this step is skipped (recorded `dependency_failed`). */
  dependsOn?: readonly string[];
  /** `stop`: a failure ends the workflow (later steps are recorded as skipped). `continue`: later steps still run. Always explicit. */
  onFailure: "stop" | "continue";
  /** If true, a missing capability is an explicit, recorded skip rather than a failure. */
  optional?: boolean;
  fallback?: WorkflowFallback;
}

export interface WorkflowDefinition {
  id: string;
  task: TaskId;
  steps: readonly WorkflowStep[];
  /**
   * `single_step`; `fixed_by_definition` (later steps use earlier steps' outputs, in this order); or
   * `unspecified` (independent steps whose order carries NO meaning and among whose results no priority is
   * defined - the repository specifies none, so none is invented).
   */
  ordering: "single_step" | "fixed_by_definition" | "unspecified";
  routeReason: string;
}

export interface WorkflowIssue {
  code: string;
  message: string;
}

/**
 * Validates a definition against the registry. Used for the shipped workflows and for any additional one a
 * caller registers: an invalid definition makes the orchestrator FAIL TO CONSTRUCT (fail closed) - it can
 * never be half-applied at run time.
 */
export function validateWorkflowDefinition(def: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (!(TASK_IDS as readonly string[]).includes(def.task)) add("unknown_task", `unknown task "${String(def.task)}"`);
  if (def.steps.length === 0) add("no_steps", "a workflow needs at least one step");
  const seen = new Set<string>();
  for (const step of def.steps) {
    if (seen.has(step.id)) add("duplicate_step", `step id "${step.id}" is used twice`);
    if (!isRegisteredCapability(step.capability)) {
      add("unregistered_capability", `step "${step.id}" names an unregistered capability`);
      seen.add(step.id);
      continue;
    }
    for (const dep of step.dependsOn ?? []) if (!seen.has(dep)) add("forward_dependency", `step "${step.id}" depends on "${dep}", which is not an EARLIER step (no cycles, no forward references)`);
    if (step.onFailure !== "stop" && step.onFailure !== "continue") add("invalid_on_failure", `step "${step.id}" must declare onFailure as "stop" or "continue"`);
    const fb = step.fallback;
    if (fb) {
      const primary = CAPABILITY_REGISTRY[step.capability];
      if (!isRegisteredCapability(fb.capability)) add("unregistered_fallback", `the fallback of "${step.id}" names an unregistered capability`);
      else {
        const target = CAPABILITY_REGISTRY[fb.capability];
        if (fb.capability === step.capability) add("self_fallback", `the fallback of "${step.id}" is the step's own capability`);
        if (target.mayMutateState) add("mutating_fallback", `the fallback of "${step.id}" may mutate state; a fallback never writes`);
        if (primary.actors.some((a) => !target.actors.includes(a))) add("fallback_actor_mismatch", `the fallback of "${step.id}" is not authorized for every actor the step is`);
        if (target.examScope !== primary.examScope || target.studentScope !== primary.studentScope) add("fallback_scope_mismatch", `the fallback of "${step.id}" has a different exam or student scope`);
      }
      if (fb.onKinds.length === 0) add("empty_fallback_kinds", `the fallback of "${step.id}" must name the failure kinds it covers`);
      for (const k of fb.onKinds) if (NON_FALLBACKABLE.includes(k)) add("security_fallback", `the fallback of "${step.id}" covers "${k}"; security, policy and request failures are final and never fall back`);
      if (!fb.reason.trim()) add("fallback_without_reason", `the fallback of "${step.id}" needs a stated reason`);
    }
    seen.add(step.id);
  }
  if (def.ordering === "single_step" && def.steps.length !== 1) add("ordering_mismatch", "single_step requires exactly one step");
  if (def.ordering === "unspecified" && (def.steps.length < 2 || def.steps.some((s) => (s.dependsOn ?? []).length > 0))) add("ordering_mismatch", "unspecified ordering requires two or more independent steps");
  if (def.ordering === "fixed_by_definition" && def.steps.length < 2) add("ordering_mismatch", "fixed_by_definition requires two or more steps");
  return issues;
}

const TUTOR_PRESENTED = (task: TaskId): WorkflowDefinition => ({
  id: `tutor.${task}`,
  task,
  ordering: "fixed_by_definition",
  routeReason: `Task "${task}" maps to the tutor's own intent, preceded by an OPTIONAL explicit-preference step that sets only the presentation (language, length). The tutor then applies its own answer-key, ownership and grounding rules.`,
  steps: [
    { id: "personalization", capability: "personalization", onFailure: "continue", optional: true },
    { id: "tutor", capability: "tutor_response", onFailure: "stop" }
  ]
});

export const SHIPPED_WORKFLOWS: readonly WorkflowDefinition[] = Object.freeze([
  TUTOR_PRESENTED("explain_question"),
  TUTOR_PRESENTED("explain_concept"),
  TUTOR_PRESENTED("give_hint"),
  TUTOR_PRESENTED("guide_with_question"),
  TUTOR_PRESENTED("explain_mistake"),
  TUTOR_PRESENTED("clarify_solution"),
  {
    id: "tutor.get_help",
    task: "get_help",
    ordering: "fixed_by_definition",
    routeReason: "A help request names no intent, so the stored help preference chooses among the EXISTING tutor intents (HELP-1); with no preference the caller must choose, so the workflow stops. The tutor's own policy then governs disclosure.",
    steps: [
      { id: "personalization", capability: "personalization", onFailure: "stop" },
      { id: "tutor", capability: "tutor_response", dependsOn: ["personalization"], onFailure: "stop" }
    ]
  },
  {
    id: "authoring.generate_question",
    task: "generate_question",
    ordering: "single_step",
    routeReason: "Question generation is authoring: validated spec -> existing pipeline -> existing 11 gates -> a candidate. It has no publish step and the orchestrator has no publish capability.",
    steps: [{ id: "generation", capability: "question_generation", onFailure: "stop" }]
  },
  {
    id: "review.revision_and_curriculum",
    task: "review_revision_and_curriculum",
    ordering: "unspecified",
    routeReason: "Revision's position relative to the adaptive chain is not specified (D-081, D-089), so both existing results are returned independently with NO order or priority between them.",
    steps: [
      { id: "curriculum", capability: "adaptive_curriculum", onFailure: "continue" },
      { id: "revision", capability: "revision_intelligence", onFailure: "continue" }
    ]
  },
  {
    id: "review.exam_performance",
    task: "review_exam_performance",
    ordering: "unspecified",
    routeReason: "Finalized-simulation readiness EVIDENCE (five separate facts, no score) plus, where available, exam-level content availability. Independent results; no readiness verdict exists to compose.",
    steps: [
      { id: "simulation", capability: "simulation_intelligence", onFailure: "continue" },
      { id: "exam", capability: "exam_intelligence", onFailure: "continue", optional: true }
    ]
  }
]);

/** The fixed route table: one task -> one workflow id. Not computed, not learned, not model-chosen. */
export const ROUTE_TABLE: Readonly<Record<TaskId, string>> = Object.freeze(Object.fromEntries(SHIPPED_WORKFLOWS.map((w) => [w.task, w.id])) as Record<TaskId, string>);
