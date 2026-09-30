/**
 * Which repositories `apps/api` runs on (Product Phase 2 Unit 7). Explicit opt-in only:
 * - unset / `memory` -> the in-memory wiring (development; also seeds the dev content set)
 * - `prisma`         -> the Prisma wiring, which REQUIRES `DATABASE_URL` in the environment
 * Anything else, or `prisma` without a connection string, is an error at startup -- it never
 * silently falls back to in-memory storage (a server that believes it is persisting but is not
 * is worse than one that refuses to start).
 */
export type PersistenceMode = { kind: "memory" } | { kind: "prisma"; databaseUrl: string };

export function resolvePersistenceMode(env: Record<string, string | undefined>): PersistenceMode {
  const requested = (env.IPMAT_PERSISTENCE ?? "memory").trim().toLowerCase();
  if (requested === "memory") return { kind: "memory" };
  if (requested === "prisma") {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error("IPMAT_PERSISTENCE=prisma requires DATABASE_URL to be set in the environment. Refusing to fall back to in-memory storage.");
    }
    return { kind: "prisma", databaseUrl };
  }
  throw new Error(`Unknown IPMAT_PERSISTENCE value "${requested}" (expected "memory" or "prisma").`);
}
