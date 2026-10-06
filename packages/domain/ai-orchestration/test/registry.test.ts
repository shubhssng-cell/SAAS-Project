import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, CAPABILITY_REGISTRY, FAILURE_KINDS, NON_FALLBACKABLE, ROUTE_TABLE, SHIPPED_WORKFLOWS, TASK_IDS, authorizeCapability, buildCapabilityInput, createOrchestrator, isRegisteredCapability, validateWorkflowDefinition, type Actor, type WorkflowDefinition } from "../src/index.js";
import { ENROLL_A, STUDENT_A, tutorPorts } from "./tutorFixtures.js";

const step = (over: Record<string, unknown> = {}) => ({ id: "s1", capability: "adaptive_curriculum", onFailure: "stop", ...over });
const wf = (steps: unknown[], over: Record<string, unknown> = {}): WorkflowDefinition => ({ id: "w", task: "review_revision_and_curriculum", ordering: steps.length === 1 ? "single_step" : "fixed_by_definition", routeReason: "test", steps: steps as WorkflowDefinition["steps"], ...over });
const codes = (def: WorkflowDefinition) => validateWorkflowDefinition(def).map((i) => i.code);

describe("capability registry: a closed allowlist of capabilities that exist", () => {
  it("registers exactly the seven existing capabilities, and nothing else", () => {
    expect([...CAPABILITY_IDS].sort()).toEqual(["adaptive_curriculum", "exam_intelligence", "personalization", "question_generation", "revision_intelligence", "simulation_intelligence", "tutor_response"]);
    expect(Object.keys(CAPABILITY_REGISTRY).sort()).toEqual([...CAPABILITY_IDS].sort());
    expect(Object.isFrozen(CAPABILITY_REGISTRY)).toBe(true);
  });
  it("every descriptor states purpose, inputs, output, actors, scope, LLM use, mutation and validation", () => {
    for (const d of Object.values(CAPABILITY_REGISTRY)) {
      expect(d.purpose.length).toBeGreaterThan(20);
      expect(d.requiredInputs.length).toBeGreaterThan(0);
      expect(d.outputType.length).toBeGreaterThan(0);
      expect(d.actors.length).toBeGreaterThan(0);
      expect(["enrollment_exam", "spec_exam"]).toContain(d.examScope);
      expect(["own", "none"]).toContain(d.studentScope);
      expect(typeof d.mayCallLlm).toBe("boolean");
      expect(typeof d.mayMutateState).toBe("boolean");
      expect(d.validation.length).toBeGreaterThan(0);
    }
  });
  it("only the capabilities that need a model may call one; only generation may mutate state; generation is staff-only and content_admin-only", () => {
    expect(Object.values(CAPABILITY_REGISTRY).filter((d) => d.mayCallLlm).map((d) => d.id).sort()).toEqual(["question_generation", "tutor_response"]);
    expect(Object.values(CAPABILITY_REGISTRY).filter((d) => d.mayMutateState).map((d) => d.id)).toEqual(["question_generation"]);
    expect(CAPABILITY_REGISTRY.question_generation.actors).toEqual(["staff"]);
    expect(CAPABILITY_REGISTRY.question_generation.staffRoles).toEqual(["content_admin"]);
    for (const id of CAPABILITY_IDS) if (id !== "question_generation") expect(CAPABILITY_REGISTRY[id].actors).toEqual(["student"]);
  });
  it("no capability can publish, and no future capability is registered", () => {
    for (const d of Object.values(CAPABILITY_REGISTRY)) expect(`${d.id} ${d.outputType}`).not.toMatch(/publish|agent|browse|sql|shell|http|memory/i);
    expect(CAPABILITY_REGISTRY.question_generation.purpose).toMatch(/Never publishes/);
  });
  it("an unknown capability is not registered - including prototype keys and model-style names", () => {
    for (const bad of ["publish_question", "shell", "web_search", "constructor", "__proto__", "toString", "hasOwnProperty", "", null, undefined, 3, "Tutor_Response"]) expect(isRegisteredCapability(bad), String(bad)).toBe(false);
    for (const good of CAPABILITY_IDS) expect(isRegisteredCapability(good)).toBe(true);
  });
  it("authorization is per actor, role, exam and student", () => {
    const scope = { examCode: "IPMAT_INDORE", studentId: STUDENT_A, enrollmentId: ENROLL_A };
    const student: Actor = { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A };
    const staff: Actor = { kind: "staff", role: "content_admin", examCodes: ["IPMAT_INDORE"] };
    expect(authorizeCapability(student, CAPABILITY_REGISTRY.tutor_response, scope)).toBeNull();
    expect(authorizeCapability(student, CAPABILITY_REGISTRY.question_generation, scope)?.code).toBe("actor_not_permitted");
    expect(authorizeCapability(staff, CAPABILITY_REGISTRY.tutor_response, { ...scope, studentId: null, enrollmentId: null })?.code).toBe("actor_not_permitted");
    expect(authorizeCapability(staff, CAPABILITY_REGISTRY.question_generation, { examCode: "IPMAT_INDORE", studentId: null, enrollmentId: null })).toBeNull();
    expect(authorizeCapability({ ...staff, role: "content_reviewer" }, CAPABILITY_REGISTRY.question_generation, { examCode: "IPMAT_INDORE", studentId: null, enrollmentId: null })?.code).toBe("role_not_permitted");
    expect(authorizeCapability(staff, CAPABILITY_REGISTRY.question_generation, { examCode: "OTHER_EXAM", studentId: null, enrollmentId: null })?.code).toBe("exam_not_permitted");
    expect(authorizeCapability({ ...student, studentId: "someone-else" }, CAPABILITY_REGISTRY.adaptive_curriculum, scope)?.code).toBe("student_scope_mismatch");
  });
  it("each capability's required inputs are exactly what the context router supplies (no more)", () => {
    const scope = { examCode: "IPMAT_INDORE", studentId: STUDENT_A, enrollmentId: ENROLL_A };
    const base = { task: "explain_question" as const, params: { questionId: "q" }, scope, actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A } as Actor, prior: new Map() };
    expect(Object.keys(buildCapabilityInput("adaptive_curriculum", base)).sort()).toEqual(["enrollmentId", "examCode", "studentId"]);
    expect(Object.keys(buildCapabilityInput("revision_intelligence", base)).sort()).toEqual(["enrollmentId", "examCode", "studentId"]);
    expect(Object.keys(buildCapabilityInput("simulation_intelligence", base)).sort()).toEqual(["enrollmentId", "examCode", "studentId"]);
    expect(Object.keys(buildCapabilityInput("exam_intelligence", base))).toEqual(["examCode"]);
    expect(Object.keys(buildCapabilityInput("tutor_response", base))).toEqual(["request"]);
  });
});

describe("workflows: explicit, validated, closed", () => {
  it("every task has exactly one shipped workflow and the route table maps to it", () => {
    expect(Object.keys(ROUTE_TABLE).sort()).toEqual([...TASK_IDS].sort());
    for (const task of TASK_IDS) expect(SHIPPED_WORKFLOWS.filter((w) => w.task === task)).toHaveLength(1);
    for (const w of SHIPPED_WORKFLOWS) {
      expect(validateWorkflowDefinition(w)).toEqual([]);
      expect(ROUTE_TABLE[w.task]).toBe(w.id);
    }
  });
  it("no shipped workflow defines a fallback (none is specified), and none contains a publish step", () => {
    for (const w of SHIPPED_WORKFLOWS) for (const s of w.steps) expect(s.fallback, `${w.id}/${s.id}`).toBeUndefined();
  });
  it("the two independent review workflows declare their order unspecified (no invented priority)", () => {
    expect(SHIPPED_WORKFLOWS.find((w) => w.task === "review_revision_and_curriculum")!.ordering).toBe("unspecified");
    expect(SHIPPED_WORKFLOWS.find((w) => w.task === "review_exam_performance")!.ordering).toBe("unspecified");
  });
  it.each([
    ["an unregistered capability", wf([step({ capability: "publish_question" })]), "unregistered_capability"],
    ["a duplicate step id", wf([step(), step()]), "duplicate_step"],
    ["a forward dependency", wf([step({ id: "a", dependsOn: ["b"] }), step({ id: "b", capability: "revision_intelligence" })]), "forward_dependency"],
    ["a self dependency", wf([step({ id: "a", dependsOn: ["a"] })]), "forward_dependency"],
    ["a missing onFailure", wf([step({ onFailure: undefined })]), "invalid_on_failure"],
    ["a fallback to an unregistered capability", wf([step({ fallback: { capability: "shell", onKinds: ["handler_error"], reason: "x" } })]), "unregistered_fallback"],
    ["a fallback to the step's own capability", wf([step({ fallback: { capability: "adaptive_curriculum", onKinds: ["handler_error"], reason: "x" } })]), "self_fallback"],
    ["a MUTATING fallback", wf([step({ capability: "tutor_response", fallback: { capability: "question_generation", onKinds: ["grounding_failure"], reason: "x" } })], { task: "explain_question" }), "mutating_fallback"],
    ["a fallback for an actor the step does not share", wf([step({ capability: "tutor_response", fallback: { capability: "exam_intelligence", onKinds: ["grounding_failure"], reason: "x" } })], { task: "explain_question" }), "fallback_scope_mismatch"],
    ["a fallback covering authorization failures", wf([step({ fallback: { capability: "revision_intelligence", onKinds: ["authorization_denied"], reason: "x" } })]), "security_fallback"],
    ["a fallback covering policy refusals", wf([step({ fallback: { capability: "revision_intelligence", onKinds: ["policy_refusal"], reason: "x" } })]), "security_fallback"],
    ["a fallback with no failure kinds", wf([step({ fallback: { capability: "revision_intelligence", onKinds: [], reason: "x" } })]), "empty_fallback_kinds"],
    ["a fallback with no reason", wf([step({ fallback: { capability: "revision_intelligence", onKinds: ["handler_error"], reason: " " } })]), "fallback_without_reason"],
    ["an unknown task", wf([step()], { task: "do_anything" }), "unknown_task"],
    ["no steps", wf([]), "no_steps"],
    ["unspecified ordering with a dependency", wf([step({ id: "a" }), step({ id: "b", capability: "revision_intelligence", dependsOn: ["a"] })], { ordering: "unspecified" }), "ordering_mismatch"]
  ])("rejects %s", (_n, def, code) => {
    expect(codes(def)).toContain(code);
  });
  it("a valid explicit fallback is accepted (non-mutating, same actors and scope, non-security kinds, with a reason)", () => {
    expect(codes(wf([step({ fallback: { capability: "revision_intelligence", onKinds: ["capability_unavailable", "handler_error"], reason: "declared for this test" } })]))).toEqual([]);
  });
  it("security and request failures can never be fallback kinds", () => {
    expect([...NON_FALLBACKABLE].sort()).toEqual(["authorization_denied", "invalid_request", "policy_refusal"]);
    expect(FAILURE_KINDS).toContain("grounding_failure");
  });
  it("the orchestrator FAILS TO CONSTRUCT with an invalid workflow override (fail closed)", () => {
    expect(() => createOrchestrator({ ownership: tutorPorts().ownership, handlers: {}, workflows: [wf([step({ capability: "publish_question" })])] })).toThrow(/invalid workflow/);
    expect(() => createOrchestrator({ ownership: tutorPorts().ownership, handlers: {}, workflows: [wf([step({ fallback: { capability: "question_generation", onKinds: ["handler_error"], reason: "x" } })])] })).toThrow(/mutating_fallback|invalid workflow/);
  });
});
