import { createHash } from "node:crypto";
import { TUTOR_INTENT_POLICIES, type TutorIntent } from "@ipmat/tutor";
import { CAPABILITY_REGISTRY } from "./registry.js";
import type { Actor, CapabilityId, Scope, TaskId } from "./types.js";

/**
 * THE CONTEXT ROUTER. Each capability receives ONLY the inputs its descriptor lists, built here from the
 * VERIFIED scope and the strictly validated task parameters. There is no "whole student" object anywhere: a
 * reader gets three ids, the tutor gets one tutor request, generation gets one spec. Identity and exam are
 * never read from the caller's parameters - they come from the ownership check.
 */
export class RequestError extends Error {
  constructor(readonly code: "unknown_task" | "forbidden_param" | "unknown_param" | "missing_param" | "invalid_param" | "unsupported_actor", message: string) {
    super(message);
    this.name = "RequestError";
  }
}

const TUTOR_TASKS: ReadonlySet<TaskId> = new Set<TaskId>(["explain_question", "explain_concept", "give_hint", "guide_with_question", "explain_mistake", "clarify_solution", "get_help"]);
const isTutorIntent = (task: TaskId): task is TutorIntent & TaskId => TUTOR_TASKS.has(task) && task !== "get_help";

/** Names a caller (or an injected prompt) might use to try to widen what runs. Refused by name, so the refusal is explicit. */
const ESCALATION_KEYS = ["capability", "capabilities", "capabilityId", "workflow", "workflowId", "steps", "step", "tool", "tools", "toolCall", "actor", "role", "roles", "permissions", "scope", "examCode", "examCodes", "studentId", "enrollmentId", "intent", "next", "fallback", "provider", "model", "apiKey"];

const ALLOWED_PARAMS: Record<TaskId, readonly string[]> = {
  explain_question: ["questionId", "focus", "priorInteraction", "presentation"],
  explain_concept: ["conceptName", "focus", "priorInteraction", "presentation"],
  give_hint: ["questionId", "focus", "priorInteraction", "presentation"],
  guide_with_question: ["questionId", "focus", "priorInteraction", "presentation"],
  explain_mistake: ["questionId", "focus", "priorInteraction", "presentation"],
  clarify_solution: ["questionId", "focus", "priorInteraction", "presentation"],
  get_help: ["questionId", "focus", "priorInteraction", "presentation"],
  generate_question: ["spec"],
  review_revision_and_curriculum: [],
  review_exam_performance: []
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Strict, per-task parameter validation. Unknown keys are refused; nothing is guessed or defaulted from model-like text. */
export function validateParams(task: TaskId, params: unknown): Record<string, unknown> {
  if (!(task in ALLOWED_PARAMS)) throw new RequestError("unknown_task", "unknown task");
  if (params !== undefined && !isRecord(params)) throw new RequestError("invalid_param", "params must be an object");
  const given = (params ?? {}) as Record<string, unknown>;
  const allowed = ALLOWED_PARAMS[task];
  for (const key of Object.keys(given)) {
    if (allowed.includes(key)) continue;
    throw new RequestError(ESCALATION_KEYS.includes(key) ? "forbidden_param" : "unknown_param", ESCALATION_KEYS.includes(key) ? `"${key}" cannot be set by a request: capabilities, scope and identity are decided by the orchestrator` : `"${key}" is not a parameter of task ${task}`);
  }
  const str = (k: string) => {
    if (given[k] !== undefined && typeof given[k] !== "string") throw new RequestError("invalid_param", `${k} must be a string`);
  };
  for (const k of ["questionId", "conceptName", "focus"]) str(k);
  if (given.priorInteraction !== undefined && !Array.isArray(given.priorInteraction)) throw new RequestError("invalid_param", "priorInteraction must be an array");
  if (given.presentation !== undefined && !isRecord(given.presentation)) throw new RequestError("invalid_param", "presentation must be an object");
  if (task === "generate_question" && !isRecord(given.spec)) throw new RequestError("missing_param", "generate_question requires a spec");
  if (isTutorIntent(task)) {
    const policy = TUTOR_INTENT_POLICIES[task];
    if (policy.needsQuestion && typeof given.questionId !== "string") throw new RequestError("missing_param", `${task} requires questionId`);
    if (policy.needsConcept && typeof given.conceptName !== "string") throw new RequestError("missing_param", `${task} requires conceptName`);
  }
  if (task === "get_help" && typeof given.questionId !== "string") throw new RequestError("missing_param", "get_help requires questionId");
  return { ...given };
}

export interface PriorStep {
  status: "succeeded" | "failed" | "skipped";
  output: unknown;
}

export interface BuildInputArgs {
  task: TaskId;
  params: Record<string, unknown>;
  scope: Scope;
  actor: Actor;
  prior: ReadonlyMap<string, PriorStep>;
}

export class InputError extends Error {
  constructor(readonly missing: string[]) {
    super(`missing required input(s): ${missing.join(", ")}`);
    this.name = "InputError";
  }
}

/** The tutor request for a task, from VERIFIED identity (the scope) and validated params only. */
function baseTutorRequest(args: BuildInputArgs): Record<string, unknown> {
  const { task, params, scope } = args;
  const request: Record<string, unknown> = { studentId: scope.studentId, enrollmentId: scope.enrollmentId };
  if (isTutorIntent(task)) request.intent = task;
  for (const k of ["questionId", "conceptName", "focus", "priorInteraction", "presentation"]) if (params[k] !== undefined) request[k] = params[k];
  return request;
}

/** Builds the MINIMUM input for one capability and checks its descriptor's required inputs are all present. */
export function buildCapabilityInput(capability: CapabilityId, args: BuildInputArgs): Record<string, unknown> {
  let input: Record<string, unknown>;
  switch (capability) {
    case "personalization":
      input = { request: baseTutorRequest(args), resolveIntent: args.task === "get_help" };
      break;
    case "tutor_response": {
      const personalized = args.prior.get("personalization");
      const out = personalized?.status === "succeeded" && isRecord(personalized.output) && isRecord((personalized.output as Record<string, unknown>).request) ? ((personalized.output as Record<string, unknown>).request as Record<string, unknown>) : null;
      input = { request: out ?? baseTutorRequest(args) };
      break;
    }
    case "question_generation":
      input = { spec: args.params.spec };
      break;
    case "adaptive_curriculum":
    case "revision_intelligence":
    case "simulation_intelligence":
      input = { studentId: args.scope.studentId, enrollmentId: args.scope.enrollmentId, examCode: args.scope.examCode };
      break;
    case "exam_intelligence":
      input = { examCode: args.scope.examCode };
      break;
  }
  const missing = CAPABILITY_REGISTRY[capability].requiredInputs.filter((name) => input[name] === undefined || input[name] === null);
  if (missing.length > 0) throw new InputError(missing);
  // The tutor request must carry a resolved intent (a help request's intent comes from the personalization step, never a guess).
  if (capability === "tutor_response" && !(input.request as Record<string, unknown>).intent) throw new InputError(["request.intent"]);
  return input;
}

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical);
  if (isRecord(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
};

/** A digest of what a capability was given - for the trace. The input itself is never stored. */
export function digestInput(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(canonical(input)), "utf8").digest("hex");
}
