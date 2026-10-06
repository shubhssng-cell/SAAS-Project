import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, CAPABILITY_REGISTRY, ROUTE_TABLE, TASK_IDS, authorizeCapability, digestInput, type Actor, type CapabilityId, type OrchestrationRequest, type TaskId } from "../src/index.js";
import { GEN_EXAM, GOOD, makeOrch, makeSpec } from "./env.js";
import { ENROLL_A, ENROLL_A_OTHER, ENROLL_B, STUDENT_A, STUDENT_B, hintJson } from "./tutorFixtures.js";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const READER_TASKS: TaskId[] = ["review_revision_and_curriculum", "review_exam_performance"];
const JUNK = ["question_generation", "shell", "content_admin", "__proto__", "constructor", "publish", "../../etc", "\u0000", "💥", "tutor_response; DROP TABLE", "{{capability}}", ""];

const randomActor = (r: () => number): Actor =>
  r() < 0.6
    ? { kind: "student", studentId: pick(r, [STUDENT_A, STUDENT_B, "x"]), enrollmentId: pick(r, [ENROLL_A, ENROLL_B, ENROLL_A_OTHER, "y"]) }
    : { kind: "staff", role: pick(r, ["content_admin", "content_reviewer"] as const), examCodes: pick(r, [[GEN_EXAM], ["OTHER_EXAM"], [], [GEN_EXAM, "OTHER_EXAM"]]) };

describe("properties (seeded, deterministic)", () => {
  it("DETERMINISTIC ROUTING: a task always routes to the same workflow and the same capabilities, whatever else varies", async () => {
    const r = rng(1);
    for (let i = 0; i < 40; i++) {
      const task = pick(r, READER_TASKS);
      const a = await makeOrch().orch.run({ task, actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: {} });
      const b = await makeOrch().orch.run({ task, actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: {} });
      expect(a.workflowId).toBe(ROUTE_TABLE[task]);
      expect(a.steps.map((s) => s.capabilityId)).toEqual(b.steps.map((s) => s.capabilityId));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
  it("CAPABILITY ALLOWLIST + NO ESCALATION: across fuzzed tasks, actors and parameters, only registered capabilities ever run, never more than the task's workflow names, and refusals run nothing", async () => {
    const r = rng(2);
    for (let i = 0; i < 120; i++) {
      const task = pick(r, [...TASK_IDS, ...JUNK] as string[]) as TaskId;
      const params: Record<string, unknown> = {};
      for (let k = 0; k < Math.floor(r() * 4); k++) params[pick(r, [...JUNK, "questionId", "conceptName", "focus", "spec"])] = pick(r, [...JUNK, QUESTION, 3, null, { capability: "shell" }]);
      const { orch, calls } = makeOrch({ tutorScript: [hintJson(), hintJson()] });
      const result = await orch.run({ task, actor: randomActor(r), params } as OrchestrationRequest);
      for (const c of calls) expect(CAPABILITY_IDS as readonly string[]).toContain(c.capability);
      const allowed = (TASK_IDS as readonly string[]).includes(task) ? orch.workflowFor(task)!.steps.map((s) => s.capability) : [];
      for (const c of calls) expect(allowed).toContain(c.capability);
      if (result.status === "refused") expect(calls).toEqual([]);
    }
  });
  it("AUTHORIZATION INVARIANT: whenever a capability ran, its actor was authorized for it in the verified scope", async () => {
    const r = rng(3);
    for (let i = 0; i < 80; i++) {
      const actor = randomActor(r);
      const task = pick(r, ["review_revision_and_curriculum", "review_exam_performance", "generate_question", "give_hint"] as const);
      const spec = makeSpec();
      const { orch, calls } = makeOrch({ tutorScript: [hintJson()], genScript: GOOD(spec) });
      const params = task === "generate_question" ? { spec } : task === "give_hint" ? { questionId: QUESTION } : {};
      const result = await orch.run({ task, actor, params });
      for (const c of calls) {
        const scope = actor.kind === "student" ? { examCode: String(c.input.examCode ?? GEN_EXAM), studentId: actor.studentId, enrollmentId: actor.enrollmentId } : { examCode: GEN_EXAM, studentId: null, enrollmentId: null };
        expect(authorizeCapability(actor, CAPABILITY_REGISTRY[c.capability], scope), `${actor.kind}/${c.capability}`).toBeNull();
      }
      if (actor.kind === "student" && !(actor.studentId === STUDENT_A && actor.enrollmentId === ENROLL_A) && !(actor.studentId === STUDENT_A && actor.enrollmentId === ENROLL_A_OTHER) && !(actor.studentId === STUDENT_B && actor.enrollmentId === ENROLL_B)) expect(result.status).toBe("refused");
    }
  });
  it("EXAM ISOLATION: a reader's exam is always the verified enrollment's exam, whatever the caller's parameters say", async () => {
    const r = rng(4);
    for (let i = 0; i < 40; i++) {
      const enrollmentId = pick(r, [ENROLL_A, ENROLL_A_OTHER]);
      const { orch, calls } = makeOrch();
      const result = await orch.run({ task: pick(r, READER_TASKS), actor: { kind: "student", studentId: STUDENT_A, enrollmentId }, params: r() < 0.5 ? { examCode: pick(r, [GEN_EXAM, "OTHER_EXAM"]) } : {} });
      if (result.status === "refused") {
        expect(calls).toEqual([]); // a caller-supplied exam is refused outright
        continue;
      }
      for (const c of calls) expect(c.input.examCode).toBe(enrollmentId === ENROLL_A ? GEN_EXAM : "OTHER_EXAM");
    }
  });
  it("STUDENT ISOLATION: no capability input ever contains an id other than the verified student's", async () => {
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const { orch, calls } = makeOrch({ tutorScript: [hintJson()] });
      await orch.run({ task: pick(r, ["give_hint", ...READER_TASKS] as const), actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: { questionId: QUESTION, focus: `mentions ${STUDENT_B} and ${ENROLL_B}` } as never });
      for (const c of calls) {
        const text = JSON.stringify({ ...c.input, request: (c.input.request as { focus?: unknown } | undefined) ? { ...(c.input.request as object), focus: undefined } : undefined });
        expect(text).not.toContain(STUDENT_B);
        expect(text).not.toContain(ENROLL_B);
      }
    }
  });
  it("WORKFLOW INPUT INVARIANCE: a capability's input digest does not depend on parameter key order, and does change with a different parameter", async () => {
    const r = rng(6);
    for (let i = 0; i < 30; i++) {
      const focus = `f${Math.floor(r() * 1e6)}`;
      const a = makeOrch({ tutorScript: [hintJson()] });
      const b = makeOrch({ tutorScript: [hintJson()] });
      const c = makeOrch({ tutorScript: [hintJson()] });
      const ra = await a.orch.run({ task: "give_hint", actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: { questionId: QUESTION, focus } });
      const rb = await b.orch.run({ task: "give_hint", actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: { focus, questionId: QUESTION } });
      const rc = await c.orch.run({ task: "give_hint", actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: { questionId: QUESTION, focus: `${focus}x` } });
      expect(ra.steps.map((s) => s.inputDigest)).toEqual(rb.steps.map((s) => s.inputDigest));
      expect(ra.steps[1]!.inputDigest).not.toBe(rc.steps[1]!.inputDigest);
      expect(digestInput({ b: 1, a: 2 })).toBe(digestInput({ a: 2, b: 1 }));
    }
  });
  it("NO SILENT CAPABILITY ESCALATION: whatever a capability's output says, the set of capabilities that ran is exactly the workflow's", async () => {
    const r = rng(7);
    for (let i = 0; i < 40; i++) {
      const hostile = { next: pick(r, JUNK), capability: pick(r, CAPABILITY_IDS as readonly string[]), capabilities: [pick(r, JUNK)], role: "content_admin", actor: { kind: "staff" }, fallback: pick(r, JUNK) };
      const { orch, calls } = makeOrch({ readers: { adaptive_curriculum: async () => hostile, revision_intelligence: async () => hostile } });
      await orch.run({ task: "review_revision_and_curriculum", actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: {} });
      expect(calls.map((c) => c.capability).sort()).toEqual(["adaptive_curriculum", "revision_intelligence"]);
    }
  });
  it("NO OUTPUT MUTATION: deep-frozen random outputs are returned by reference, untouched", async () => {
    const r = rng(8);
    const freeze = <T>(o: T): T => (o && typeof o === "object" ? (Object.values(o).forEach(freeze), Object.freeze(o)) : o);
    for (let i = 0; i < 30; i++) {
      const out = freeze({ n: r(), list: [r(), { deep: String(r()) }], nested: { a: [1, 2, { b: r() }] } });
      const { orch } = makeOrch({ readers: { simulation_intelligence: async () => out } });
      const res = await orch.run({ task: "review_exam_performance", actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: {} });
      expect(res.outputs.simulation).toBe(out);
    }
  });
  it("THE FAILURE VOCABULARY IS CLOSED: every step failure's kind is one of the declared kinds", async () => {
    const r = rng(9);
    for (let i = 0; i < 30; i++) {
      const { orch } = makeOrch({ tutorScript: [pick(r, ["not json", hintJson({ text: "The correct answer is ₹500." }), { throws: new Error("x") }] as never[])], readers: { revision_intelligence: async () => pick(r, [null, undefined]) as never } });
      const res = await orch.run({ task: pick(r, ["give_hint", "review_revision_and_curriculum"] as const), actor: { kind: "student", studentId: STUDENT_A, enrollmentId: ENROLL_A }, params: { questionId: QUESTION } as never });
      for (const s of res.steps) if (s.failure) expect(["invalid_request", "authorization_denied", "policy_refusal", "capability_unavailable", "not_available", "insufficient_context", "no_eligible_content", "provider_timeout", "provider_error", "malformed_output", "grounding_failure", "validation_failure", "handler_error"]).toContain(s.failure.kind);
    }
    expect(CAPABILITY_REGISTRY.tutor_response.id satisfies CapabilityId).toBe("tutor_response");
  });
});
const QUESTION = "question-pct-1";
