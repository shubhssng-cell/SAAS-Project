-- Phase 4A: Student Attempt Intelligence (docs/MASTER_PLAN.md, docs/DECISIONS.md D-034).
-- Generated via `prisma migrate diff --from-schema-datamodel <Phase 3.1.1
-- schema snapshot from git> --to-schema-datamodel prisma/schema.prisma
-- --script`, the same no-live/shadow-database approach used for 0002 (see
-- that migration's header) — no environment has ever applied a migration
-- against a live database (see docs/MASTER_PLAN.md "Current state"), so
-- this is safe to apply to a fresh database or directly after 0002.
--
-- Adds the `AttemptStatus` lifecycle enum and `attempts.status`/
-- `attempts.finalized_at` columns (packages/domain/attempt), and renames
-- `attempt_events.event_type`'s `option_selected`/`option_changed`/
-- `hint_requested` values to the canonical `answer_selected`/
-- `answer_changed`/`hint_opened`, adding `question_skipped`. Because no
-- database has ever held rows in these tables, the enum-value rename below
-- (recreate-and-cast) needs no backfill step — it would if any target
-- database already had `attempt_events` rows using the old value names.

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('in_progress', 'submitted', 'skipped', 'abandoned');

-- AlterEnum
BEGIN;
CREATE TYPE "AttemptEventType_new" AS ENUM ('question_opened', 'answer_selected', 'answer_changed', 'hint_opened', 'solution_opened', 'question_skipped', 'working_input_changed', 'reasoning_submitted', 'answer_submitted');
ALTER TABLE "attempt_events" ALTER COLUMN "event_type" TYPE "AttemptEventType_new" USING ("event_type"::text::"AttemptEventType_new");
ALTER TYPE "AttemptEventType" RENAME TO "AttemptEventType_old";
ALTER TYPE "AttemptEventType_new" RENAME TO "AttemptEventType";
DROP TYPE "AttemptEventType_old";
COMMIT;

-- AlterTable
ALTER TABLE "attempts" ADD COLUMN     "finalized_at" TIMESTAMP(3),
ADD COLUMN     "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress';

-- CreateIndex
CREATE INDEX "attempts_status_idx" ON "attempts"("status");
