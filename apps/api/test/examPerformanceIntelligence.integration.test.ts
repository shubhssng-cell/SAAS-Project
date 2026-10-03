import { randomUUID } from "node:crypto";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt } from "@ipmat/attempt";
import { createPrismaClient, PrismaAttemptRepository } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeExamPerformanceIntelligence, TrainingRecommendationService, type TrainingRecommendationDependencies } from "@ipmat/training-recommendation";
import { SimulationService } from "@ipmat/exam-simulation";
import { PrismaFinalizedSimulationReader, PrismaSimulationEnrollmentReader, PrismaSimulationQuestionSource, PrismaSimulationRepository } from "@ipmat/db";
import { PrismaConceptReader, PrismaEnrollmentReader, PrismaErrorTaxonomyReader, PrismaExamIntelligenceSource, PrismaPracticeBlockRepository, PrismaPracticeSessionRepository, PrismaQuestionReader, PrismaRepairPlanRepository, PrismaTrainingQuestionReader } from "@ipmat/db";

/**
 * Phase 7 Unit 5 (D-091) on REAL POSTGRES: exam-performance / readiness EVIDENCE built from REAL finalized simulations (the Unit 4 engine over the real
 * Prisma repository) together with real persisted practice attempts, the real Unit 1-3 reads and the real Phase 6 source. Evidence only - no score, percentage,
 * probability, category or verdict - and no route reads it.
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

const RUN = `p7u5-${randomUUID().slice(0, 8)}`;

describe.skipIf(!DATABASE_URL)("exam performance intelligence over real Postgres", () => {
  let prisma: PrismaClient;
  let attempts: PrismaAttemptRepository;
  let deps: TrainingRecommendationDependencies;
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

  // a real Unit 4 simulation service over the real Prisma repository, with a labelled FIXTURE configuration (not an exam rule)
  const makeSim = (clock: { now: string }): SimulationService =>
    new SimulationService({
      enrollments: new PrismaSimulationEnrollmentReader(prisma),
      configs: {
        findDefinition: async (examCode) =>
          examCode === "IPMAT_INDORE"
            ? {
                config: { examCode, configVersion: `${RUN}-fixture`, overallDurationSeconds: 600, sections: [{ sectionName: questions[0]!.sectionName, order: 1, questionCount: 3 }], provenance: { kind: "authored", sourceRef: "fixture:readiness-evidence-test (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" } },
                selection: { origin: "assembled", sourceRef: "fixture:readiness-paper", sections: { [questions[0]!.sectionName]: questions.slice(0, 3).map((q) => q.id) } }
              }
            : null
      },
      questions: new PrismaSimulationQuestionSource(prisma),
      repository: new PrismaSimulationRepository(prisma),
      now: () => clock.now,
      newId: () => randomUUID()
    });
  const rightOf = (q: (typeof questions)[number]): string => q.correctAnswer;
  const wrongOf = (q: (typeof questions)[number]): string => ((q.options as string[] | null) ?? []).find((o) => o !== q.correctAnswer) ?? q.correctAnswer;
  const simTime = (ms: number): string => new Date(Date.parse("2026-10-03T10:00:00.000Z") + ms).toISOString();

  /** Runs one full simulation through the REAL engine and returns its id; `end: "deadline"` lets the deadline finalize it. */
  async function runSimulation(who: { studentId: string; enrollmentId: string }, startMs: number, answers: Record<number, "right" | "wrong">, end: "submit" | "deadline" = "submit"): Promise<string> {
    const clock = { now: simTime(startMs) };
    const sim = makeSim(clock);
    const { simulation } = await sim.start(who);
    for (const [position, which] of Object.entries(answers)) {
      clock.now = simTime(startMs + Number(position) * 1000);
      const q = questions[Number(position) - 1]!;
      await sim.answer(who, simulation.simulationId, { position: Number(position), answer: which === "right" ? rightOf(q) : wrongOf(q) });
    }
    clock.now = simTime(startMs + (end === "deadline" ? 605_000 : 10_000));
    await (end === "deadline" ? sim.get(who, simulation.simulationId) : sim.submit(who, simulation.simulationId));
    return simulation.simulationId;
  }
  const finalizedReader = (): PrismaFinalizedSimulationReader => new PrismaFinalizedSimulationReader(prisma);
  const withSims = (): TrainingRecommendationDependencies => ({ ...deps, finalizedSimulationReader: finalizedReader() });

  it("the Prisma reader returns ONLY finalized simulations (submitted and expired) of that student and exam, oldest first - never an active one", async () => {
    const me = await student("reader");
    const other = await student("reader-other");
    const first = await runSimulation(me, 0, { 1: "right" });
    const expired = await runSimulation(me, 3_600_000, { 1: "wrong" }, "deadline");
    const clock = { now: simTime(7_200_000) };
    const active = (await makeSim(clock).start(me)).simulation.simulationId; // still in progress
    await runSimulation(other, 0, { 1: "right" });
    const states = await finalizedReader().findFinalizedByStudentAndExam(me.studentId, "IPMAT_INDORE");
    expect(states.map((s) => s.id)).toEqual([first, expired]);
    expect(states.map((s) => s.status)).toEqual(["submitted", "expired"]);
    expect(states.map((s) => s.id)).not.toContain(active);
    expect(states.every((s) => s.studentId === me.studentId && s.result !== null)).toBe(true);
    expect(await finalizedReader().findFinalizedByStudentAndExam(me.studentId, "NO_SUCH_EXAM")).toEqual([]);
  });

  it("composes REAL finalized simulations with real Units 1-3 into the five readiness distinctions; an active simulation is excluded; no score exists", async () => {
    const me = await student("compose");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, i === 0 ? "wrong" : "correct");
    const a = await runSimulation(me, 0, { 1: "right", 2: "wrong" });
    const b = await runSimulation(me, 3_600_000, { 1: "right", 2: "right", 3: "right" });
    const c = await runSimulation(me, 7_200_000, { 1: "right" }, "deadline");
    const activeId = (await makeSim({ now: simTime(10_800_000) }).start(me)).simulation.simulationId;
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const r = (await composeExamPerformanceIntelligence(withSims(), request))!;
    expect(r).toMatchObject({ status: "evidence_only_readiness_unspecified", examCode: "IPMAT_INDORE", simulationCount: 3, readiness: { defined: false } });
    expect(r.simulations.map((s) => [s.simulationId, s.status])).toEqual([[a, "submitted"], [b, "submitted"], [c, "expired"]]);
    expect(JSON.stringify(r)).not.toContain(activeId);
    expect(r.comparisons.groups).toHaveLength(1);
    expect(r.comparisons.groups[0]!.simulationIds).toEqual([a, b, c]);
    expect(r.comparisons.groups[0]!.series.find((s) => s.measure === "correct")!.values.map((v) => v.value)).toEqual([1, 3, 1]);
    expect(r.observations.some((o) => o.kind === "simulation_ended_by_deadline" && o.simulationIds[0] === c)).toBe(true);
    const concept = r.concepts.find((x) => x.conceptName === questions[0]!.conceptName)!;
    expect(concept.conceptMastery.practice.gradedAttempts).toBe(3);
    expect(concept.conceptMastery.simulation.appearances).toBe(9);
    expect(concept.conceptMastery.interpretation).toBe("none");
    expect(concept.performanceAxes.pressurePerformance.simulationCountedAsPressure).toBe("undefined");
    expect(r.unresolved.length).toBeGreaterThanOrEqual(8);
  });

  it("Units 1, 2 and 3 and the recommendation are byte-identical with and without finalized simulations: simulation data feeds none of them", async () => {
    const me = await student("units");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const reads = async (d: TrainingRecommendationDependencies) => {
      const svc = new TrainingRecommendationService(d);
      const strip = <T extends { evaluatedAt?: string | null }>(v: T | null): unknown => (v ? { ...v, evaluatedAt: null } : v);
      const curriculum = await svc.readAdaptiveCurriculum(request);
      return JSON.parse(JSON.stringify({ evidence: await svc.readMasteryEvidence(request), revision: strip(await svc.readRevisionIntelligence(request)), curriculum: curriculum ? { ...curriculum, evaluatedAt: null, revision: strip(curriculum.revision) } : null, recommendation: await svc.recommendNextTrainingAction(request) })) as unknown;
    };
    const baseline = await reads(deps);
    await runSimulation(me, 0, { 1: "wrong", 2: "wrong", 3: "wrong" });
    await runSimulation(me, 3_600_000, { 1: "right" });
    expect(await reads(withSims())).toEqual(baseline);
    expect(await reads(deps)).toEqual(baseline);
  });

  it("is read-only and reproducible: identical on repeat, and no attempt, simulation, mastery, repair or practice row is written", async () => {
    const me = await student("readonly");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    await runSimulation(me, 0, { 1: "right" });
    const counts = async () => [await prisma.attempt.count(), await prisma.examSimulation.count(), await prisma.simulationAnswerEvent.count(), await prisma.masteryState.count(), await prisma.repairPlan.count(), await prisma.practiceSession.count(), await prisma.trainingSession.count()];
    const before = await counts();
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const first = await composeExamPerformanceIntelligence(withSims(), request);
    const second = await composeExamPerformanceIntelligence(withSims(), request);
    expect(second).toEqual(first);
    expect(await counts()).toEqual(before);
  });

  it("student, enrollment and exam isolation: another student's simulations never appear, the claimant must own the enrollment, and an exam with no pool gets null", async () => {
    const a = await student("iso-a");
    const b = await student("iso-b");
    const mine = await runSimulation(a, 0, { 1: "right" });
    const theirs = await runSimulation(b, 0, { 1: "wrong" });
    const viewA = (await composeExamPerformanceIntelligence(withSims(), { studentId: a.studentId, enrollmentId: a.enrollmentId }))!;
    const viewB = (await composeExamPerformanceIntelligence(withSims(), { studentId: b.studentId, enrollmentId: b.enrollmentId }))!;
    expect(viewA.simulations.map((s) => s.simulationId)).toEqual([mine]);
    expect(viewB.simulations.map((s) => s.simulationId)).toEqual([theirs]);
    expect(JSON.stringify(viewA)).not.toContain(theirs);
    expect(JSON.stringify(viewA)).not.toContain(b.studentId);
    await expect(composeExamPerformanceIntelligence(withSims(), { studentId: a.studentId, enrollmentId: b.enrollmentId })).rejects.toMatchObject({ code: "enrollment_ownership_mismatch" });
    const s = await prisma.student.create({ data: { authRef: `${RUN}-x` } });
    created.students.push(s.id);
    const e = await prisma.enrollment.create({ data: { studentId: s.id, examId: otherExamId, enrolledAt: new Date("2026-09-01T00:00:00Z") } });
    expect(await composeExamPerformanceIntelligence(withSims(), { studentId: s.id, enrollmentId: e.id })).toBeNull();
  });

  it("attaches REAL Phase 6 content availability and reviewed-historical-record counts, separate from performance and never a forecast", async () => {
    const me = await student("p6");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    await runSimulation(me, 0, { 1: "right" });
    const request = { studentId: me.studentId, enrollmentId: me.enrollmentId };
    const plain = (await composeExamPerformanceIntelligence(withSims(), request))!;
    const withP6 = (await composeExamPerformanceIntelligence({ ...withSims(), examIntelligenceSource: new PrismaExamIntelligenceSource(prisma) }, request))!;
    const c = withP6.concepts.find((x) => x.conceptName === questions[0]!.conceptName)!;
    expect(c.examContent.contentAvailability!.published).toBeGreaterThanOrEqual(3);
    expect(c.examContent.historicalRecordsObserved).toBe(0); // the repository holds no real historical data
    expect(plain.concepts.every((x) => x.examContent.contentAvailability === null)).toBe(true);
    expect(withP6.simulations).toEqual(plain.simulations);
    expect(withP6.dimensions).toEqual(plain.dimensions);
  });

  it("never exposes an answer key, a chosen answer, question text, another student or the enrollment id", async () => {
    const me = await student("leak");
    for (const [i, q] of questions.slice(0, 3).entries()) await play(me, String(i), q.id, i * 100, "correct");
    await runSimulation(me, 0, { 1: "right", 2: "wrong" });
    const text = JSON.stringify(await composeExamPerformanceIntelligence(withSims(), { studentId: me.studentId, enrollmentId: me.enrollmentId }));
    const q = await prisma.question.findUniqueOrThrow({ where: { id: questions[0]!.id }, select: { body: true, correctAnswer: true, solutionSteps: true } });
    for (const secret of [q.body.slice(0, 40), `"${q.correctAnswer}"`, `"${wrongOf(questions[1]!)}"`, "correctAnswer", "chosenAnswer", "solutionSteps", "contentFingerprint", me.enrollmentId, JSON.stringify(q.solutionSteps).slice(2, 20)]) expect(text, secret).not.toContain(secret);
    // the report's own disclaimers say "no probability/percentage exists"; what must never appear is a forecast or a judgment
    expect(text).not.toMatch(/will pass|will clear|likely to|chance of|almost ready|not ready|is ready/i);
  });

  it("this unit added no migration: the latest is still the exam simulation one", async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`select migration_name from _prisma_migrations order by migration_name desc limit 1`;
    expect(rows[0]!.migration_name).toBe("0016_exam_simulation");
  });
});
