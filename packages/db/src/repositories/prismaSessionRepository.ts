import type { PrismaClient } from "@prisma/client";
import type { SessionRecord, SessionRepository } from "./types.js";

/** The ONE concrete, database-backed implementation of `SessionRepository`. `findActiveByTokenHash()` filters `revokedAt`/`expiresAt` directly in the query — never loads a stale/expired row and filters client-side. */
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { id: string; studentId: string; tokenHash: string; now: string; expiresAt: string }): Promise<SessionRecord> {
    const row = await this.prisma.session.create({
      data: { id: input.id, studentId: input.studentId, tokenHash: input.tokenHash, createdAt: new Date(input.now), expiresAt: new Date(input.expiresAt) }
    });
    return toRecord(row);
  }

  async findActiveByTokenHash(tokenHash: string, now: string): Promise<SessionRecord | null> {
    const row = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date(now) } }
    });
    return row ? toRecord(row) : null;
  }

  async revoke(sessionId: string, now: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(now) }
    });
  }
}

function toRecord(row: { id: string; studentId: string; tokenHash: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null }): SessionRecord {
  return {
    id: row.id,
    studentId: row.studentId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
  };
}
