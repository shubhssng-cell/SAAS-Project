-- Product Phase 7 Unit 4 (Full Exam Simulation, docs/DECISIONS.md D-090).
-- Additive only: one enum and three NEW tables (exam_simulations, simulation_questions, simulation_answer_events), plus the
-- hand-written constraints below. No existing table or column is altered and no existing row is touched.
-- An active simulation has state (a deadline and an answer log), which is why persistence is genuinely required here.
-- Nothing in practice, training, adaptive, revision, repair or mastery references these tables, and no simulation ever
-- writes an attempt, practice session or practice block.
-- Reversal (controlled, manual): DROP TABLE simulation_answer_events, simulation_questions, exam_simulations (in that
-- order), then DROP TYPE "SimulationStatus".

-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('in_progress', 'submitted', 'expired');

-- CreateTable
CREATE TABLE "exam_simulations" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "config_version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "paper_origin" TEXT NOT NULL,
    "paper_source_ref" TEXT NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "finalized_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_questions" (
    "simulation_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "section_name" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "content_fingerprint" TEXT NOT NULL,
    "provenance_source_type" TEXT NOT NULL,

    CONSTRAINT "simulation_questions_pkey" PRIMARY KEY ("simulation_id","position")
);

-- CreateTable
CREATE TABLE "simulation_answer_events" (
    "id" TEXT NOT NULL,
    "simulation_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_answer_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_simulations_student_id_idx" ON "exam_simulations"("student_id");

-- CreateIndex
CREATE INDEX "exam_simulations_enrollment_id_idx" ON "exam_simulations"("enrollment_id");

-- CreateIndex
CREATE INDEX "simulation_questions_question_id_idx" ON "simulation_questions"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_questions_simulation_id_question_id_key" ON "simulation_questions"("simulation_id", "question_id");

-- CreateIndex
CREATE INDEX "simulation_answer_events_simulation_id_position_idx" ON "simulation_answer_events"("simulation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_answer_events_simulation_id_sequence_key" ON "simulation_answer_events"("simulation_id", "sequence");

-- AddForeignKey
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_questions" ADD CONSTRAINT "simulation_questions_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "exam_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_questions" ADD CONSTRAINT "simulation_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_answer_events" ADD CONSTRAINT "simulation_answer_events_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "exam_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_answer_events" ADD CONSTRAINT "simulation_answer_events_simulation_id_position_fkey" FOREIGN KEY ("simulation_id", "position") REFERENCES "simulation_questions"("simulation_id", "position") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------------
-- Hand-written constraints (Prisma's DSL cannot express them).
-- ---------------------------------------------------------------------------------------------------------------------

-- A finalized simulation has exactly the finalization fields; an in-progress one has none. `finalized_by` agrees with the
-- status (a student submit is `submitted`; the deadline is `expired`). The result is written once, with the finalization.
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_finalization_consistent" CHECK (
  (
    "status" = 'in_progress'
    AND "finalized_at" IS NULL AND "finalized_by" IS NULL AND "result" IS NULL
  ) OR (
    "status" = 'submitted'
    AND "finalized_at" IS NOT NULL AND "finalized_by" = 'student_submit' AND "result" IS NOT NULL
  ) OR (
    "status" = 'expired'
    AND "finalized_at" IS NOT NULL AND "finalized_by" = 'deadline' AND "result" IS NOT NULL
  )
);

-- The deadline is after the start, and a finalization is never before the start.
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_deadline_after_start" CHECK ("deadline_at" > "started_at");
ALTER TABLE "exam_simulations" ADD CONSTRAINT "exam_simulations_finalized_not_before_start" CHECK ("finalized_at" IS NULL OR "finalized_at" >= "started_at");

-- At most ONE in-progress simulation per enrollment: a refresh, reconnect or double click can never create a second.
CREATE UNIQUE INDEX "exam_simulations_one_in_progress_per_enrollment" ON "exam_simulations"("enrollment_id") WHERE "status" = 'in_progress';

-- Positions and acceptance sequence numbers are positive.
ALTER TABLE "simulation_questions" ADD CONSTRAINT "simulation_questions_position_positive" CHECK ("position" > 0);
ALTER TABLE "simulation_answer_events" ADD CONSTRAINT "simulation_answer_events_sequence_positive" CHECK ("sequence" > 0);

-- NOT enforced by a constraint: that an answer is accepted strictly before the deadline and never after finalization. That needs
-- the server clock and the row lock, so the application enforces it (and the integration tests prove it, including races).
