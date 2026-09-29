import type { SessionRecord, SessionRepository } from "./types.js";

/** Test double for `SessionRepository` — an in-memory `Session` table. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, SessionRecord>();
  private readonly idByTokenHash = new Map<string, string>();

  async create(input: { id: string; studentId: string; tokenHash: string; now: string; expiresAt: string }): Promise<SessionRecord> {
    const record: SessionRecord = { id: input.id, studentId: input.studentId, tokenHash: input.tokenHash, createdAt: input.now, expiresAt: input.expiresAt, revokedAt: null };
    this.byId.set(record.id, record);
    this.idByTokenHash.set(record.tokenHash, record.id);
    return record;
  }

  async findActiveByTokenHash(tokenHash: string, now: string): Promise<SessionRecord | null> {
    const id = this.idByTokenHash.get(tokenHash);
    if (!id) return null;
    const record = this.byId.get(id);
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (Date.parse(record.expiresAt) <= Date.parse(now)) return null;
    return record;
  }

  async revoke(sessionId: string, now: string): Promise<void> {
    const record = this.byId.get(sessionId);
    if (!record || record.revokedAt !== null) return;
    this.byId.set(sessionId, { ...record, revokedAt: now });
  }
}
