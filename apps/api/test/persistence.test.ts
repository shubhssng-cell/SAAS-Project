import { describe, expect, it } from "vitest";
import { resolvePersistenceMode } from "../src/persistence.js";

/** Product Phase 2 Unit 7 -- which repositories `apps/api` runs on is an explicit, fail-closed choice. */
describe("resolvePersistenceMode", () => {
  it("defaults to in-memory when nothing is set (development)", () => {
    expect(resolvePersistenceMode({})).toEqual({ kind: "memory" });
    expect(resolvePersistenceMode({ IPMAT_PERSISTENCE: "memory" })).toEqual({ kind: "memory" });
    expect(resolvePersistenceMode({ IPMAT_PERSISTENCE: "  MEMORY " })).toEqual({ kind: "memory" });
  });

  it("a DATABASE_URL alone does NOT switch to Prisma -- Prisma is an explicit opt-in", () => {
    expect(resolvePersistenceMode({ DATABASE_URL: "postgresql://x" })).toEqual({ kind: "memory" });
  });

  it("IPMAT_PERSISTENCE=prisma with a DATABASE_URL selects Prisma and carries that URL", () => {
    expect(resolvePersistenceMode({ IPMAT_PERSISTENCE: "prisma", DATABASE_URL: " postgresql://u@h/db " })).toEqual({ kind: "prisma", databaseUrl: "postgresql://u@h/db" });
  });

  it("IPMAT_PERSISTENCE=prisma without a DATABASE_URL is an error -- it never silently falls back to in-memory", () => {
    expect(() => resolvePersistenceMode({ IPMAT_PERSISTENCE: "prisma" })).toThrow(/requires DATABASE_URL/);
    expect(() => resolvePersistenceMode({ IPMAT_PERSISTENCE: "prisma", DATABASE_URL: "   " })).toThrow(/requires DATABASE_URL/);
  });

  it("an unknown value is an error, not a default", () => {
    expect(() => resolvePersistenceMode({ IPMAT_PERSISTENCE: "postgres" })).toThrow(/Unknown IPMAT_PERSISTENCE/);
  });

  it("error messages never contain the connection string", () => {
    let message = "";
    try {
      resolvePersistenceMode({ IPMAT_PERSISTENCE: "nope", DATABASE_URL: "postgresql://user:secret@host/db" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toMatch(/secret|postgresql:/);
  });
});
