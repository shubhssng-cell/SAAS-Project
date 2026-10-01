-- Phase 5 Unit 1 (Training System Foundation, docs/DECISIONS.md D-075).
--
-- 1. `training_sessions`: a thin record layered on the existing `practice_blocks` row (one-to-one, `practice_block_id`
--    UNIQUE). The block owns lifecycle, completion rule and attempts; this row adds the training system id and the
--    objective/config snapshot. Restrict, never Cascade -- the same discipline as every other D-060 foreign key.
--
-- 2. At most ONE `active` practice session per enrollment. `PracticeSessionRepository.findActiveByEnrollmentId()` has
--    always FAILED CLOSED when more than one active session exists (the recommendation composition reads it), but
--    nothing prevented two. Starting a training session creates the enrollment's practice session on demand, so two
--    concurrent first-starts (two tabs, two API instances) could otherwise leave the enrollment permanently
--    ambiguous and break its recommendations. This partial unique index is the database-level guarantee.
--    Hand-written (Prisma's schema DSL cannot express a partial index -- same reason as migration 0010).
--    Fails closed on existing data: if an enrollment already holds two active sessions this statement fails rather
--    than guessing which to end. No application code created a PracticeSession before this unit.

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL,
    "practice_block_id" TEXT NOT NULL,
    "system_id" TEXT NOT NULL,
    "objective" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_sessions_practice_block_id_key" ON "training_sessions"("practice_block_id");

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_practice_block_id_fkey" FOREIGN KEY ("practice_block_id") REFERENCES "practice_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "practice_sessions_one_active_per_enrollment" ON "practice_sessions" ("enrollment_id") WHERE "status" = 'active';
