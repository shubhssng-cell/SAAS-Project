import { buildDevContentSeed } from "./devContent.js";
import { createServer } from "./server.js";
import { createInMemoryDependencies } from "./wiring.js";

/**
 * The CLI entry point (`npm run dev`/`start --workspace @ipmat/api`).
 * Always wires in-memory dependencies — no live database has ever been
 * reachable in this environment (I; docs/project-memory/72_DATABASE_AND_INFRASTRUCTURE.md).
 * `createPrismaDependencies()` (`wiring.ts`) exists and typechecks but is
 * deliberately never called from here.
 */
const PORT = Number(process.env.PORT ?? 4001);

/** Phase 2 Unit 1: development-only published practice content (see `devContent.ts`) -- never production data. */
const devContent = await buildDevContentSeed();

const server = createServer(createInMemoryDependencies(devContent));
server.listen(PORT, () => {
  console.log(
    `@ipmat/api listening on http://localhost:${PORT} (in-memory dependencies, no live database; ${devContent.questionContent.length} development-only published questions)`
  );
});
