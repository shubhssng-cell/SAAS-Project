import type { PrismaClient } from "@prisma/client";

/**
 * The newest migration this build expects (Phase 9 Unit 5, docs/DECISIONS.md D-101). `assertSchemaCurrent` refuses to let the API
 * serve traffic against a database that is BEHIND it (a missing table or column would fail request by request, in production, in
 * front of students). A test keeps this constant equal to the newest directory in `prisma/migrations`, so adding a migration
 * without updating it fails the suite.
 */
export const LATEST_MIGRATION = "0018_monetization_entitlements";

export type SchemaStatus = { status: "current"; latest: string } | { status: "ahead"; latest: string };

export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaVersionError";
  }
}

type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };

/**
 * Reads Prisma's own migration table. Refuses (throws `SchemaVersionError`, with a fixed message that names no connection detail) when:
 *  - the table is missing (the database was never migrated), or
 *  - a migration started but did not finish (a half-applied migration needs a human), or
 *  - the newest finished migration is older than `LATEST_MIGRATION`.
 * A database NEWER than this build (an application rollback after a migration) is allowed and reported as `ahead`: migrations in this
 * repository are additive, so an older build keeps working against a newer schema.
 */
export async function assertSchemaCurrent(prisma: Pick<PrismaClient, "$queryRaw">, expected: string = LATEST_MIGRATION): Promise<SchemaStatus> {
  let rows: MigrationRow[];
  try {
    rows = await prisma.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  } catch {
    throw new SchemaVersionError("The database has no migration history (_prisma_migrations). Run `prisma migrate deploy` before starting the API.");
  }
  const live = rows.filter((r) => r.rolled_back_at === null);
  if (live.some((r) => r.finished_at === null)) throw new SchemaVersionError("A database migration started but did not finish. Resolve it (see docs/DEPLOYMENT.md) before starting the API.");
  const latest = live.map((r) => r.migration_name).sort().pop();
  if (!latest) throw new SchemaVersionError("The database has no applied migrations. Run `prisma migrate deploy` before starting the API.");
  if (latest < expected) throw new SchemaVersionError(`The database schema is behind this build (expected ${expected}, found ${latest}). Run \`prisma migrate deploy\` before starting the API.`);
  return latest === expected ? { status: "current", latest } : { status: "ahead", latest };
}
