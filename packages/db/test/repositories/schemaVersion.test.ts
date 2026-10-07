import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION, SchemaVersionError, assertSchemaCurrent } from "../../src/schemaVersion.js";

/** Phase 9 Unit 5 (D-101): the API refuses to serve against a database that is behind this build. */
type Row = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };
const done = (name: string): Row => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });
const prisma = (rows: Row[] | Error) => ({ $queryRaw: (async () => { if (rows instanceof Error) throw rows; return rows; }) as never });
const names = ["0001_init", "0002_x", LATEST_MIGRATION];

describe("schema version guard", () => {
  it("LATEST_MIGRATION is exactly the newest directory in prisma/migrations (adding a migration without updating it fails here)", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prisma", "migrations");
    const newest = readdirSync(dir).filter((d) => /^\d{4}_/.test(d)).sort().pop();
    expect(LATEST_MIGRATION).toBe(newest);
  });

  it("current when the newest applied migration is the expected one", async () => {
    expect(await assertSchemaCurrent(prisma(names.map(done)))).toEqual({ status: "current", latest: LATEST_MIGRATION });
  });

  it("refuses a database that is behind, naming both versions but no connection detail", async () => {
    const err = await assertSchemaCurrent(prisma(["0001_init", "0002_x"].map(done))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaVersionError);
    expect(String((err as Error).message)).toMatch(/behind this build.*0002_x/);
    expect(String((err as Error).message)).toMatch(/migrate deploy/);
  });

  it("refuses a half-applied migration", async () => {
    const rows = [...names.map(done), { migration_name: "9999_half", finished_at: null, rolled_back_at: null }];
    await expect(assertSchemaCurrent(prisma(rows))).rejects.toThrow(/did not finish/);
  });

  it("ignores a rolled-back migration, and treats a newer schema as ahead (migrations are additive, an older build still works)", async () => {
    const rolled = { migration_name: "9998_rolled_back", finished_at: new Date(), rolled_back_at: new Date() };
    expect(await assertSchemaCurrent(prisma([...names.map(done), rolled]))).toEqual({ status: "current", latest: LATEST_MIGRATION });
    expect(await assertSchemaCurrent(prisma([...names.map(done), done("9999_future")]))).toEqual({ status: "ahead", latest: "9999_future" });
  });

  it("refuses an unmigrated database and a missing history table, without leaking the driver message", async () => {
    await expect(assertSchemaCurrent(prisma([]))).rejects.toThrow(/no applied migrations/);
    const err = await assertSchemaCurrent(prisma(new Error('relation "_prisma_migrations" does not exist; password=hunter2'))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchemaVersionError);
    expect(String((err as Error).message)).not.toMatch(/hunter2|relation/);
  });
});
