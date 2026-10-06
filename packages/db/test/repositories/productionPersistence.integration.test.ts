import { randomUUID } from "node:crypto";
import { createOrchestrator, type CapabilityHandler } from "@ipmat/ai-orchestration";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaOrchestrationAuditStore } from "../../src/repositories/orchestrationAudit.js";
import { PrismaPreferenceStore } from "../../src/repositories/prismaPreferenceStore.js";
import { auditContract, makeAudit, preferenceContract } from "./persistenceContracts.js";

/**
 * REAL DATABASE tests for the Phase 9 Unit 1 persistence foundation (docs/DECISIONS.md D-097). SKIPPED unless
 * `IPMAT_TEST_DATABASE_URL` is set; refuses any database whose name does not contain "test".
 *
 * FIXTURE DATA: every student, enrollment, preference and audit written here is synthetic, tagged with a per-run id and
 * deleted afterwards. Nothing is published and no content is written.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

vi.setConfig({ testTimeout: 60_000 });

const RUN = `p9u1-${randomUUID().slice(0, 8)}`;
const sqlState = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "no error",
    (e: { message?: string; meta?: { code?: string }; code?: string }) => `${e.code ?? ""}|${e.meta?.code ?? ""}|${(e.message ?? "").slice(-300)}`
  );

describe.skipIf(!DATABASE_URL)("production persistence foundation - real Postgres", () => {
  let prisma: PrismaClient;
  let studentA = "";
  let studentB = "";
  let examId = "";
  const students: string[] = [];
  const mkStudent = async (label: string): Promise<string> => {
    const s = await prisma.student.create({ data: { authRef: `${RUN}-${label}` } });
    students.push(s.id);
    return s.id;
  };
  const uid = (label: string): string => `${RUN}-${label}`;

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    studentA = await mkStudent("a");
    studentB = await mkStudent("b");
    examId = (await prisma.exam.findFirstOrThrow({ select: { id: true } })).id;
  });

  afterAll(async () => {
    await prisma.orchestrationAudit.deleteMany({ where: { requestId: { startsWith: RUN } } });
    await prisma.student.deleteMany({ where: { id: { in: students } } });
    await prisma.$disconnect();
  });

  describe("PrismaPreferenceStore", () => {
    const store = () => new PrismaPreferenceStore(prisma);
    // A fresh pair of students per contract run is unnecessary: the contract only needs two distinct, initially-empty students.
    preferenceContract(() => ({ store: store(), studentA, studentB }));

    it("refuses an unknown student as missing_reference and creates no row", async () => {
      await expect(store().set(`${RUN}-nobody`, { language: "hindi" })).rejects.toMatchObject({ code: "missing_reference" });
      expect(await prisma.studentPreference.count({ where: { studentId: `${RUN}-nobody` } })).toBe(0);
    });

    it("concurrent patches to DIFFERENT fields both survive (no lost update)", async () => {
      const s = await mkStudent("concurrent");
      await Promise.all([store().set(s, { language: "english" }), store().set(s, { verbosity: "detailed" }), store().set(s, { preferredHelp: "explanation" })]);
      expect(await store().get(s)).toEqual({ language: "english", verbosity: "detailed", preferredHelp: "explanation" });
      expect(await prisma.studentPreference.count({ where: { studentId: s } })).toBe(1);
    });

    it("an empty patch writes nothing; erase deletes the row and is idempotent", async () => {
      const s = await mkStudent("erase");
      await store().set(s, {});
      expect(await prisma.studentPreference.count({ where: { studentId: s } })).toBe(0);
      await store().set(s, { language: "hindi" });
      expect(await store().erase(s)).toBe(true);
      expect(await store().erase(s)).toBe(false);
      expect(await store().get(s)).toEqual({ language: null, verbosity: null, preferredHelp: null });
    });

    it("the database itself refuses a value outside the closed vocabularies (CHECK), whatever the application did", async () => {
      const s = await mkStudent("check");
      for (const column of ["language", "verbosity", "preferred_help"]) {
        const out = await sqlState(prisma.$executeRawUnsafe(`INSERT INTO student_preferences (student_id, ${column}, updated_at) VALUES ($1, 'bogus', now())`, s));
        expect(out).toMatch(/check|23514/i);
      }
      expect(await prisma.studentPreference.count({ where: { studentId: s } })).toBe(0);
    });

    it("a preference row is deleted with its student (cascade) and has no way to exist without one (FK)", async () => {
      const s = await mkStudent("cascade");
      await store().set(s, { verbosity: "concise" });
      await prisma.student.delete({ where: { id: s } });
      expect(await prisma.studentPreference.count({ where: { studentId: s } })).toBe(0);
      expect(await sqlState(prisma.$executeRawUnsafe(`INSERT INTO student_preferences (student_id, updated_at) VALUES ('${RUN}-orphan', now())`))).toMatch(/foreign|23503/i);
    });

    it("writing a preference touches no evidence, mastery, repair or training table (authoritative data stays separate from derived data)", async () => {
      const counts = async () => [await prisma.attempt.count(), await prisma.masteryState.count(), await prisma.repairPlan.count(), await prisma.autopsy.count(), await prisma.trainingSession.count(), await prisma.practiceBlock.count(), await prisma.examSimulation.count()];
      const before = await counts();
      const s = await mkStudent("separation");
      await store().set(s, { language: "hinglish", verbosity: "standard", preferredHelp: "hint" });
      await new PrismaOrchestrationAuditStore(prisma).append(makeAudit({ requestId: uid("sep"), studentId: s }));
      expect(await counts()).toEqual(before);
    });
  });

  describe("PrismaOrchestrationAuditStore", () => {
    const store = () => new PrismaOrchestrationAuditStore(prisma);
    auditContract(() => ({ store: store(), studentA, studentB, unknownStudent: `${RUN}-ghost`, uid }));

    it("the database enforces the closed vocabularies and the unique request id regardless of the application", async () => {
      const insert = (over: string, requestId: string) =>
        prisma.$executeRawUnsafe(
          `INSERT INTO orchestration_audits (id, request_id, occurred_at, task, actor_kind, status, fallback_occurred, selection_rule, decided_by, steps) VALUES (gen_random_uuid()::text, $1, now(), 't', ${over}, false, 'r', 'd', '[]'::jsonb)`,
          requestId
        );
      expect(await sqlState(insert(`'robot', 'completed'`, uid("db1")))).toMatch(/check|23514/i);
      expect(await sqlState(insert(`'student', 'excellent'`, uid("db2")))).toMatch(/check|23514/i);
      expect(await sqlState(insert(`'student', 'completed'`, "   "))).toMatch(/check|23514/i);
      expect(await sqlState(prisma.$executeRawUnsafe(`INSERT INTO orchestration_audits (id, request_id, occurred_at, task, actor_kind, status, fallback_occurred, selection_rule, decided_by, steps) VALUES (gen_random_uuid()::text, $1, now(), 't', 'student', 'completed', false, 'r', 'd', '{}'::jsonb)`, uid("db3")))).toMatch(/check|23514/i);
      expect(await sqlState(insert(`'student', 'completed'`, uid("db4")))).toBe("no error");
      expect(await sqlState(insert(`'student', 'completed'`, uid("db4")))).toMatch(/unique|23505/i);
    });

    it("is append-only: UPDATE of any recorded fact is refused by the database; DELETE is not blocked (retention is an unresolved policy)", async () => {
      const a = makeAudit({ requestId: uid("append-only"), studentId: studentA });
      await store().append(a);
      expect(await sqlState(prisma.orchestrationAudit.update({ where: { requestId: a.requestId }, data: { status: "failed" } }))).toMatch(/append-only/);
      expect(await sqlState(prisma.orchestrationAudit.update({ where: { requestId: a.requestId }, data: { steps: [] } }))).toMatch(/append-only/);
      expect(await sqlState(prisma.orchestrationAudit.update({ where: { requestId: a.requestId }, data: { studentId: studentB } }))).toMatch(/append-only/);
      expect((await store().findByRequestId(a.requestId))!.status).toBe("completed");
      expect((await prisma.orchestrationAudit.deleteMany({ where: { requestId: a.requestId } })).count).toBe(1);
    });

    it("deleting a student DETACHES their audits (student_id NULL, every fact kept) - the one UPDATE the trigger allows", async () => {
      const s = await mkStudent("detach");
      const a = makeAudit({ requestId: uid("detach"), studentId: s });
      await store().append(a);
      await prisma.student.delete({ where: { id: s } });
      const kept = await store().findByRequestId(a.requestId);
      expect(kept).toMatchObject({ studentId: null, status: "completed", task: "get_help" });
      expect(await store().getForStudent(s, a.requestId)).toBeNull();
    });

    it("preserves step detail through jsonb (which reorders object keys) and still recognises the identical repeat", async () => {
      const a = makeAudit({ requestId: uid("jsonb"), studentId: studentA });
      await store().append(a);
      expect((await store().findByRequestId(a.requestId))!.steps).toEqual(a.steps);
      expect(await store().append(structuredClone(a))).toBe("duplicate");
    });

    it("stores no free text beyond the allowlisted facts: the row contains neither a sentinel placed in a refused field nor in the orchestrator's outputs", async () => {
      const stub: CapabilityHandler = async () => ({ ok: true, output: { secret: "PRIVATE-OUTPUT-SENTINEL" }, validation: { ran: ["x"], status: "passed" } });
      let n = 0;
      const orch = createOrchestrator({
        ownership: { resolveEnrollment: async (s: string, e: string) => (s === studentA ? { enrollmentId: e, studentId: s, examCode: "IPMAT_INDORE" } : null) } as never,
        handlers: { exam_intelligence: stub },
        audit: store(),
        newRequestId: () => uid(`orch-${++n}`)
      });
      const ok = await orch.run({ task: "review_exam_performance", actor: { kind: "student", studentId: studentA, enrollmentId: "enr-x" } });
      const refused = await orch.run({ task: "review_exam_performance", actor: { kind: "student", studentId: studentB, enrollmentId: "enr-not-theirs" } });
      const rows = await prisma.orchestrationAudit.findMany({ where: { requestId: { in: [ok.requestId, refused.requestId] } } });
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain("PRIVATE-OUTPUT-SENTINEL");
      expect(rows.find((r) => r.requestId === refused.requestId)).toMatchObject({ status: "refused", studentId: studentB });
      // student isolation holds for what the orchestrator wrote: A cannot see B's refused request
      expect(await store().getForStudent(studentA, refused.requestId)).toBeNull();
      expect(await store().getForStudent(studentB, refused.requestId)).not.toBeNull();
    });

    it("a failed insert leaves no partial row (the write is one statement)", async () => {
      const bad = { ...makeAudit({ requestId: uid("partial"), studentId: studentA }), status: "great" } as never;
      await expect(store().append(bad)).rejects.toMatchObject({ code: "invalid_record" });
      expect(await prisma.orchestrationAudit.count({ where: { requestId: uid("partial") } })).toBe(0);
    });
  });

  describe("existing authoritative persistence (migrations 0001-0016) is untouched", () => {
    it("every pre-existing table the production system relies on still exists, and enrollment scoping (student x exam unique) is intact", async () => {
      const tables = (await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map((t) => t.tablename);
      for (const t of ["students", "sessions", "enrollments", "attempts", "attempt_events", "autopsies", "repair_plans", "mastery_states", "practice_sessions", "practice_blocks", "training_sessions", "exam_simulations", "simulation_questions", "simulation_answer_events", "questions", "student_preferences", "orchestration_audits"]) expect(tables).toContain(t);
      const s = await mkStudent("enroll");
      await prisma.enrollment.create({ data: { studentId: s, examId, enrolledAt: new Date("2026-09-01T00:00:00Z") } });
      expect(await sqlState(prisma.enrollment.create({ data: { studentId: s, examId, enrolledAt: new Date("2026-09-02T00:00:00Z") } }))).toMatch(/P2002|unique/i);
    });
  });
});
