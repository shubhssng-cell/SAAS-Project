-- D-060: Practice Session / Block foundation (docs/DECISIONS.md D-060).
-- Enrollment -> PracticeSession -> PracticeBlock -> Attempt, held alongside
-- the pre-existing, unchanged Enrollment -> Attempt path. Hand-written
-- against prisma/schema.prisma (no live/shadow database has ever been
-- reachable in this environment -- see docs/MASTER_PLAN.md "Current
-- state"), following the same "generated via `prisma migrate diff`"
-- convention documented in 0002/0003's headers; no target database has ever
-- held rows in `attempts`, so the new nullable columns below need no
-- backfill.

-- CreateEnum
CREATE TYPE "PracticeSessionStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "PracticeBlockStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "status" "PracticeSessionStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "session_time_budget_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_blocks" (
    "id" TEXT NOT NULL,
    "practice_session_id" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "status" "PracticeBlockStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "target_question_count" INTEGER,
    "block_time_budget_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_blocks_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Attempt gains a nullable (practiceBlockId, blockSequenceNumber)
-- pair -- the direct precedent being retryOfAttemptId's own nullable self-FK.
ALTER TABLE "attempts" ADD COLUMN "practice_block_id" TEXT,
ADD COLUMN "block_sequence_number" INTEGER;

-- CreateIndex
CREATE INDEX "practice_sessions_enrollment_id_idx" ON "practice_sessions"("enrollment_id");

-- CreateIndex
CREATE INDEX "practice_sessions_status_idx" ON "practice_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "practice_blocks_practice_session_id_sequence_number_key" ON "practice_blocks"("practice_session_id", "sequence_number");

-- CreateIndex
CREATE INDEX "practice_blocks_practice_session_id_idx" ON "practice_blocks"("practice_session_id");

-- CreateIndex
CREATE INDEX "practice_blocks_status_idx" ON "practice_blocks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_practice_block_id_block_sequence_number_key" ON "attempts"("practice_block_id", "block_sequence_number");

-- CreateIndex
CREATE INDEX "attempts_practice_block_id_idx" ON "attempts"("practice_block_id");

-- AddForeignKey (Restrict, not Cascade -- docs/DECISIONS.md D-060 Round 4:
-- no application code ever deletes a PracticeSession/PracticeBlock, and each
-- of these three FK relationships is independently trivial rather than
-- depending on any unverified multi-path cascade-ordering interaction with
-- Attempt's own pre-existing student/enrollment Cascade below.)
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_blocks" ADD CONSTRAINT "practice_blocks_practice_session_id_fkey" FOREIGN KEY ("practice_session_id") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_practice_block_id_fkey" FOREIGN KEY ("practice_block_id") REFERENCES "practice_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written invariant (Prisma's schema DSL has no CHECK constraint
-- syntax, same as questions_published_requires_provenance in 0001_init):
-- an Attempt's block membership is an all-or-nothing pair -- it can never
-- carry a practice_block_id with no block_sequence_number, or vice versa.
-- This is the DB-level backstop for what @ipmat/attempt's AttemptState.
-- blockMembership already makes structurally unrepresentable at the
-- TypeScript type level (docs/DECISIONS.md D-060).
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_block_membership_pair"
  CHECK (("practice_block_id" IS NULL) = ("block_sequence_number" IS NULL));
