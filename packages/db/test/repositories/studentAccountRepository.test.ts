import { describe, expect, it } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { InMemoryStudentAccountRepository } from "../../src/repositories/inMemoryStudentAccountRepository.js";

const T0 = "2026-01-01T00:00:00.000Z";

describe("StudentAccountRepository (InMemory)", () => {
  it("creates a student and returns the public (passwordHash-free) shape", async () => {
    const repo = new InMemoryStudentAccountRepository();
    const created = await repo.create({ email: "student@example.com", passwordHash: "scrypt:abc:def", now: T0 });
    expect(created).toEqual({ id: created.id, email: "student@example.com", createdAt: T0 });
    expect(created).not.toHaveProperty("passwordHash");
  });

  it("rejects a duplicate email", async () => {
    const repo = new InMemoryStudentAccountRepository();
    await repo.create({ email: "student@example.com", passwordHash: "scrypt:abc:def", now: T0 });
    await expect(repo.create({ email: "student@example.com", passwordHash: "scrypt:xyz:123", now: T0 })).rejects.toThrow(PersistenceError);
  });

  it("findByEmailWithCredentials returns the passwordHash for a real login check", async () => {
    const repo = new InMemoryStudentAccountRepository();
    await repo.create({ email: "student@example.com", passwordHash: "scrypt:abc:def", now: T0 });
    const found = await repo.findByEmailWithCredentials("student@example.com");
    expect(found?.passwordHash).toBe("scrypt:abc:def");
  });

  it("findByEmailWithCredentials returns null for an unknown email", async () => {
    const repo = new InMemoryStudentAccountRepository();
    expect(await repo.findByEmailWithCredentials("nobody@example.com")).toBeNull();
  });

  it("findById returns the public shape, or null if the student doesn't exist", async () => {
    const repo = new InMemoryStudentAccountRepository();
    const created = await repo.create({ email: "student@example.com", passwordHash: "scrypt:abc:def", now: T0 });
    const found = await repo.findById(created.id);
    expect(found).toEqual({ id: created.id, email: "student@example.com", createdAt: T0 });
    expect(await repo.findById("does-not-exist")).toBeNull();
  });
});
