import type { OrchestrationAudit } from "@ipmat/ai-orchestration";
import { NO_PREFERENCES, type PreferenceStore } from "@ipmat/personalization";
import { expect, it } from "vitest";
import type { OperatorOrchestrationAuditReader, OrchestrationAuditWriter, StudentOrchestrationAuditReader } from "../../src/repositories/orchestrationAudit.js";

/**
 * Behavioural CONTRACTS (Phase 9 Unit 1, D-097) run against BOTH the in-memory reference implementation (no-Postgres
 * suite) and the Prisma implementation (real-Postgres suite). One definition, so the test double can never drift from
 * the durable store. LABELLED TEST FIXTURES: every id here is synthetic.
 */

export const DIGEST = "a".repeat(64);

export function makeAudit(over: Partial<OrchestrationAudit> & { requestId: string }): OrchestrationAudit {
  return {
    at: "2026-10-06T10:00:00.000Z",
    task: "get_help",
    workflowId: "wf-get-help",
    actorKind: "student",
    studentId: null,
    examCode: "IPMAT_INDORE",
    status: "completed",
    steps: [
      { stepId: "s1", capabilityId: "personalization", status: "succeeded", skippedBecause: null, inputDigest: DIGEST, isFallback: false, failureKind: null, failureCode: null, validationStatus: "passed" },
      { stepId: "s2", capabilityId: "tutor_response", status: "failed", skippedBecause: null, inputDigest: DIGEST, isFallback: false, failureKind: "grounding_failure", failureCode: "answer_leak", validationStatus: "failed" }
    ],
    fallbackOccurred: false,
    selectionRule: "ROUTE:wf-get-help",
    decidedBy: "existing tutor grounding validation",
    ...over
  };
}

export interface AuditContractEnv {
  store: OrchestrationAuditWriter & StudentOrchestrationAuditReader & OperatorOrchestrationAuditReader;
  studentA: string;
  studentB: string;
  /** A student id that does not exist in the store's student table. */
  unknownStudent: string;
  uid: (label: string) => string;
}

export function auditContract(getEnv: () => AuditContractEnv): void {
  it("round-trips every audit field and adds only recordedAt", async () => {
    const { store, studentA, uid } = getEnv();
    const audit = makeAudit({ requestId: uid("rt"), studentId: studentA });
    expect(await store.append(audit)).toBe("stored");
    const stored = await store.getForStudent(studentA, audit.requestId);
    const { recordedAt, ...rest } = stored!;
    expect(Number.isNaN(Date.parse(recordedAt))).toBe(false);
    expect(rest).toEqual(audit);
  });

  it("is idempotent per request id: an identical repeat stores nothing new; concurrent identical records store one row", async () => {
    const { store, studentA, uid } = getEnv();
    const audit = makeAudit({ requestId: uid("idem"), studentId: studentA });
    expect(await store.append(audit)).toBe("stored");
    expect(await store.append(structuredClone(audit))).toBe("duplicate");
    const racing = makeAudit({ requestId: uid("race"), studentId: studentA });
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => store.append(structuredClone(racing))));
    expect(outcomes.filter((o) => o === "stored")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(7);
    expect((await store.listForStudent(studentA, { limit: 100 })).filter((r) => r.requestId === racing.requestId)).toHaveLength(1);
  });

  it("refuses a DIFFERENT audit under an existing request id as a conflict and keeps the original", async () => {
    const { store, studentA, uid } = getEnv();
    const audit = makeAudit({ requestId: uid("conflict"), studentId: studentA });
    await store.append(audit);
    await expect(store.append({ ...audit, status: "failed" })).rejects.toMatchObject({ code: "conflict" });
    expect((await store.getForStudent(studentA, audit.requestId))!.status).toBe("completed");
  });

  it("isolates students: a student reads only their own audits, another's request id looks like a missing one", async () => {
    const { store, studentA, studentB, uid } = getEnv();
    const a = makeAudit({ requestId: uid("iso-a"), studentId: studentA });
    const b = makeAudit({ requestId: uid("iso-b"), studentId: studentB });
    await store.append(a);
    await store.append(b);
    expect((await store.listForStudent(studentA, { limit: 100 })).map((r) => r.requestId)).toContain(a.requestId);
    expect((await store.listForStudent(studentA, { limit: 100 })).map((r) => r.requestId)).not.toContain(b.requestId);
    expect(await store.getForStudent(studentA, b.requestId)).toBeNull();
    expect(await store.getForStudent(studentB, a.requestId)).toBeNull();
    expect(await store.getForStudent(studentA, "no-such-request")).toBeNull();
  });

  it("keeps staff audits (no student) out of every student read, but reachable by an operator", async () => {
    const { store, studentA, uid } = getEnv();
    const staff = makeAudit({ requestId: uid("staff"), actorKind: "staff", studentId: null, task: "generate_question" });
    await store.append(staff);
    expect((await store.listForStudent(studentA, { limit: 100 })).map((r) => r.requestId)).not.toContain(staff.requestId);
    expect(await store.getForStudent(studentA, staff.requestId)).toBeNull();
    expect((await store.findByRequestId(staff.requestId))!.actorKind).toBe("staff");
    expect(await store.findByRequestId("no-such-request")).toBeNull();
  });

  it("stores an unverified claim of a NONEXISTENT student with a null student (the claim is not retained, the audit is not lost)", async () => {
    const { store, unknownStudent, uid } = getEnv();
    const audit = makeAudit({ requestId: uid("ghost"), studentId: unknownStudent, status: "refused", steps: [] });
    expect(await store.append(audit)).toBe("stored");
    expect((await store.findByRequestId(audit.requestId))!.studentId).toBeNull();
    expect(await store.getForStudent(unknownStudent, audit.requestId)).toBeNull();
    expect(await store.append(structuredClone(audit))).toBe("duplicate");
  });

  it("lists newest first and bounds the page", async () => {
    const { store, studentB, uid } = getEnv();
    const ids = [1, 2, 3].map((n) => uid(`ord${n}`));
    await store.append(makeAudit({ requestId: ids[0]!, studentId: studentB, at: "2026-10-06T10:00:01.000Z" }));
    await store.append(makeAudit({ requestId: ids[2]!, studentId: studentB, at: "2026-10-06T10:00:03.000Z" }));
    await store.append(makeAudit({ requestId: ids[1]!, studentId: studentB, at: "2026-10-06T10:00:02.000Z" }));
    const ours = (await store.listForStudent(studentB, { limit: 100 })).map((r) => r.requestId).filter((r) => ids.includes(r));
    expect(ours).toEqual([ids[2], ids[1], ids[0]]);
    expect(await store.listForStudent(studentB, { limit: 1 })).toHaveLength(1);
    await expect(store.listForStudent(studentB, { limit: 0 })).rejects.toMatchObject({ code: "invalid_record" });
    await expect(store.listForStudent("", {})).rejects.toMatchObject({ code: "invalid_record" });
  });

  it("refuses an audit carrying anything outside the allowlist, and stores nothing for it", async () => {
    const { store, studentA, uid } = getEnv();
    const id = uid("unsafe");
    const base = makeAudit({ requestId: id, studentId: studentA });
    for (const extra of [{ reasoning: "step by step ..." }, { prompt: "p" }, { response: "r" }, { output: {} }, { params: {} }]) {
      await expect(store.append({ ...base, ...extra } as never)).rejects.toMatchObject({ code: "invalid_record" });
    }
    const stepWithText = { ...base.steps[0]!, message: "provider said ..." };
    await expect(store.append({ ...base, steps: [stepWithText] } as never)).rejects.toMatchObject({ code: "invalid_record" });
    expect(await store.getForStudent(studentA, id)).toBeNull();
  });
}

export function preferenceContract(getEnv: () => { store: PreferenceStore; studentA: string; studentB: string }): void {
  it("returns 'no preference' for a student who never set one", async () => {
    const { store, studentB } = getEnv();
    expect(await store.get(studentB)).toEqual(NO_PREFERENCES);
  });

  it("round-trips a patch, merges later patches field by field, and clears with an explicit null", async () => {
    const { store, studentA } = getEnv();
    expect(await store.set(studentA, { language: "hindi" })).toEqual({ language: "hindi", verbosity: null, preferredHelp: null });
    expect(await store.set(studentA, { verbosity: "concise", preferredHelp: "hint" })).toEqual({ language: "hindi", verbosity: "concise", preferredHelp: "hint" });
    expect(await store.get(studentA)).toEqual({ language: "hindi", verbosity: "concise", preferredHelp: "hint" });
    expect(await store.set(studentA, { language: null })).toEqual({ language: null, verbosity: "concise", preferredHelp: "hint" });
  });

  it("refuses every non-preference field, trait-like or not, and an invalid value, without changing the stored state", async () => {
    const { store, studentA } = getEnv();
    const before = await store.get(studentA);
    for (const patch of [{ confidence: "high" }, { learningStyle: "visual" }, { level: 3 }, { somethingElse: 1 }, { language: "klingon" }, "english", null]) {
      await expect(store.set(studentA, patch)).rejects.toMatchObject({ name: "PreferenceError" }); // refused by the domain validator, not by whatever the storage happens to throw
    }
    expect(await store.get(studentA)).toEqual(before);
  });

  it("isolates students: one student's write never appears under another's key", async () => {
    const { store, studentA, studentB } = getEnv();
    await store.set(studentA, { language: "hinglish" });
    expect((await store.get(studentB)).language).toBeNull();
  });

  it("refuses a blank student id", async () => {
    const { store } = getEnv();
    await expect(store.set("  ", { language: "hindi" })).rejects.toThrow();
  });
}
