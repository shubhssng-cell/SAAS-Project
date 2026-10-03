import { randomUUID } from "node:crypto";
import { SimulationService, type SimulationConfigSource, type SimulationDefinition } from "@ipmat/exam-simulation";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../../src/client.js";
import { PrismaSimulationEnrollmentReader, PrismaSimulationQuestionSource, PrismaSimulationRepository } from "../../src/repositories/prismaSimulation.js";

/**
 * REAL DATABASE tests for the Full Exam Simulation engine (docs/DECISIONS.md D-090). SKIPPED unless `IPMAT_TEST_DATABASE_URL`
 * is set; refuses any database whose name does not contain "test".
 *
 * FIXTURE DATA. The repository specifies no exam duration, section structure or question counts, so the configuration used
 * here (one section, the seeded published questions, a short duration) is a labelled TEST fixture of the engine's mechanics,
 * not an IPMAT rule. The three seeded published questions are real product content; nothing synthetic is published, and every
 * student/enrollment/simulation written here is deleted afterwards.
 */
const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
}

vi.setConfig({ testTimeout: 60_000 }); // several real-database round trips per test, some with concurrent requests

const RUN = `p7u4-${randomUUID().slice(0, 8)}`;
const DURATION = 600;
const T0 = "2026-10-03T10:00:00.000Z";
const atMs = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();
const code = async (p: Promise<unknown>): Promise<string> => p.then(() => "no error", (e: { code?: string }) => e.code ?? "unknown");

describe.skipIf(!DATABASE_URL)("full exam simulation - real Postgres", () => {
  let prisma: PrismaClient;
  let examId: string;
  let questionIds: string[] = [];
  let sectionName = "";
  let now = T0;
  let keyReads = 0;
  let service: SimulationService;
  let definition: SimulationDefinition | null;
  const created = { students: [] as string[] };
  const configs: SimulationConfigSource = { findDefinition: async (examCode) => (definition && definition.config.examCode === examCode ? definition : null) };

  const person = async (label: string): Promise<{ studentId: string; enrollmentId: string }> => {
    const s = await prisma.student.create({ data: { authRef: `${RUN}-${label}` } });
    created.students.push(s.id);
    const e = await prisma.enrollment.create({ data: { studentId: s.id, examId, enrolledAt: new Date("2026-09-01T00:00:00Z") } });
    return { studentId: s.id, enrollmentId: e.id };
  };
  const setNow = (ms: number): void => {
    now = atMs(ms);
  };
  const counts = async (): Promise<number[]> => [
    await prisma.attempt.count(),
    await prisma.practiceSession.count(),
    await prisma.practiceBlock.count(),
    await prisma.trainingSession.count(),
    await prisma.repairPlan.count(),
    await prisma.masteryState.count(),
    await prisma.autopsy.count()
  ];
  const answerFor = async (position: number): Promise<{ right: string; wrong: string }> => {
    const q = await prisma.question.findUniqueOrThrow({ where: { id: questionIds[position - 1]! }, select: { correctAnswer: true, options: true } });
    const options = (Array.isArray(q.options) ? q.options.map(String) : []) as string[];
    return { right: q.correctAnswer, wrong: options.find((o) => o.trim() !== q.correctAnswer.trim()) ?? "0" };
  };

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL!);
    await prisma.$connect();
    const exam = await prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" }, select: { id: true } });
    examId = exam.id;
    const rows = await prisma.question.findMany({ where: { examId, validationState: "published" }, orderBy: { id: "asc" }, select: { id: true, section: { select: { name: true } } } });
    questionIds = rows.map((r) => r.id);
    sectionName = rows[0]!.section.name;
    expect(questionIds.length).toBeGreaterThanOrEqual(3);
    questionIds = questionIds.slice(0, 3);
    definition = {
      config: {
        examCode: "IPMAT_INDORE",
        configVersion: `${RUN}-fixture`,
        overallDurationSeconds: DURATION,
        sections: [{ sectionName, order: 1, questionCount: 3 }],
        provenance: { kind: "authored", sourceRef: "fixture:integration-test-configuration (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" }
      },
      selection: { origin: "assembled", sourceRef: "fixture:integration-test-paper", sections: { [sectionName]: questionIds } }
    };
    const source = new PrismaSimulationQuestionSource(prisma);
    const spied = { findPaperCandidates: source.findPaperCandidates.bind(source), findPublishedContent: source.findPublishedContent.bind(source), findAnswerKeys: (ids: readonly string[]) => (keyReads++, source.findAnswerKeys(ids)) };
    service = new SimulationService({ enrollments: new PrismaSimulationEnrollmentReader(prisma), configs, questions: spied, repository: new PrismaSimulationRepository(prisma), now: () => now, newId: () => randomUUID() });
  });

  afterAll(async () => {
    await prisma.student.deleteMany({ where: { id: { in: created.students } } }); // cascades enrollments, simulations, questions and events
    await prisma.$disconnect();
  });

  it("starts a persisted simulation with the fixed paper, content versions and provenance", async () => {
    setNow(0);
    const me = await person("start");
    const { simulation, created: isNew } = await service.start(me);
    expect(isNew).toBe(true);
    expect(simulation).toMatchObject({ status: "in_progress", examCode: "IPMAT_INDORE", remainingSeconds: DURATION });
    const rows = await prisma.simulationQuestion.findMany({ where: { simulationId: simulation.simulationId }, orderBy: { position: "asc" } });
    expect(rows.map((r) => [r.position, r.questionId])).toEqual(questionIds.map((id, i) => [i + 1, id]));
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.contentFingerprint) && r.provenanceSourceType.length > 0)).toBe(true);
    const sim = await prisma.examSimulation.findUniqueOrThrow({ where: { id: simulation.simulationId } });
    expect(sim).toMatchObject({ status: "in_progress", paperOrigin: "assembled", finalizedAt: null, result: null });
    expect(sim.deadlineAt.toISOString()).toBe(atMs(DURATION * 1000));
  });

  it("recovers across refresh, reconnect and a process restart, and never duplicates", async () => {
    setNow(0);
    const me = await person("recover");
    const first = await service.start(me);
    await service.answer(me, first.simulation.simulationId, { position: 1, answer: (await answerFor(1)).wrong });
    setNow(5000);
    const restarted = new SimulationService({ enrollments: new PrismaSimulationEnrollmentReader(prisma), configs, questions: new PrismaSimulationQuestionSource(prisma), repository: new PrismaSimulationRepository(prisma), now: () => now, newId: () => randomUUID() });
    const again = await restarted.start(me);
    expect(again.created).toBe(false);
    expect(again.simulation.simulationId).toBe(first.simulation.simulationId);
    expect(again.simulation.questions[0]!.status).toBe("answered");
    expect(again.simulation.remainingSeconds).toBe(DURATION - 5);
    expect(await prisma.examSimulation.count({ where: { enrollmentId: me.enrollmentId } })).toBe(1);
  });

  it("concurrent starts create exactly ONE simulation (partial unique index)", async () => {
    setNow(0);
    const me = await person("concurrent-start");
    const results = await Promise.all(Array.from({ length: 8 }, () => service.start(me)));
    expect(new Set(results.map((r) => r.simulation.simulationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await prisma.examSimulation.count({ where: { enrollmentId: me.enrollmentId, status: "in_progress" } })).toBe(1);
  });

  it("the database itself refuses a second in-progress simulation per enrollment and an inconsistent finalization", async () => {
    setNow(0);
    const me = await person("constraints");
    const { simulation } = await service.start(me);
    const base = await prisma.examSimulation.findUniqueOrThrow({ where: { id: simulation.simulationId } });
    await expect(prisma.examSimulation.create({ data: { studentId: base.studentId, enrollmentId: base.enrollmentId, examId: base.examId, configVersion: "x", config: {}, paperOrigin: "assembled", paperSourceRef: "x", status: "in_progress", startedAt: base.startedAt, deadlineAt: base.deadlineAt } })).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "exam_simulations" SET "status" = 'submitted' WHERE "id" = ${simulation.simulationId}`).rejects.toThrow(/finalization_consistent/);
    await expect(prisma.$executeRaw`UPDATE "exam_simulations" SET "deadline_at" = "started_at" WHERE "id" = ${simulation.simulationId}`).rejects.toThrow(/deadline_after_start/);
  });

  it("records, changes and orders answers by acceptance sequence; the final answer is the last", async () => {
    setNow(0);
    const me = await person("answers");
    const { simulation } = await service.start(me);
    const id = simulation.simulationId;
    const a1 = await answerFor(1);
    await service.answer(me, id, { position: 1, answer: a1.wrong });
    setNow(0); // same millisecond: order must come from the sequence, not the timestamp
    await service.answer(me, id, { position: 1, answer: a1.right });
    const events = await prisma.simulationAnswerEvent.findMany({ where: { simulationId: id }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => [e.sequence, e.position, e.answer])).toEqual([[1, 1, a1.wrong], [2, 1, a1.right]]);
    expect((await service.get(me, id)).questions[0]).toMatchObject({ status: "answered", chosenAnswer: a1.right });
    expect(await code(service.answer(me, id, { position: 1, answer: "definitely-not-an-option" }))).toBe("invalid_answer");
    expect(await code(service.answer(me, id, { position: 9, answer: a1.right }))).toBe("invalid_position");
    expect(await prisma.simulationAnswerEvent.count({ where: { simulationId: id } })).toBe(2);
  });

  it("submit finalizes ONCE with a persisted raw result; repeated and concurrent submits are idempotent", async () => {
    setNow(0);
    const me = await person("submit");
    const { simulation } = await service.start(me);
    const id = simulation.simulationId;
    await service.answer(me, id, { position: 1, answer: (await answerFor(1)).right });
    await service.answer(me, id, { position: 2, answer: (await answerFor(2)).wrong });
    setNow(60_000);
    const many = await Promise.all(Array.from({ length: 10 }, () => service.submit(me, id)));
    expect(many.filter((m) => m.outcome === "submitted")).toHaveLength(1);
    expect(many.filter((m) => m.outcome === "already_submitted")).toHaveLength(9);
    // deep equality, not string equality: Postgres jsonb stores object keys in its own order
    for (const m of many) expect(m.result).toEqual(many[0]!.result);
    const row = await prisma.examSimulation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "submitted", finalizedBy: "student_submit" });
    expect(row.finalizedAt!.toISOString()).toBe(atMs(60_000));
    const result = await service.result(me, id);
    expect(result).toMatchObject({ status: "submitted", scoring: { defined: false }, interpretation: "none", isHistoricalPaper: false });
    expect(result.totals).toEqual({ questionCount: 3, answered: 2, unanswered: 1, correct: 1, incorrect: 1, notGraded: 0 });
    expect(result.timing).toMatchObject({ elapsedSeconds: 60, finalizedBy: "student_submit" });
    expect(row.result).toEqual(JSON.parse(JSON.stringify(result)));
  });

  it("nothing can change after finalization: answers are rejected and the stored state is identical", async () => {
    setNow(0);
    const me = await person("final");
    const { simulation } = await service.start(me);
    await service.answer(me, simulation.simulationId, { position: 1, answer: (await answerFor(1)).right });
    await service.submit(me, simulation.simulationId);
    const before = JSON.stringify(await prisma.examSimulation.findUniqueOrThrow({ where: { id: simulation.simulationId }, include: { events: { orderBy: { sequence: "asc" } } } }));
    setNow(120_000);
    expect((await service.answer(me, simulation.simulationId, { position: 2, answer: (await answerFor(2)).right })).outcome).toBe("rejected_finalized");
    expect((await service.submit(me, simulation.simulationId)).outcome).toBe("already_submitted");
    expect(JSON.stringify(await prisma.examSimulation.findUniqueOrThrow({ where: { id: simulation.simulationId }, include: { events: { orderBy: { sequence: "asc" } } } }))).toBe(before);
  });

  it("the server clock is the only authority: the deadline is exclusive to the millisecond, in the real database", async () => {
    setNow(0);
    const me = await person("deadline");
    const { simulation } = await service.start(me);
    const id = simulation.simulationId;
    setNow(DURATION * 1000 - 1);
    expect((await service.answer(me, id, { position: 1, answer: (await answerFor(1)).right })).outcome).toBe("recorded");
    setNow(DURATION * 1000);
    const late = await service.answer(me, id, { position: 2, answer: (await answerFor(2)).right });
    expect(late.outcome).toBe("rejected_expired");
    const row = await prisma.examSimulation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "expired", finalizedBy: "deadline" });
    expect(row.finalizedAt!.toISOString()).toBe(atMs(DURATION * 1000));
    expect(await prisma.simulationAnswerEvent.count({ where: { simulationId: id } })).toBe(1);
    expect((await service.result(me, id)).questions.map((q) => q.answered)).toEqual([true, false, false]);
  });

  it("submit racing the deadline: 1 ms before is submitted; at the deadline it is expired and the submit is rejected as too late", async () => {
    setNow(0);
    const a = await person("race-a");
    const sa = (await service.start(a)).simulation.simulationId;
    setNow(DURATION * 1000 - 1);
    expect((await service.submit(a, sa)).outcome).toBe("submitted");
    setNow(0);
    const b = await person("race-b");
    const sb = (await service.start(b)).simulation.simulationId;
    setNow(DURATION * 1000);
    const late = await service.submit(b, sb);
    expect(late.outcome).toBe("expired_before_submit");
    expect(late.result).toMatchObject({ status: "expired", timing: { finalizedBy: "deadline", elapsedSeconds: DURATION } });
  });

  it("concurrent answers and submits race safely: no event is accepted after finalization and exactly one finalization exists", async () => {
    setNow(0);
    const me = await person("race-many");
    const { simulation } = await service.start(me);
    const id = simulation.simulationId;
    const [a1, a2, a3] = [await answerFor(1), await answerFor(2), await answerFor(3)];
    setNow(1000);
    await Promise.all([
      service.answer(me, id, { position: 1, answer: a1.right }),
      service.answer(me, id, { position: 2, answer: a2.right }),
      service.submit(me, id),
      service.answer(me, id, { position: 3, answer: a3.right }),
      service.submit(me, id),
      service.answer(me, id, { position: 1, answer: a1.wrong })
    ]);
    const row = await prisma.examSimulation.findUniqueOrThrow({ where: { id }, include: { events: { orderBy: { sequence: "asc" } } } });
    expect(row.status).toBe("submitted");
    const result = row.result as unknown as { totals: { answered: number }; questions: Array<{ position: number; chosenAnswer: string | null }> };
    expect(result.totals.answered).toBe(new Set(row.events.map((e) => e.position)).size);
    for (const q of result.questions) {
      const last = [...row.events].filter((e) => e.position === q.position).pop();
      expect(q.chosenAnswer).toBe(last ? last.answer : null); // the result is exactly the log accepted before finalization
    }
    expect(row.events.map((e) => e.sequence)).toEqual(row.events.map((_, i) => i + 1));
  });

  it("ownership and isolation: another student, another enrollment and an unconfigured exam cannot reach it", async () => {
    setNow(0);
    const owner = await person("owner");
    const other = await person("other");
    const { simulation } = await service.start(owner);
    const id = simulation.simulationId;
    for (const op of [() => service.get(other, id), () => service.getQuestion(other, id, 1), () => service.answer(other, id, { position: 1, answer: "x" }), () => service.submit(other, id), () => service.result(other, id)]) {
      expect(await code(op())).toBe("simulation_not_found");
    }
    expect(await code(service.start({ studentId: other.studentId, enrollmentId: owner.enrollmentId }))).toBe("enrollment_ownership_mismatch");
    expect(await code(service.get({ studentId: owner.studentId, enrollmentId: "no-such-enrollment" }, id))).toBe("enrollment_not_found");
    const otherView = await service.start(other);
    expect(otherView.simulation.simulationId).not.toBe(id);
    expect(otherView.simulation.questions.every((q) => q.status === "unanswered")).toBe(true);
    expect(await new PrismaSimulationQuestionSource(prisma).findPaperCandidates("SOME_OTHER_EXAM", questionIds)).toEqual([]); // exam-scoped: another exam never sees these questions
    const saved = definition;
    definition = null;
    expect(await code(service.start(await person("unconfigured")))).toBe("no_simulation_configured");
    definition = saved;
  });

  it("an active simulation is invisible to, and writes nothing into, practice, training, repair, mastery or autopsy", async () => {
    setNow(0);
    const me = await person("isolation");
    const before = await counts();
    const { simulation } = await service.start(me);
    await service.answer(me, simulation.simulationId, { position: 1, answer: (await answerFor(1)).right });
    await service.get(me, simulation.simulationId);
    expect(await counts()).toEqual(before);
    await service.submit(me, simulation.simulationId);
    expect(await counts()).toEqual(before);
    expect(await prisma.attempt.count({ where: { studentId: me.studentId } })).toBe(0);
  });

  it("never serves or reveals an answer key: keys are read only to finalize, and no output carries one", async () => {
    setNow(0);
    const me = await person("leak");
    keyReads = 0;
    const { simulation } = await service.start(me);
    const id = simulation.simulationId;
    const q = await service.getQuestion(me, id, 1);
    await service.answer(me, id, { position: 1, answer: (await answerFor(1)).right });
    await service.get(me, id);
    expect(keyReads).toBe(0);
    const done = await service.submit(me, id);
    expect(keyReads).toBe(1);
    const key = await prisma.question.findUniqueOrThrow({ where: { id: questionIds[0]! }, select: { solutionSteps: true } });
    const text = JSON.stringify([simulation, q, done.simulation, done.result]);
    for (const secret of ["correctAnswer", "contentFingerprint", "provenance", "sourceType", "solutionSteps", "groundTruth", JSON.stringify(key.solutionSteps).slice(2, 20)]) expect(text, secret).not.toContain(secret);
    expect(q).toEqual({ position: 1, sectionName, prompt: expect.any(String), answerFormat: expect.any(String), options: expect.anything() });
  });

  it("a question edited after the paper was fixed is detected: answering is refused and finalization never grades a different version", async () => {
    setNow(0);
    const me = await person("edited");
    const { simulation } = await service.start(me);
    const id = simulation.simulationId;
    const a2 = await answerFor(2);
    await service.answer(me, id, { position: 2, answer: a2.right });
    const original = await prisma.question.findUniqueOrThrow({ where: { id: questionIds[1]! }, select: { body: true } });
    await prisma.question.update({ where: { id: questionIds[1]! }, data: { body: `${original.body} (edited ${RUN})` } });
    try {
      expect(await code(service.getQuestion(me, id, 2))).toBe("question_content_changed");
      expect(await code(service.answer(me, id, { position: 2, answer: a2.wrong }))).toBe("question_content_changed");
      const done = await service.submit(me, id);
      expect(done.result!.questions[1]).toMatchObject({ answered: true, isCorrect: null, gradingStatus: "question_content_changed" });
      expect(done.result!.totals).toMatchObject({ answered: 1, notGraded: 1, correct: 0, incorrect: 0 });
    } finally {
      await prisma.question.update({ where: { id: questionIds[1]! }, data: { body: original.body } });
    }
  });

  it("recovery after expiry: a stale in-progress simulation is expired on first access and a fresh one can start", async () => {
    setNow(0);
    const me = await person("stale");
    const first = await service.start(me);
    setNow(DURATION * 1000 * 4);
    const second = await service.start(me);
    expect(second.created).toBe(true);
    expect(second.simulation.simulationId).not.toBe(first.simulation.simulationId);
    expect((await service.get(me, first.simulation.simulationId)).status).toBe("expired");
    expect(await prisma.examSimulation.count({ where: { enrollmentId: me.enrollmentId } })).toBe(2);
    expect(await prisma.examSimulation.count({ where: { enrollmentId: me.enrollmentId, status: "in_progress" } })).toBe(1);
  });

  it("this unit's migration is the latest, and it altered no existing table", async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`select migration_name from _prisma_migrations order by migration_name desc limit 1`;
    expect(rows[0]!.migration_name).toBe("0016_exam_simulation");
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`select table_name from information_schema.tables where table_schema = 'public' and table_name like '%simulation%' order by table_name`;
    expect(tables.map((t) => t.table_name)).toEqual(["exam_simulations", "simulation_answer_events", "simulation_questions"]);
  });
});
