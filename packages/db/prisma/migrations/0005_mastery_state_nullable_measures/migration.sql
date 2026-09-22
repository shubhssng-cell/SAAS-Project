-- Phase 5C-1: Persistence Boundary (docs/MASTER_PLAN.md, docs/DECISIONS.md
-- D-043). Generated via `prisma migrate diff --from-schema-datamodel
-- <Phase 5B schema snapshot from git> --to-schema-datamodel
-- prisma/schema.prisma --script`, the same no-live/shadow-database approach
-- used for every prior migration — no environment has ever applied a
-- migration against a live database (see docs/MASTER_PLAN.md "Current
-- state"), so this is safe to apply to a fresh database or directly after
-- 0004.
--
-- Resolves the tension docs/DECISIONS.md D-042 deliberately left open:
-- `@ipmat/mastery`'s 5 headline component measures (accuracy, speed_ratio,
-- novelty_handling, pressure_performance, pattern_coverage) are each
-- legitimately `null` below MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT
-- relevant observations ("insufficient data"), but these columns were
-- NOT NULL. Widening them to nullable Float? lets SQL NULL carry exactly
-- that meaning, distinct from a real measured `0` (e.g. 0% accuracy after
-- enough graded attempts) — NULL and 0.0 are never confused at either the
-- SQL or TypeScript level. See @ipmat/mastery's toMasteryStatePersistenceRecord()
-- and packages/db/src/repositories/prismaMasteryStateRepository.ts for the
-- full three-state persistence model (row absent / column NULL / column a
-- real number) this migration enables.
--
-- No backfill is needed: no database has ever held a MasteryState row.

-- AlterTable
ALTER TABLE "mastery_states" ALTER COLUMN "accuracy" DROP NOT NULL,
ALTER COLUMN "speed_ratio" DROP NOT NULL,
ALTER COLUMN "novelty_handling" DROP NOT NULL,
ALTER COLUMN "pressure_performance" DROP NOT NULL,
ALTER COLUMN "pattern_coverage" DROP NOT NULL;
