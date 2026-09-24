-- Persistence-fidelity fix for RepairPlan/Autopsy (docs/DECISIONS.md D-039
-- addendum). Hand-written against prisma/schema.prisma (no live/shadow
-- database has ever been reachable in this environment -- see
-- docs/MASTER_PLAN.md "Current state"), following the same convention as
-- 0002/0003/0006's headers.
--
-- Phase 5B's domain RepairPlan (packages/domain/autopsy/src/types.ts)
-- always carries targetConceptName, targetPatternFamilyName,
-- targetTaxonomyCellId, targetErrorCategory, recommendedTrainingMode, and
-- priority, plus a confirmationSource.hypothesisConfirmedAt sourced from
-- the confirmed hypothesis's respondedAt -- but toRepairPlanPersistenceRecord()/
-- toAutopsyPersistenceRecord() never persisted any of them, so a stored
-- RepairPlan could not be reconstructed into a full domain object. This
-- migration adds exactly the columns needed to close that round-trip gap,
-- and nothing else.
--
-- All seven new columns are nullable: no existing row (none has ever been
-- written, since no environment has ever applied a migration against a
-- live database) can be backfilled with this data, so NULL is the only
-- honest value for a hypothetical pre-migration row -- never fabricated
-- from Concept.name, PatternFamily.name, createdAt, or RepairPlan.status.
-- No backfill, no new indexes, no new constraints, no new tables.

-- CreateEnum
CREATE TYPE "RepairPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "RecommendedTrainingMode" AS ENUM ('standard_practice', 'guided_hint_first', 'timed_pressure_drill', 'novelty_exposure');

-- AlterTable
ALTER TABLE "repair_plans" ADD COLUMN "target_concept_name" TEXT,
ADD COLUMN "target_pattern_family_name" TEXT,
ADD COLUMN "target_taxonomy_cell_id" TEXT,
ADD COLUMN "target_error_category" "ErrorCategory",
ADD COLUMN "recommended_training_mode" "RecommendedTrainingMode",
ADD COLUMN "priority" "RepairPriority";

-- AlterTable
ALTER TABLE "autopsies" ADD COLUMN "confirmed_at" TIMESTAMP(3);
