import type { PrismaClient } from "@prisma/client";
import { createPracticeBlock, type PracticeBlockState } from "@ipmat/practice-block";
import { PersistenceError } from "./errors.js";
import { PrismaPracticeBlockRepository } from "./prismaPracticeBlockRepository.js";
import { runSerializableTransaction } from "./serializable.js";
import type { StoredTrainingSession, TrainingSessionRepository } from "./types.js";

const INCLUDE_CHAIN = { practiceBlock: { include: { practiceSession: { include: { enrollment: true } } } } } as const;

type Row = {
  id: string;
  systemId: string;
  objective: unknown;
  config: unknown;
  createdAt: Date;
  practiceBlock: {
    id: string;
    practiceSessionId: string;
    sequenceNumber: number;
    status: PracticeBlockState["status"];
    startedAt: Date;
    endedAt: Date | null;
    targetQuestionCount: number | null;
    blockTimeBudgetSeconds: number | null;
    practiceSession: { enrollment: { id: string; studentId: string } };
  };
};

function toStored(row: Row): StoredTrainingSession {
  const block = row.practiceBlock;
  return {
    id: row.id,
    systemId: row.systemId,
    objective: row.objective,
    config: row.config,
    enrollmentId: block.practiceSession.enrollment.id,
    studentId: block.practiceSession.enrollment.studentId,
    block: {
      id: block.id,
      practiceSessionId: block.practiceSessionId,
      sequenceNumber: block.sequenceNumber,
      status: block.status,
      startedAt: block.startedAt.toISOString(),
      endedAt: block.endedAt ? block.endedAt.toISOString() : null,
      targetQuestionCount: block.targetQuestionCount,
      blockTimeBudgetSeconds: block.blockTimeBudgetSeconds
    },
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * The ONE database-backed `TrainingSessionRepository` (docs/DECISIONS.md D-075). `create()` is a
 * single `Serializable` transaction -- practice session, block and training-session row are all
 * written, or none are -- so a crash can never leave an orphan block. Lifecycle changes are
 * delegated to `PrismaPracticeBlockRepository` (which runs `@ipmat/practice-block`'s own pure
 * transition functions); this class adds no lifecycle rules of its own.
 */
export class PrismaTrainingSessionRepository implements TrainingSessionRepository {
  private readonly blocks: PrismaPracticeBlockRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.blocks = new PrismaPracticeBlockRepository(prisma);
  }

  async create(input: Parameters<TrainingSessionRepository["create"]>[0]): Promise<StoredTrainingSession> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const enrollment = await tx.enrollment.findUnique({ where: { id: input.enrollmentId } });
      if (!enrollment) {
        throw new PersistenceError("missing_reference", `No Enrollment found with id "${input.enrollmentId}".`);
      }

      const alreadyActive = await tx.trainingSession.findFirst({
        where: { practiceBlock: { status: "active", practiceSession: { enrollmentId: input.enrollmentId } } },
        select: { id: true }
      });
      if (alreadyActive) {
        throw new PersistenceError("conflict", "This enrollment already has an active training session.");
      }

      // The partial unique index (migration 0012) is the hard guarantee of one active session per enrollment.
      const existing = await tx.practiceSession.findFirst({ where: { enrollmentId: input.enrollmentId, status: "active" }, orderBy: { id: "asc" } });
      const practiceSessionId =
        existing?.id ?? (await tx.practiceSession.create({ data: { id: input.practiceSessionId, enrollmentId: input.enrollmentId, startedAt: new Date(input.now) } })).id;

      const maxRow = await tx.practiceBlock.aggregate({ where: { practiceSessionId }, _max: { sequenceNumber: true } });
      const block = createPracticeBlock({
        id: input.practiceBlockId,
        practiceSessionId,
        sequenceNumber: (maxRow._max.sequenceNumber ?? 0) + 1,
        now: input.now,
        sessionIsActive: true,
        targetQuestionCount: input.blockSettings.targetQuestionCount,
        blockTimeBudgetSeconds: input.blockSettings.blockTimeBudgetSeconds
      });
      await tx.practiceBlock.create({
        data: {
          id: block.id,
          practiceSessionId: block.practiceSessionId,
          sequenceNumber: block.sequenceNumber,
          startedAt: new Date(block.startedAt),
          targetQuestionCount: block.targetQuestionCount,
          blockTimeBudgetSeconds: block.blockTimeBudgetSeconds
        }
      });
      const created = await tx.trainingSession.create({
        data: { id: input.id, practiceBlockId: block.id, systemId: input.systemId, objective: input.objective as object, config: input.config as object },
        include: INCLUDE_CHAIN
      });
      return toStored(created as unknown as Row);
    });
  }

  async findById(trainingSessionId: string): Promise<StoredTrainingSession | null> {
    const row = await this.prisma.trainingSession.findUnique({ where: { id: trainingSessionId }, include: INCLUDE_CHAIN });
    return row ? toStored(row as unknown as Row) : null;
  }

  async findActiveByEnrollmentId(enrollmentId: string): Promise<StoredTrainingSession | null> {
    const rows = await this.prisma.trainingSession.findMany({
      where: { practiceBlock: { status: "active", practiceSession: { enrollmentId } } },
      include: INCLUDE_CHAIN,
      orderBy: { id: "asc" },
      take: 2
    });
    if (rows.length > 1) {
      throw new PersistenceError("invalid_record", `Enrollment "${enrollmentId}" has more than one active training session.`);
    }
    return rows[0] ? toStored(rows[0] as unknown as Row) : null;
  }

  async complete(trainingSessionId: string, input: { now: string }): Promise<StoredTrainingSession> {
    return this.terminate(trainingSessionId, "complete", input);
  }

  async abandon(trainingSessionId: string, input: { now: string }): Promise<StoredTrainingSession> {
    return this.terminate(trainingSessionId, "abandon", input);
  }

  private async terminate(trainingSessionId: string, action: "complete" | "abandon", input: { now: string }): Promise<StoredTrainingSession> {
    const row = await this.prisma.trainingSession.findUnique({ where: { id: trainingSessionId }, select: { practiceBlockId: true } });
    if (!row) {
      throw new PersistenceError("missing_reference", `No TrainingSession found with id "${trainingSessionId}".`);
    }
    // The block's own transaction re-reads it and applies `@ipmat/practice-block`'s transition (fails if already final).
    await (action === "complete" ? this.blocks.complete(row.practiceBlockId, input) : this.blocks.abandon(row.practiceBlockId, input));
    const stored = await this.findById(trainingSessionId);
    if (!stored) throw new PersistenceError("missing_reference", `No TrainingSession found with id "${trainingSessionId}".`);
    return stored;
  }
}
