import { randomUUID } from "node:crypto";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "@ipmat/attempt";
import { createPrismaClient, PrismaAttemptRepository } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaDependencies } from "../src/wiring.js";

/**
 * Phase 7 Unit 1 (D-087) on REAL POSTGRES: the mastery EVIDENCE view derived from persisted attempts through the real Prisma
 * repositories. Evidence only - no verdict, score or threshold - and no route reads it, so this exercises the service directly.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "name must contain test" guard as the other integration suites).
 * Uses the seeded exam and its three real published questions with throwaway students/enrollments/attempts (per-run prefix, deleted
 * afterwards). No synthetic question is published and nothing shared is changed.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

const RUN = `p7u1-${randomUUID().slice(0, 8)}`;

describe.skipIf(!DATABASE_URL)("mastery evidence over real Postgres", () => {
  let prisma: PrismaClient;
  let attempts: PrismaAttemptRepository;
  let service: ReturnType<typeof createPrismaDependencies>["trainingRecommendationService"];
  let examId: string;
  let otherExamId: string;
  const created = { students: [] as string[], attempts: [] as string[] };
  let questions: Array<{ id: string; conceptId: string; correctAnswer: string; options: unknown; expectedTimeSeconds: number; conceptName: string }> = [];

  const student = async (label: string): Promise<{ studentId: string; enrollmentId: string }> => {
    const s = await prisma.student.create({ data: { authRef: `${RUN}-${label}` } });
    created.students.push(s.id);
    const e = await prisma.enrollment.create({ data: { studentId: s.id, examId, enrolledAt: new Date("2026-09-01T00:00:00Z") } });
    return { studentId: s.id, enrollmentId: e.id };
  };
  const t = (n: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + n * 1000).toISOString();
  const play = async (who: { studentId: string; enrollmentId: string }, key: string, questionId: string, at: number, outcome: "correct" | "wrong" | "skip"): Promise<string> => {
    const q = questions.find((x) => x.id === questionId)!;
    const id = randomUUID();
    created.attempts.push(id);
    const claim = { studentId: who.studentId, questionId };
    await attempts.save(startAttempt({ id, studentId: who.studentId, questionId, enrollmentId: who.enrollmentId, now: t(at) }));
    const started = await attempts.findById(id);
    const finalized =
      outcome === "skip"
        ? skipAttempt(started, claim, { now: t(at + 10) })
        : submitAttempt(
            recordAttemptEvent(started, { type: "answer_selected", occurredAt: t(at + 1), selectedAnswer: outcome === "correct" ? q.correctAnswer : ((q.options as string[] | null) ?? []).find((o) => o !== q.correctAnswer) ?? q.correctAnswer }, claim),
            claim,
            { questionId, conceptId: q.conceptId, answerFormat: "multiple_choice", options: (q.options as string[] | null) ?? null, correctAnswer: q.correctAnswer, expectedTimeSeconds: q.expectedTimeSeconds },
            { now: t(at + 40) }
          );
    await attempts.save(finalized);
    void key;
    return id;
  };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    attempts = new PrismaAttemptRepository(prisma);
    service = createPrismaDependencies(prisma).trainingRecommendationService;
    examId = (await prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" }, select: { id: true } })).id;
    const rows = await prisma.question.findMany({ where: { validationState: "published", examId }, orderBy: { id: "asc" }, select: { id: true, conceptId: true, correctAnswer: true, options: true, expectedTimeSeconds: true, concept: { select: { name: true } } } });
    questions = rows.map((r) => ({ id: r.id, conceptId: r.conceptId, correctAnswer: r.correctAnswer, options: r.options, expectedTimeSeconds: r.expectedTimeSeconds, conceptName: r.concept.name }));
    expect(questions.length).toBeGreaterThanOrEqual(2);
    const other = await prisma.exam.create({ data: { name: "Evidence Isolation Test Exam", code: `EVID_${RUN.toUpperCase().replace(/-/g, "_")}`, examDateRule: { type: "fixed_date", date: "2030-01-01" } } });
    otherExamId = other.id;
  });

  afterAll(async () => {
    await prisma.attempt.deleteMany({ where: { id: { in: created.attempts } } });
    await prisma.student.deleteMany({ where: { id: { in: created.students } } });
    await prisma.exam.deleteMany({ where: { id: otherExamId } });
    await prisma.$disconnect();
  });

  it("derives attempt AND distinct-question counts, skips and an audit trail from persisted attempts", async () => {
    const me = await student("a");
    const [q1, q2] = questions;
    const ids = [
      await play(me, "1", q1!.id, 0, "correct"),
      await play(me, "2", q1!.id, 100, "wrong"),
      await play(me, "3", q1!.id, 200, "correct"),
      await play(me, "4", q2!.id, 300, "skip")
    ];
    const view = await service.readMasteryEvidence({ studentId: me.studentId, enrollmentId: me.enrollmentId });
    expect(view).not.toBeNull();
    expect(view!.status).toBe("evidence_only");
    expect(view!.examCode).toBe("IPMAT_INDORE");
    const all = view!.concepts.flatMap((c) => c.overall.contributingAttemptIds);
    expect(all.sort()).toEqual([...ids].sort());
    const concept = view!.concepts.find((c) => c.conceptName === q1!.conceptName)!;
    expect(concept.questions.find((q) => q.questionId === q1!.id)).toMatchObject({ attempts: 3, gradedAttempts: 3, correctGradedAttempts: 2 });
    const total = view!.concepts.reduce((s, c) => s + c.overall.attempts, 0);
    expect(total).toBe(4);
    const graded = view!.concepts.reduce((s, c) => s + c.overall.gradedAttempts, 0);
    const skipped = view!.concepts.reduce((s, c) => s + c.overall.skippedAttempts, 0);
    expect([graded, skipped]).toEqual([3, 1]);
    const distinct = view!.concepts.reduce((s, c) => s + c.overall.distinctQuestions, 0);
    expect(distinct).toBe(q1!.conceptName === q2!.conceptName ? 2 : 2);
  });

  it("is reproducible: recomputing from the same persisted attempts gives an identical view, and nothing was written", async () => {
    const me = await student("b");
    await play(me, "1", questions[0]!.id, 0, "correct");
    const before = await prisma.attempt.count();
    const masteryRows = await prisma.masteryState.count();
    const first = await service.readMasteryEvidence({ studentId: me.studentId, enrollmentId: me.enrollmentId });
    const second = await service.readMasteryEvidence({ studentId: me.studentId, enrollmentId: me.enrollmentId });
    expect(second).toEqual(first);
    expect(await prisma.attempt.count()).toBe(before);
    expect(await prisma.masteryState.count()).toBe(masteryRows); // no mastery-state persistence
  });

  it("student isolation: another student's attempts never appear, and the claimed student must own the enrollment", async () => {
    const a = await student("iso-a");
    const b = await student("iso-b");
    const mine = await play(a, "1", questions[0]!.id, 0, "correct");
    const theirs = await play(b, "1", questions[0]!.id, 50, "wrong");
    const viewA = await service.readMasteryEvidence({ studentId: a.studentId, enrollmentId: a.enrollmentId });
    const viewB = await service.readMasteryEvidence({ studentId: b.studentId, enrollmentId: b.enrollmentId });
    const idsOf = (v: typeof viewA) => v!.concepts.flatMap((c) => c.overall.contributingAttemptIds);
    expect(idsOf(viewA)).toEqual([mine]);
    expect(idsOf(viewB)).toEqual([theirs]);
    expect(JSON.stringify(viewA)).not.toContain(b.studentId);
    expect(JSON.stringify(viewB)).not.toContain(a.studentId);
    await expect(service.readMasteryEvidence({ studentId: a.studentId, enrollmentId: b.enrollmentId })).rejects.toMatchObject({ code: "enrollment_ownership_mismatch" });
  });

  it("exam isolation: an enrollment in an exam with no published pool gets no evidence, and never IPMAT's", async () => {
    const s = await prisma.student.create({ data: { authRef: `${RUN}-x` } });
    created.students.push(s.id);
    const e = await prisma.enrollment.create({ data: { studentId: s.id, examId: otherExamId, enrolledAt: new Date("2026-09-01T00:00:00Z") } });
    expect(await service.readMasteryEvidence({ studentId: s.id, enrollmentId: e.id })).toBeNull();
  });

  it("never exposes the answer key, another student, the enrollment id, or question text", async () => {
    const me = await student("leak");
    await play(me, "1", questions[0]!.id, 0, "correct");
    const text = JSON.stringify(await service.readMasteryEvidence({ studentId: me.studentId, enrollmentId: me.enrollmentId }));
    const q = await prisma.question.findUniqueOrThrow({ where: { id: questions[0]!.id }, select: { body: true, correctAnswer: true } });
    for (const secret of [q.body.slice(0, 40), `"${q.correctAnswer}"`, "correctAnswer", "solutionSteps", me.enrollmentId]) expect(text, secret).not.toContain(secret);
  });

  it("this unit added no migration: the latest migration is still Content Intelligence", async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`select migration_name from _prisma_migrations where migration_name > '0015_content_intelligence' order by migration_name`;
    // this unit added no migration: the only one after Content Intelligence (0015) is Phase 7 Unit 4's exam simulation
    expect(rows.map((r) => r.migration_name)).toEqual(["0016_exam_simulation"]);
  });
});
