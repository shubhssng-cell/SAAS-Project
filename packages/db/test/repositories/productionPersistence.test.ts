import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOrchestrator, type CapabilityHandler } from "@ipmat/ai-orchestration";
import { InMemoryPreferenceStore } from "@ipmat/personalization";
import { describe, expect, it } from "vitest";
import { InMemoryOrchestrationAuditStore, AUDIT_LIMITS, sanitizeAuditForStorage } from "../../src/repositories/orchestrationAudit.js";
import { auditContract, DIGEST, makeAudit, preferenceContract } from "./persistenceContracts.js";

/**
 * Phase 9 Unit 1 (docs/DECISIONS.md D-097) - NO-POSTGRES tests: the audit sanitizer, the in-memory reference stores run
 * through the SAME contracts the Prisma stores must satisfy (productionPersistence.integration.test.ts), a real orchestrator
 * writing into the audit store, and static checks of the schema and migration text.
 */
const DB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = readFileSync(join(DB_ROOT, "prisma", "schema.prisma"), "utf-8");
const migration = readFileSync(join(DB_ROOT, "prisma", "migrations", "0017_production_persistence_foundation", "migration.sql"), "utf-8");
const model = (name: string): string => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))![0];

describe("in-memory audit store satisfies the persistence contract", () => {
  const known = new Set(["stu-a", "stu-b"]);
  let n = 0;
  const env = { store: new InMemoryOrchestrationAuditStore(known), studentA: "stu-a", studentB: "stu-b", unknownStudent: "stu-ghost", uid: (l: string) => `${l}-${++n}` };
  auditContract(() => env);
});

describe("in-memory preference store satisfies the persistence contract", () => {
  const env = { store: new InMemoryPreferenceStore(), studentA: "stu-a", studentB: "stu-b" };
  preferenceContract(() => env);
});

describe("sanitizeAuditForStorage - the allowlist", () => {
  const ok = makeAudit({ requestId: "r1", studentId: "s" });
  it("accepts a well-formed audit and normalizes the timestamp", () => {
    expect(sanitizeAuditForStorage({ ...ok, at: "2026-10-06T15:30:00+05:30" }).at).toBe("2026-10-06T10:00:00.000Z");
  });
  it.each([
    ["non-object", null],
    ["array", []],
    ["extra top-level key", { ...ok, chainOfThought: "x" }],
    ["unknown task", { ...ok, task: "chat_freely" }],
    ["unknown status", { ...ok, status: "great" }],
    ["unknown actor kind", { ...ok, actorKind: "admin" }],
    ["blank request id", { ...ok, requestId: "  " }],
    ["overlong request id", { ...ok, requestId: "x".repeat(AUDIT_LIMITS.MAX_ID + 1) }],
    ["multi-line decidedBy", { ...ok, decidedBy: "a\nb" }],
    ["overlong selectionRule", { ...ok, selectionRule: "x".repeat(AUDIT_LIMITS.MAX_TEXT + 1) }],
    ["bad timestamp", { ...ok, at: "yesterday" }],
    ["too many steps", { ...ok, steps: Array.from({ length: AUDIT_LIMITS.MAX_STEPS + 1 }, () => ok.steps[0]) }],
    ["step with extra key", { ...ok, steps: [{ ...ok.steps[0], output: {} }] }],
    ["step with unknown capability", { ...ok, steps: [{ ...ok.steps[0], capabilityId: "agent" }] }],
    ["step digest that is not a digest", { ...ok, steps: [{ ...ok.steps[0], inputDigest: "the student's whole question text" }] }],
    ["failure code that is prose", { ...ok, steps: [{ ...ok.steps[0], failureCode: "the provider said: here is my reasoning" }] }],
    ["failure kind outside the vocabulary", { ...ok, steps: [{ ...ok.steps[0], failureKind: "weird" }] }],
    ["non-boolean fallback", { ...ok, fallbackOccurred: "no" }]
  ])("refuses %s", (_name, input) => {
    expect(() => sanitizeAuditForStorage(input)).toThrow(/Orchestration audit refused/);
  });
  it("rebuilds from allowlisted fields: the returned object is a new one and shares nothing mutable with the input", () => {
    const out = sanitizeAuditForStorage(ok);
    expect(out).toEqual(ok);
    expect(out.steps[0]).not.toBe(ok.steps[0]);
    expect(out.steps[0]!.inputDigest).toBe(DIGEST);
  });
});

describe("a real orchestrator writing to the durable audit store", () => {
  const stub: CapabilityHandler = async () => ({ ok: true, output: { kind: "exam", note: "PRIVATE-OUTPUT-SENTINEL" }, validation: { ran: ["x"], status: "passed" } });
  const make = (store: InMemoryOrchestrationAuditStore) =>
    createOrchestrator({
      ownership: { resolveEnrollment: async (studentId: string, enrollmentId: string) => (studentId === "stu-a" && enrollmentId === "enr-a" ? { enrollmentId, studentId, examCode: "IPMAT_INDORE" } : null) } as never,
      handlers: { exam_intelligence: stub },
      audit: store,
      now: () => new Date("2026-10-06T10:00:00.000Z"),
      newRequestId: (() => {
        let i = 0;
        return () => `req-${++i}`;
      })()
    });

  it("persists an audit of both a completed and a refused request, with no output, params or input in either", async () => {
    const store = new InMemoryOrchestrationAuditStore(new Set(["stu-a"]));
    const orch = make(store);
    const ok = await orch.run({ task: "review_exam_performance", actor: { kind: "student", studentId: "stu-a", enrollmentId: "enr-a" } });
    const denied = await orch.run({ task: "review_exam_performance", actor: { kind: "student", studentId: "stu-a", enrollmentId: "someone-elses" } });
    expect(ok.requestId).not.toBe(denied.requestId);
    const stored = await store.listForStudent("stu-a");
    expect(stored.map((r) => r.status).sort()).toEqual([ok.status, denied.status].sort());
    expect(JSON.stringify(stored)).not.toContain("PRIVATE-OUTPUT-SENTINEL");
    for (const row of stored) expect(Object.keys(row).sort()).toEqual(["actorKind", "at", "decidedBy", "examCode", "fallbackOccurred", "recordedAt", "requestId", "selectionRule", "status", "steps", "studentId", "task", "workflowId"]);
  });

  it("a failing audit store never changes what the caller receives", async () => {
    const store = new InMemoryOrchestrationAuditStore(new Set(["stu-a"]));
    store.record = async () => {
      throw new Error("database down");
    };
    const request = { task: "review_exam_performance", actor: { kind: "student", studentId: "stu-a", enrollmentId: "enr-a" } } as const;
    const healthy = await make(new InMemoryOrchestrationAuditStore(new Set(["stu-a"]))).run(request);
    const result = await make(store).run(request);
    expect({ ...result, audit: null }).toEqual({ ...healthy, audit: null });
  });
});

describe("schema / migration 0017 - static invariants", () => {
  it("is the next migration and is additive only (no DROP/ALTER-DROP/DELETE/UPDATE/TRUNCATE of existing objects)", () => {
    const dirs = readdirSync(join(DB_ROOT, "prisma", "migrations")).filter((d) => /^\d{4}_/.test(d)).sort();
    expect(dirs.indexOf("0017_production_persistence_foundation")).toBe(dirs.length - 1);
    expect(dirs.slice(0, 16).map((d) => d.slice(0, 4))).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, "0")));
    const code = migration.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i);
    expect([...code.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).every((t) => t === "student_preferences" || t === "orchestration_audits")).toBe(true);
    expect([...code.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["orchestration_audits", "student_preferences"]);
  });

  it("a preference row can hold exactly the three explicit choices and nothing that describes a student", () => {
    const m = model("StudentPreference");
    const fields = [...m.matchAll(/^\s{2}(\w+)\s+\S+/gm)].map((x) => x[1]).filter((f) => !["student"].includes(f!));
    expect(fields).toEqual(["studentId", "language", "verbosity", "preferredHelp", "createdAt", "updatedAt"]);
    expect(m).toMatch(/studentId\s+String\s+@id/);
    expect(m).toContain("onDelete: Cascade");
    for (const check of ["language", "verbosity", "preferred_help"]) expect(migration).toContain(`student_preferences_${check}_check`);
  });

  it("the audit table has no column that could hold a prompt, response, input, output, params or reasoning", () => {
    const m = model("OrchestrationAudit");
    expect(m).not.toMatch(/\b(prompt|response|reasoning|thought|scratch|plan|input|output|params|message|text|content)\b\s+(String|Json)/i);
    expect(m).toMatch(/requestId\s+String\s+@unique/);
    expect(m).toContain("onDelete: SetNull");
    expect(migration).toContain("orchestration_audits_append_only");
    expect(migration).toMatch(/BEFORE UPDATE ON "orchestration_audits"/);
  });

  it("neither new table adds a derived or inferred concept (score, mastery, confidence, level, readiness...)", () => {
    for (const name of ["StudentPreference", "OrchestrationAudit"]) expect(model(name)).not.toMatch(/\b(score|mastery|confidence|ability|level|readiness|rank|trait|profile|motivation)\w*\s+\S+/i);
  });

  it("no existing model gained a column: only the two back-relations were added to Student", () => {
    expect(model("Student")).toMatch(/preferences\s+StudentPreference\?/);
    expect(model("Student")).toMatch(/orchestrationAudits\s+OrchestrationAudit\[\]/);
    expect(migration).not.toMatch(/ALTER TABLE "students"/);
  });
});
