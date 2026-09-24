import type { PrismaClient } from "@prisma/client";
import { abandonPracticeSession, completePracticeSession, type PracticeSessionState } from "@ipmat/practice-session";
import { PersistenceError } from "./errors.js";
import { runSerializableTransaction } from "./serializable.js";
import type { PracticeSessionRepository } from "./types.js";
import { singleActiveSessionOrNull } from "./validation.js";

function toState(row: {
  id: string;
  enrollmentId: string;
  status: PracticeSessionState["status"];
  startedAt: Date;
  endedAt: Date | null;
  sessionTimeBudgetSeconds: number | null;
}): PracticeSessionState {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    sessionTimeBudgetSeconds: row.sessionTimeBudgetSeconds
  };
}

/**
 * The ONE concrete, database-backed implementation of
 * `PracticeSessionRepository` (docs/DECISIONS.md D-060). `complete()`/
 * `abandon()` re-read the row AND count active child `PracticeBlock`s
 * INSIDE one fresh `Serializable` transaction, then hand both facts to
 * `@ipmat/practice-session`'s own pure `completePracticeSession()`/
 * `abandonPracticeSession()` — the SAME "domain function is the actual
 * source of truth, repository only supplies a fresh read and applies the
 * result" pattern `PrismaQuestionPublicationRepository.decide()` already
 * established for `decidePublication()` (docs/DECISIONS.md D-049).
 */
export class PrismaPracticeSessionRepository implements PracticeSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { id: string; enrollmentId: string; now: string; sessionTimeBudgetSeconds?: number | null }): Promise<PracticeSessionState> {
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id: input.enrollmentId } });
    if (!enrollment) {
      throw new PersistenceError("missing_reference", `No Enrollment found with id "${input.enrollmentId}".`);
    }

    const created = await this.prisma.practiceSession.create({
      data: {
        id: input.id,
        enrollmentId: input.enrollmentId,
        startedAt: new Date(input.now),
        sessionTimeBudgetSeconds: input.sessionTimeBudgetSeconds ?? null
      }
    });
    return toState(created);
  }

  async findById(sessionId: string): Promise<PracticeSessionState | null> {
    const row = await this.prisma.practiceSession.findUnique({ where: { id: sessionId } });
    return row ? toState(row) : null;
  }

  /** Scoped by the indexed `enrollmentId` + `status` columns. `take: 2` is enough to detect (and fail closed on) the ambiguous "more than one active session" state nothing else currently prevents. */
  async findActiveByEnrollmentId(enrollmentId: string): Promise<PracticeSessionState | null> {
    const rows = await this.prisma.practiceSession.findMany({ where: { enrollmentId, status: "active" }, orderBy: { id: "asc" }, take: 2 });
    return singleActiveSessionOrNull(enrollmentId, rows.map(toState));
  }

  async complete(sessionId: string, input: { now: string }): Promise<PracticeSessionState> {
    return this.terminate(sessionId, "completed", input);
  }

  async abandon(sessionId: string, input: { now: string }): Promise<PracticeSessionState> {
    return this.terminate(sessionId, "abandoned", input);
  }

  private async terminate(sessionId: string, outcome: "completed" | "abandoned", input: { now: string }): Promise<PracticeSessionState> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.practiceSession.findUnique({ where: { id: sessionId } });
      const current = row ? toState(row) : null;

      const activeBlockCount = row ? await tx.practiceBlock.count({ where: { practiceSessionId: sessionId, status: "active" } }) : 0;

      const next =
        outcome === "completed"
          ? completePracticeSession(current, { now: input.now, hasActiveBlock: activeBlockCount > 0 })
          : abandonPracticeSession(current, { now: input.now, hasActiveBlock: activeBlockCount > 0 });

      const updated = await tx.practiceSession.update({
        where: { id: sessionId },
        data: { status: next.status, endedAt: next.endedAt ? new Date(next.endedAt) : null }
      });
      return toState(updated);
    });
  }
}
