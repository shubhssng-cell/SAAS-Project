import { computeContentFingerprint } from "@ipmat/content-authoring";
import {
  applyMutation,
  type AnswerKey,
  type PaperCandidate,
  type SimulationConfig,
  type SimulationEnrollment,
  type SimulationEnrollmentReader,
  type SimulationMutation,
  type SimulationQuestionContent,
  type SimulationQuestionSource,
  type SimulationRepository,
  type SimulationResult,
  type SimulationState
} from "@ipmat/exam-simulation";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Persistent adapters for the Full Exam Simulation engine (docs/DECISIONS.md D-090).
 *
 * Race safety: every operation on one simulation runs in a transaction that first takes `SELECT ... FOR UPDATE` on its row,
 * so an answer, a submit, an expiry and a duplicate request are serialized. The decision (accept, reject, finalize) is made
 * by the pure engine against the locked, current state; this adapter only applies the mutation it returns. A finalization
 * is a conditional update (`WHERE status = 'in_progress'`) and a CHECK constraint ties the finalization fields to the status,
 * so a second finalization is impossible at the database level too.
 *
 * Isolation from practice: nothing here reads or writes an attempt, practice session/block, repair, mastery, revision or
 * training row.
 */

type Tx = Prisma.TransactionClient;

async function loadState(db: PrismaClient | Tx, simulationId: string): Promise<SimulationState | null> {
  const row = await db.examSimulation.findUnique({
    where: { id: simulationId },
    include: { exam: { select: { code: true } }, questions: { orderBy: { position: "asc" } }, events: { orderBy: { sequence: "asc" } } }
  });
  if (!row) return null;
  const finalized = row.status !== "in_progress";
  return {
    id: row.id,
    studentId: row.studentId,
    enrollmentId: row.enrollmentId,
    examCode: row.exam.code,
    config: row.config as unknown as SimulationConfig,
    paper: {
      origin: "assembled",
      isHistoricalPaper: false,
      sourceRef: row.paperSourceRef,
      questions: row.questions.map((q) => ({ position: q.position, sectionName: q.sectionName, questionId: q.questionId, contentFingerprint: q.contentFingerprint, provenanceSourceType: q.provenanceSourceType }))
    },
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    deadlineAt: row.deadlineAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    finalizedBy: finalized ? (row.finalizedBy as SimulationState["finalizedBy"]) : null,
    events: row.events.map((e) => ({ position: e.position, answer: e.answer, occurredAt: e.occurredAt.toISOString() })),
    result: row.result ? (row.result as unknown as SimulationResult) : null
  };
}

export class PrismaSimulationRepository implements SimulationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(state: SimulationState): Promise<"created" | "in_progress_exists"> {
    const exam = await this.prisma.exam.findUniqueOrThrow({ where: { code: state.examCode }, select: { id: true } });
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.examSimulation.create({
          data: {
            id: state.id,
            studentId: state.studentId,
            enrollmentId: state.enrollmentId,
            examId: exam.id,
            configVersion: state.config.configVersion,
            config: state.config as unknown as Prisma.InputJsonValue,
            paperOrigin: state.paper.origin,
            paperSourceRef: state.paper.sourceRef,
            status: "in_progress",
            startedAt: new Date(state.startedAt),
            deadlineAt: new Date(state.deadlineAt)
          }
        });
        await tx.simulationQuestion.createMany({
          data: state.paper.questions.map((q) => ({ simulationId: state.id, position: q.position, sectionName: q.sectionName, questionId: q.questionId, contentFingerprint: q.contentFingerprint, provenanceSourceType: q.provenanceSourceType }))
        });
      });
      return "created";
    } catch (error) {
      // The partial unique index allows one in-progress simulation per enrollment: losing that race is not an error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && (await this.findInProgressForEnrollment(state.enrollmentId))) return "in_progress_exists";
      throw error;
    }
  }

  async load(simulationId: string): Promise<SimulationState | null> {
    return loadState(this.prisma, simulationId);
  }

  async findInProgressForEnrollment(enrollmentId: string): Promise<SimulationState | null> {
    const row = await this.prisma.examSimulation.findFirst({ where: { enrollmentId, status: "in_progress" }, select: { id: true } });
    return row ? loadState(this.prisma, row.id) : null;
  }

  async transact<T>(simulationId: string, decide: (current: SimulationState) => Promise<{ mutation: SimulationMutation; outcome: T }>): Promise<{ state: SimulationState; outcome: T } | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "exam_simulations" WHERE "id" = ${simulationId} FOR UPDATE`;
        if (locked.length === 0) return null;
        const current = await loadState(tx, simulationId);
        if (!current) return null;
        const { mutation, outcome } = await decide(current);
        await this.apply(tx, current, mutation);
        return { state: applyMutation(current, mutation), outcome };
      },
      { timeout: 20_000, maxWait: 10_000 }
    );
  }

  private async apply(tx: Tx, current: SimulationState, mutation: SimulationMutation): Promise<void> {
    if (mutation.kind === "none") return;
    if (mutation.kind === "append_event") {
      await tx.simulationAnswerEvent.create({
        data: { simulationId: current.id, position: mutation.event.position, sequence: current.events.length + 1, answer: mutation.event.answer, occurredAt: new Date(mutation.event.occurredAt) }
      });
      return;
    }
    const updated = await tx.examSimulation.updateMany({
      where: { id: current.id, status: "in_progress" },
      data: { status: mutation.status, finalizedAt: new Date(mutation.finalizedAt), finalizedBy: mutation.finalizedBy, result: mutation.result as unknown as Prisma.InputJsonValue }
    });
    if (updated.count !== 1) throw new Error("A simulation can be finalized only once.");
  }
}

/** Joins the enrollment to its exam CODE (the engine's exam identity); never returns anything else about the student. */
export class PrismaSimulationEnrollmentReader implements SimulationEnrollmentReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(enrollmentId: string): Promise<SimulationEnrollment | null> {
    const row = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true, studentId: true, exam: { select: { code: true } } } });
    return row ? { id: row.id, studentId: row.studentId, examCode: row.exam.code } : null;
  }
}

const stringOptions = (value: unknown): string[] | null => (Array.isArray(value) && value.length > 0 ? value.map(String) : null);

/**
 * Question access for simulations. The three methods are deliberately separate: candidates and content never select
 * `correct_answer` (nor solution steps); only `findAnswerKeys` does, and it is called only at finalization. Every read is
 * scoped by exam code, so another exam's question can never enter a paper or be served.
 */
export class PrismaSimulationQuestionSource implements SimulationQuestionSource {
  constructor(private readonly prisma: PrismaClient) {}

  async findPaperCandidates(examCode: string, questionIds: readonly string[]): Promise<PaperCandidate[]> {
    const rows = await this.prisma.question.findMany({
      where: { id: { in: [...questionIds] }, exam: { code: examCode } },
      select: { id: true, validationState: true, body: true, options: true, section: { select: { name: true } }, provenance: { select: { sourceType: true } } }
    });
    return rows
      .map((r) => ({
        questionId: r.id,
        examCode,
        sectionName: r.section.name,
        validationState: r.validationState,
        sourceType: r.provenance?.sourceType ?? null,
        contentFingerprint: computeContentFingerprint(examCode, r.body, stringOptions(r.options) ?? [])
      }))
      .sort((a, b) => (a.questionId < b.questionId ? -1 : 1));
  }

  async findPublishedContent(examCode: string, questionIds: readonly string[]): Promise<SimulationQuestionContent[]> {
    const rows = await this.prisma.question.findMany({
      where: { id: { in: [...questionIds] }, validationState: "published", exam: { code: examCode } },
      select: { id: true, body: true, options: true }
    });
    return rows.map((r) => {
      const options = stringOptions(r.options);
      return { questionId: r.id, prompt: r.body, answerFormat: options !== null ? ("multiple_choice" as const) : ("numeric_entry" as const), options, contentFingerprint: computeContentFingerprint(examCode, r.body, options ?? []) };
    });
  }

  async findAnswerKeys(questionIds: readonly string[]): Promise<AnswerKey> {
    const rows = await this.prisma.question.findMany({ where: { id: { in: [...questionIds] } }, select: { id: true, correctAnswer: true, body: true, options: true, exam: { select: { code: true } } } });
    const out: Record<string, { correctAnswer: string; contentFingerprint: string }> = {};
    for (const r of rows) out[r.id] = { correctAnswer: r.correctAnswer, contentFingerprint: computeContentFingerprint(r.exam.code, r.body, stringOptions(r.options) ?? []) };
    return out;
  }
}
