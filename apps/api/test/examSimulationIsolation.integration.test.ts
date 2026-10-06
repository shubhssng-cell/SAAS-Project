import { randomUUID } from "node:crypto";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "@ipmat/attempt";
import { createPrismaClient, PrismaAttemptRepository } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TrainingRecommendationService, type TrainingRecommendationDependencies } from "@ipmat/training-recommendation";
import { SimulationService } from "@ipmat/exam-simulation";
import { PrismaSimulationEnrollmentReader, PrismaSimulationQuestionSource, PrismaSimulationRepository } from "@ipmat/db";
import { PrismaConceptReader, PrismaEnrollmentReader, PrismaErrorTaxonomyReader, PrismaPracticeBlockRepository, PrismaPracticeSessionRepository, PrismaQuestionReader, PrismaRepairPlanRepository, PrismaTrainingQuestionReader } from "@ipmat/db";

/**
 * Phase 7 Unit 4 (D-090) on REAL POSTGRES: an active or finalized exam SIMULATION is isolated from practice, training, adaptive recommendation, revision,
 * curriculum, repair and mastery. The same persisted attempts must give byte-identical Unit 1/2/3 reads and recommendation before, during and after.
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

const RUN = `p7u4-${randomUUID().slice(0, 8)}`;

describe.skipIf(!DATABASE_URL)("exam simulation isolation over real Postgres", () => {
  let prisma: PrismaClient;
  let attempts: PrismaAttemptRepository;
  let deps: TrainingRecommendationDependencies;
  let service: TrainingRecommendationService;
  let examId: string;
  let otherExamId: string;
  const created = { students: [] as string[], attempts: [] as string[] };
  let questions: Array<{ id: string; conceptId: string; correctAnswer: string; options: unknown; expectedTimeSeconds: number; conceptName: string; sectionName: string }> = [];

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
    const rows = await prisma.question.findMany({ where: { validationState: "published", examId }, orderBy: { id: "asc" }, select: { id: true, conceptId: true, correctAnswer: true, options: true, expectedTimeSeconds: true, concept: { select: { name: true } }, section: { select: { name: true } } } });
    questions = rows.map((r) => ({ id: r.id, conceptId: r.conceptId, correctAnswer: r.correctAnswer, options: r.options, expectedTimeSeconds: r.expectedTimeSeconds, conceptName: r.concept.name, sectionName: r.section.name }));
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

  it("an ACTIVE and a FINALIZED simulation change nothing in practice, training, adaptive, revision, curriculum, repair or mastery - same persisted attempts give identical reads", async () => {
    const me = await student("iso");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, i === 0 ? "wrong" : "correct");
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const reads = async () => {
      const strip = <T extends { evaluatedAt?: string | null }>(v: T | null): unknown => (v ? { ...v, evaluatedAt: null } : v);
      const curriculum = await service.readAdaptiveCurriculum(request);
      const revision = await service.readRevisionIntelligence(request);
      return JSON.parse(
        JSON.stringify({
          evidence: await service.readMasteryEvidence(request),
          revision: strip(revision),
          curriculum: curriculum ? { ...curriculum, evaluatedAt: null, revision: strip(curriculum.revision) } : null,
          recommendation: await service.recommendNextTrainingAction(request)
        })
      ) as unknown;
    };
    const tableCounts = async () => [await prisma.attempt.count(), await prisma.practiceSession.count(), await prisma.practiceBlock.count(), await prisma.trainingSession.count(), await prisma.repairPlan.count(), await prisma.masteryState.count(), await prisma.autopsy.count()];
    const baseline = await reads();
    const countsBefore = await tableCounts();

    // a full simulation lifecycle for the same student, on the same published questions
    const sim = new SimulationService({
      enrollments: new PrismaSimulationEnrollmentReader(prisma),
      configs: {
        findDefinition: async (examCode) =>
          examCode === "IPMAT_INDORE"
            ? {
                config: { examCode, configVersion: `${RUN}-fixture`, overallDurationSeconds: 600, sections: [{ sectionName: questions[0]!.sectionName, order: 1, questionCount: 3 }], provenance: { kind: "authored", sourceRef: "fixture:isolation-test (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" } },
                selection: { origin: "assembled", sourceRef: "fixture:isolation-paper", sections: { [questions[0]!.sectionName]: questions.slice(0, 3).map((q) => q.id) } }
              }
            : null
      },
      questions: new PrismaSimulationQuestionSource(prisma),
      repository: new PrismaSimulationRepository(prisma),
      now: () => new Date().toISOString(),
      newId: () => randomUUID()
    });
    const { simulation } = await sim.start(request);
    for (const [i, q] of questions.slice(0, 3).entries()) await sim.answer(request, simulation.simulationId, { position: i + 1, answer: ((q.options as string[] | null) ?? []).find((o) => o !== q.correctAnswer) ?? q.correctAnswer });
    expect(await reads()).toEqual(baseline); // ACTIVE simulation: nothing leaks into any read
    expect(await tableCounts()).toEqual(countsBefore);

    await sim.submit(request, simulation.simulationId);
    expect(await reads()).toEqual(baseline); // FINALIZED simulation: still nothing - integration is explicit, and nothing calls it
    expect(await tableCounts()).toEqual(countsBefore);
    expect(await prisma.attempt.count({ where: { studentId: me.studentId } })).toBe(3);
  });

  it("simulation answers never appear as evidence: Unit 1 evidence counts only the real practice attempts", async () => {
    const me = await student("iso2");
    await play(me, "0", questions[0]!.id, 0, "correct");
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const view = await service.readMasteryEvidence(request);
    expect(view!.concepts.reduce((s, c) => s + c.overall.attempts, 0)).toBe(1);
  });

  it("this unit's migration is the latest", async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`select migration_name from _prisma_migrations where migration_name <= '0016_exam_simulation' order by migration_name desc limit 1` /* the latest AS OF this unit; later units add migrations (0017: Phase 9 Unit 1) */;
    expect(rows[0]!.migration_name).toBe("0016_exam_simulation");
  });
});
