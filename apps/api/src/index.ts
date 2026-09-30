import { createPrismaClient } from "@ipmat/db";
import { buildDevContentSeed } from "./devContent.js";
import { resolvePersistenceMode } from "./persistence.js";
import { createServer } from "./server.js";
import { createInMemoryDependencies, createPrismaDependencies } from "./wiring.js";

/**
 * The CLI entry point (`npm run dev`/`start --workspace @ipmat/api`).
 * Default: in-memory dependencies plus the development-only content set (Phase 2 Unit 1).
 * `IPMAT_PERSISTENCE=prisma` (with `DATABASE_URL`) runs the SAME application services on the
 * Prisma repositories instead -- nothing above `wiring.ts` (and nothing in `apps/web`) can tell
 * which is active. In Prisma mode no dev content is seeded: content is whatever is in the
 * database (see `packages/db/prisma/seed.ts`).
 */
const PORT = Number(process.env.PORT ?? 4001);
const mode = resolvePersistenceMode(process.env);

if (mode.kind === "prisma") {
  const prisma = createPrismaClient(mode.databaseUrl);
  await prisma.$connect(); // fail fast if the database is unreachable or the credentials are wrong
  const server = createServer(createPrismaDependencies(prisma));
  server.listen(PORT, () => {
    console.log(`@ipmat/api listening on http://localhost:${PORT} (Prisma repositories; database connected)`);
  });
  const shutdown = () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  /** Phase 2 Unit 1: development-only published practice content (see `devContent.ts`) -- never production data. */
  const devContent = await buildDevContentSeed();
  const server = createServer(createInMemoryDependencies(devContent));
  server.listen(PORT, () => {
    console.log(
      `@ipmat/api listening on http://localhost:${PORT} (in-memory dependencies, no database; ${devContent.questionContent.length} development-only published questions)`
    );
  });
}
