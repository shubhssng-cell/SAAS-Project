import { assertSchemaCurrent, createPrismaClient } from "@ipmat/db";
import { buildDevContentSeed } from "./devContent.js";
import { resolvePersistenceMode } from "./persistence.js";
import { createHypothesisDependencies } from "./hypothesisWiring.js";
import { createServer } from "./server.js";
import { buildProductionRuntime } from "./hardening.js";
import { createInMemoryAssistantServices, createPrismaAssistantServices } from "./assistantWiring.js";
import { createInMemoryCommerce, createPrismaCommerce, resolveCommerceConfig } from "./commerceWiring.js";
import { assertProductionConfig, formatReport } from "./productionConfig.js";
import { observeProvider } from "./providerObservability.js";
import { createInMemoryDependencies, createPrismaDependencies } from "./wiring.js";

/**
 * The CLI entry point (`npm run dev`/`start --workspace @ipmat/api`).
 * Default: in-memory dependencies plus the development-only content set (Phase 2 Unit 1).
 * `IPMAT_PERSISTENCE=prisma` (with `DATABASE_URL`) runs the SAME application services on the
 * Prisma repositories instead -- nothing above `wiring.ts` (and nothing in `apps/web`) can tell
 * which is active. In Prisma mode no dev content is seeded: content is whatever is in the
 * database (see `packages/db/prisma/seed.ts`).
 */
// Phase 9 Unit 5 (D-101): in production a missing or unsafe setting REFUSES startup (names only, never values); elsewhere the same
// findings are printed as warnings. Runs before anything connects or listens.
const configReport = assertProductionConfig(process.env);
console.log(formatReport(configReport));
const PORT = Number(process.env.PORT ?? 4001);
const mode = resolvePersistenceMode(process.env);
// Fails fast (before anything connects) on a missing or invalid commercial configuration -- see commerceWiring.ts.
const commerceConfig = resolveCommerceConfig(process.env);
const DB_READINESS_TIMEOUT_MS = 2000;

if (mode.kind === "prisma") {
  const prisma = createPrismaClient(mode.databaseUrl);
  await prisma.$connect(); // fail fast if the database is unreachable or the credentials are wrong
  // ...and if its schema is behind this build (migrations not applied): fail here, not request by request in front of students.
  const schema = await assertSchemaCurrent(prisma);
  if (schema.status === "ahead") console.warn(`database schema is newer than this build (latest applied: ${schema.latest}); migrations are additive, continuing`);
  const runtime = buildProductionRuntime(process.env, { readiness: async () => { await Promise.race([prisma.$queryRaw`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_READINESS_TIMEOUT_MS).unref())]); return true; } });
  const { commerce, aiUsage } = createPrismaCommerce(prisma, commerceConfig, runtime);
  const server = createServer({
    ...createPrismaDependencies(prisma),
    ...createHypothesisDependencies(process.env, (provider) => observeProvider(provider, { ...runtime, usage: aiUsage })),
    assistant: createPrismaAssistantServices(prisma, process.env, runtime, aiUsage),
    commerce,
    runtime
  });
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
  const runtime = buildProductionRuntime(process.env);
  const deps = createInMemoryDependencies(devContent);
  const { commerce, store } = createInMemoryCommerce(commerceConfig, deps, runtime);
  const server = createServer({
    ...deps,
    ...createHypothesisDependencies(process.env, (provider) => observeProvider(provider, { ...runtime, usage: store })),
    assistant: createInMemoryAssistantServices(),
    commerce,
    runtime
  });
  server.listen(PORT, () => {
    console.log(
      `@ipmat/api listening on http://localhost:${PORT} (in-memory dependencies, no database; ${devContent.questionContent.length} development-only published questions)`
    );
  });
}
