import { PrismaClient } from "@prisma/client";

/**
 * The ONE place a Prisma client is constructed for the application (Product Phase 2 Unit 7), so
 * `apps/api` never imports `@prisma/client` values itself and Prisma stays inside `@ipmat/db`.
 * The connection string is always passed EXPLICITLY -- never left to Prisma's implicit `.env`
 * discovery -- so which database a process talks to is decided by one visible input.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw new Error("createPrismaClient() requires a non-empty database URL.");
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
