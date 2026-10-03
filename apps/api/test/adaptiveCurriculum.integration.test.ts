import { randomUUID } from "node:crypto";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "@ipmat/attempt";
import { createPrismaClient, PrismaAttemptRepository } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeAdaptiveCurriculum, TrainingRecommendationService, type TrainingRecommendationDependencies } from "@ipmat/training-recommendation";
import { PrismaConceptReader, PrismaEnrollmentReader, PrismaErrorTaxonomyReader, PrismaExamIntelligenceSource, PrismaPracticeBlockRepository, PrismaPracticeSessionRepository, PrismaQuestionReader, PrismaRepairPlanRepository, PrismaTrainingQuestionReader } from "@ipmat/db";

/**
 * Phase 7 Unit 3 (D-089) on REAL POSTGRES: the adaptive curriculum view derived from persisted attempts through the real Prisma repositories, the real
 * orchestrator and providers, and the real Phase 6 Exam Intelligence source. Orchestration only - no verdict, score, ranking or invented sequence - and no route reads it.
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

const RUN = `p7u3-${randomUUID().slice(0, 8)}`;

describe.skipIf(!DATABASE_URL)("adaptive curriculum over real Postgres", () => {
  let prisma: PrismaClient;
  let attempts: PrismaAttemptRepository;
  let deps: TrainingRecommendationDependencies;
  let service: TrainingRecommendationService;
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
  const t = (n: number): string => new Date(Date.parse("2026-08-01T10:00:00.000Z") + n * 1000).toISOString();
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
    const repairPlans = new PrismaRepairPlanRepository(prisma);
    deps = {
      enrollmentReader: new PrismaEnrollmentReader(prisma),
      attemptHistoryReader: attempts,
      repairPlanReader: repairPlans,
      errorTaxonomyReader: new PrismaErrorTaxonomyReader(prisma),
      trainingQuestionReader: new PrismaTrainingQuestionReader(prisma),
      questionReader: new PrismaQuestionReader(prisma),
      conceptReader: new PrismaConceptReader(prisma),
      practiceSessionReader: new PrismaPracticeSessionRepository(prisma),
      practiceBlockReader: new PrismaPracticeBlockRepository(prisma)
    };
    service = new TrainingRecommendationService(deps);
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

  it("composes the real orchestrator next action, the chain, Unit 1 evidence and Unit 2 intelligence from persisted attempts", async () => {
    const me = await student("a");
    const ids: string[] = [];
    for (const [i, q] of questions.slice(0, 3).entries()) ids.push(await play(me, String(i), q.id, i * 100, i === 0 ? "wrong" : "correct"));
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const direct = await service.recommendNextTrainingAction(request);
    const c = await service.readAdaptiveCurriculum(request);
    expect(c).not.toBeNull();
    expect(c!.status).toBe("evidence_based_no_verdict");
    expect(c!.examCode).toBe("IPMAT_INDORE");
    expect(c!.sequencing.definedBeyondExistingChain).toBe(false);
    expect(c!.chain.map((x) => x.id)).toEqual(["targeted_repair", "trap-lab", "calculation-gym", "speed-lab", "pressure-training", "novelty-training", "adaptive_practice"]);
    if (direct.status === "selected") {
      expect(c!.nextAction.status).toBe("selected");
      expect(c!.nextAction.status === "selected" && c!.nextAction.question.questionId).toBe(direct.question.questionId);
    } else {
      expect(c!.nextAction.status).toBe("no_action");
    }
    const concept = c!.concepts.find((x) => x.conceptName === questions[0]!.conceptName)!;
    expect([...concept.evidence.overall.contributingAttemptIds].sort()).toEqual([...ids].sort());
    expect(concept.publishedQuestionsInPool).toBeGreaterThanOrEqual(3);
    expect(c!.revision.signals.some((s) => s.kind === "dormant_concept")).toBe(true);
    expect(c!.steps.find((s) => s.systemId === "revision")).toMatchObject({ chainOrder: null, outsideAdaptiveChain: true });
    expect(c!.steps.filter((s) => s.isOrchestratorNextAction).length).toBeLessThanOrEqual(1);
    for (const s of c!.steps) expect(questions.map((q) => q.id)).toContain(s.question.questionId);
  });

  it("attaches REAL Phase 6 content availability when the Exam Intelligence source is supplied, without changing what is selected", async () => {
    const me = await student("p6");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const plain = (await composeAdaptiveCurriculum(deps, request))!;
    const withP6 = (await composeAdaptiveCurriculum({ ...deps, examIntelligenceSource: new PrismaExamIntelligenceSource(prisma) }, request))!;
    expect(plain.concepts.every((x) => x.contentAvailability === null)).toBe(true);
    const concept = withP6.concepts.find((x) => x.conceptName === questions[0]!.conceptName)!;
    expect(concept.contentAvailability).not.toBeNull();
    expect(concept.contentAvailability!.published).toBeGreaterThanOrEqual(3);
    expect(concept.contentAvailability!.available).toBeGreaterThanOrEqual(concept.contentAvailability!.validated);
    expect(concept.contentAvailability!.validated).toBeGreaterThanOrEqual(concept.contentAvailability!.published);
    expect(withP6.nextAction).toEqual(plain.nextAction);
    expect(withP6.steps).toEqual(plain.steps);
  });

  it("is reproducible and read-only: identical on repeat, and no attempt, mastery or repair row is written", async () => {
    const me = await student("b");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    const counts = async () => [await prisma.attempt.count(), await prisma.masteryState.count(), await prisma.repairPlan.count()];
    const before = await counts();
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const first = await service.readAdaptiveCurriculum(request);
    const second = await service.readAdaptiveCurriculum(request);
    // the service reads the system clock for `now`, so `evaluatedAt` differs between calls; with the same `now` the result is identical (domain tests)
    const strip = (v: typeof first) => ({ ...v!, evaluatedAt: null, revision: { ...v!.revision, evaluatedAt: null } });
    expect(strip(second)).toEqual(strip(first));
    expect(await counts()).toEqual(before);
  });

  it("student isolation: another student attempts never appear, and the claimant must own the enrollment", async () => {
    const a = await student("iso-a");
    const b = await student("iso-b");
    const mine: string[] = [];
    for (const [i, q] of questions.slice(0, 3).entries()) mine.push(await play(a, `a${i}`, q.id, i * 100, "correct"));
    const theirs = await play(b, "b0", questions[0]!.id, 50, "wrong");
    const viewA = await service.readAdaptiveCurriculum({ studentId: a.studentId, enrollmentId: a.enrollmentId });
    const viewB = await service.readAdaptiveCurriculum({ studentId: b.studentId, enrollmentId: b.enrollmentId });
    expect(JSON.stringify(viewA)).not.toContain(theirs);
    expect(JSON.stringify(viewA)).not.toContain(b.studentId);
    expect(JSON.stringify(viewB)).not.toContain(mine[0]!);
    await expect(service.readAdaptiveCurriculum({ studentId: a.studentId, enrollmentId: b.enrollmentId })).rejects.toMatchObject({ code: "enrollment_ownership_mismatch" });
  });

  it("exam isolation: an enrollment in an exam with no published pool gets null, never IPMAT data", async () => {
    const s = await prisma.student.create({ data: { authRef: `${RUN}-x` } });
    created.students.push(s.id);
    const e = await prisma.enrollment.create({ data: { studentId: s.id, examId: otherExamId, enrolledAt: new Date("2026-09-01T00:00:00Z") } });
    expect(await service.readAdaptiveCurriculum({ studentId: s.id, enrollmentId: e.id })).toBeNull();
  });

  it("never exposes the answer key, question text, another student or the enrollment id", async () => {
    const me = await student("leak");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    const text = JSON.stringify(await service.readAdaptiveCurriculum({ studentId: me.studentId, enrollmentId: me.enrollmentId }));
    const q = await prisma.question.findUniqueOrThrow({ where: { id: questions[0]!.id }, select: { body: true, correctAnswer: true } });
    for (const secret of [q.body.slice(0, 40), `"${q.correctAnswer}"`, "correctAnswer", "solutionSteps", me.enrollmentId]) expect(text, secret).not.toContain(secret);
  });

  it("this unit added no migration: the latest migration is still Content Intelligence", async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`select migration_name from _prisma_migrations order by migration_name desc limit 1`;
    expect(rows[0]!.migration_name).toBe("0015_content_intelligence");
  });
});
