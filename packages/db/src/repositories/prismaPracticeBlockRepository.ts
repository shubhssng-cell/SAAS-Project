import type { PrismaClient } from "@prisma/client";
import { abandonPracticeBlock, completePracticeBlock, createPracticeBlock, type PracticeBlockState } from "@ipmat/practice-block";
import { PersistenceError } from "./errors.js";
import { runSerializableTransaction } from "./serializable.js";
import type { PracticeBlockRepository } from "./types.js";

function toState(row: {
  id: string;
  practiceSessionId: string;
  sequenceNumber: number;
  status: PracticeBlockState["status"];
  startedAt: Date;
  endedAt: Date | null;
  targetQuestionCount: number | null;
  blockTimeBudgetSeconds: number | null;
}): PracticeBlockState {
  return {
    id: row.id,
    practiceSessionId: row.practiceSessionId,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    targetQuestionCount: row.targetQuestionCount,
    blockTimeBudgetSeconds: row.blockTimeBudgetSeconds
  };
}

/**
 * The ONE concrete, database-backed implementation of
 * `PracticeBlockRepository` (docs/DECISIONS.md D-060). `create()`
 * allocates `sequenceNumber` as `(current max for the session) + 1` and
 * re-verifies the parent session is still `active`, both INSIDE the same
 * `Serializable` transaction as the insert — a concurrent `create()` for
 * the same session is a genuine conflict Postgres detects (mapped to
 * `SerializationFailureError`), never a silently-duplicated sequence
 * number. `complete()`/`abandon()` follow the same "domain function is the
 * source of truth" pattern as `PrismaPracticeSessionRepository`.
 */
export class PrismaPracticeBlockRepository implements PracticeBlockRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    id: string;
    practiceSessionId: string;
    now: string;
    targetQuestionCount?: number | null;
    blockTimeBudgetSeconds?: number | null;
  }): Promise<PracticeBlockState> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const session = await tx.practiceSession.findUnique({ where: { id: input.practiceSessionId } });
      if (!session) {
        throw new PersistenceError("missing_reference", `No PracticeSession found with id "${input.practiceSessionId}".`);
      }

      const maxRow = await tx.practiceBlock.aggregate({
        where: { practiceSessionId: input.practiceSessionId },
        _max: { sequenceNumber: true }
      });
      const sequenceNumber = (maxRow._max.sequenceNumber ?? 0) + 1;

      const block = createPracticeBlock({
        id: input.id,
        practiceSessionId: input.practiceSessionId,
        sequenceNumber,
        now: input.now,
        sessionIsActive: session.status === "active",
        targetQuestionCount: input.targetQuestionCount,
        blockTimeBudgetSeconds: input.blockTimeBudgetSeconds
      });

      const created = await tx.practiceBlock.create({
        data: {
          id: block.id,
          practiceSessionId: block.practiceSessionId,
          sequenceNumber: block.sequenceNumber,
          startedAt: new Date(block.startedAt),
          targetQuestionCount: block.targetQuestionCount,
          blockTimeBudgetSeconds: block.blockTimeBudgetSeconds
        }
      });
      return toState(created);
    });
  }

  async findById(blockId: string): Promise<PracticeBlockState | null> {
    const row = await this.prisma.practiceBlock.findUnique({ where: { id: blockId } });
    return row ? toState(row) : null;
  }

  async findBySessionId(practiceSessionId: string): Promise<PracticeBlockState[]> {
    const rows = await this.prisma.practiceBlock.findMany({ where: { practiceSessionId }, orderBy: { sequenceNumber: "asc" } });
    return rows.map(toState);
  }

  async complete(blockId: string, input: { now: string }): Promise<PracticeBlockState> {
    return this.terminate(blockId, "completed", input);
  }

  async abandon(blockId: string, input: { now: string }): Promise<PracticeBlockState> {
    return this.terminate(blockId, "abandoned", input);
  }

  private async terminate(blockId: string, outcome: "completed" | "abandoned", input: { now: string }): Promise<PracticeBlockState> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.practiceBlock.findUnique({ where: { id: blockId } });
      const current = row ? toState(row) : null;

      const next = outcome === "completed" ? completePracticeBlock(current, { now: input.now }) : abandonPracticeBlock(current, { now: input.now });

      const updated = await tx.practiceBlock.update({
        where: { id: blockId },
        data: { status: next.status, endedAt: next.endedAt ? new Date(next.endedAt) : null }
      });
      return toState(updated);
    });
  }
}
