import { describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "../../src/repositories/inMemorySessionRepository.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T_EXPIRES = "2026-01-15T00:00:00.000Z";
const T_AFTER_EXPIRY = "2026-01-16T00:00:00.000Z";
const T_BEFORE_EXPIRY = "2026-01-10T00:00:00.000Z";

describe("SessionRepository (InMemory)", () => {
  it("creates a session and finds it active by tokenHash", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s1", studentId: "student-1", tokenHash: "hash-1", now: T0, expiresAt: T_EXPIRES });
    const found = await repo.findActiveByTokenHash("hash-1", T_BEFORE_EXPIRY);
    expect(found).toEqual({ id: "s1", studentId: "student-1", tokenHash: "hash-1", createdAt: T0, expiresAt: T_EXPIRES, revokedAt: null });
  });

  it("returns null for a tokenHash that was never created", async () => {
    const repo = new InMemorySessionRepository();
    expect(await repo.findActiveByTokenHash("no-such-hash", T0)).toBeNull();
  });

  it("returns null once the session's expiresAt has passed", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s1", studentId: "student-1", tokenHash: "hash-1", now: T0, expiresAt: T_EXPIRES });
    expect(await repo.findActiveByTokenHash("hash-1", T_AFTER_EXPIRY)).toBeNull();
  });

  it("returns null after revoke() -- logout invalidates the session immediately", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s1", studentId: "student-1", tokenHash: "hash-1", now: T0, expiresAt: T_EXPIRES });
    await repo.revoke("s1", T_BEFORE_EXPIRY);
    expect(await repo.findActiveByTokenHash("hash-1", T_BEFORE_EXPIRY)).toBeNull();
  });

  it("revoke() on an already-revoked or nonexistent session is a no-op, never throws", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s1", studentId: "student-1", tokenHash: "hash-1", now: T0, expiresAt: T_EXPIRES });
    await repo.revoke("s1", T_BEFORE_EXPIRY);
    await expect(repo.revoke("s1", T_BEFORE_EXPIRY)).resolves.toBeUndefined();
    await expect(repo.revoke("does-not-exist", T_BEFORE_EXPIRY)).resolves.toBeUndefined();
  });

  it("two sessions for the same student are independently valid/revocable", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s1", studentId: "student-1", tokenHash: "hash-1", now: T0, expiresAt: T_EXPIRES });
    await repo.create({ id: "s2", studentId: "student-1", tokenHash: "hash-2", now: T0, expiresAt: T_EXPIRES });
    await repo.revoke("s1", T_BEFORE_EXPIRY);
    expect(await repo.findActiveByTokenHash("hash-1", T_BEFORE_EXPIRY)).toBeNull();
    expect(await repo.findActiveByTokenHash("hash-2", T_BEFORE_EXPIRY)).not.toBeNull();
  });
});
