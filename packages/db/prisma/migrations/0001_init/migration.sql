-- CreateEnum
CREATE TYPE "ConceptStatus" AS ENUM ('draft', 'curated', 'ai_assisted', 'published');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('prerequisite_of', 'related_to', 'combines_with');

-- CreateEnum
CREATE TYPE "RelationStrength" AS ENUM ('weak', 'moderate', 'strong');

-- CreateEnum
CREATE TYPE "RelationSource" AS ENUM ('human', 'ai_suggested');

-- CreateEnum
CREATE TYPE "LensStatus" AS ENUM ('draft', 'reviewed', 'published');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('uncovered', 'in_generation', 'covered');

-- CreateEnum
CREATE TYPE "DifficultyTier" AS ENUM ('standard', 'advanced', 'hard', 'extreme', 'novel');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('original', 'licensed', 'public_domain', 'open_license', 'official', 'user_authorized');

-- CreateEnum
CREATE TYPE "ValidationState" AS ENUM ('draft', 'ai_validated', 'human_reviewed', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "ReasoningInputMode" AS ENUM ('text', 'voice');

-- CreateEnum
CREATE TYPE "AttemptEventType" AS ENUM ('question_opened', 'option_selected', 'option_changed', 'hint_requested', 'solution_opened', 'working_input_changed', 'reasoning_submitted', 'answer_submitted');

-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "exam_date_rule" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concepts" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ConceptStatus" NOT NULL DEFAULT 'draft',

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_relations" (
    "id" TEXT NOT NULL,
    "from_concept_id" TEXT NOT NULL,
    "to_concept_id" TEXT NOT NULL,
    "type" "RelationType" NOT NULL,
    "strength" "RelationStrength" NOT NULL,
    "source" "RelationSource" NOT NULL,

    CONSTRAINT "concept_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examiner_lens_analyses" (
    "id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "what_is_tested" JSONB NOT NULL,
    "prerequisites_exercised" TEXT[],
    "legitimate_patterns" JSONB NOT NULL,
    "valid_combinations" TEXT[],
    "valid_traps" JSONB NOT NULL,
    "transformations" JSONB NOT NULL,
    "novel_representations" JSONB NOT NULL,
    "generated_by_provider" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "status" "LensStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "examiner_lens_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pattern_taxonomy_cells" (
    "id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "examiner_lens_analysis_id" TEXT NOT NULL,
    "pattern_name" TEXT NOT NULL,
    "combination" TEXT[],
    "transformation" TEXT,
    "trap_type" TEXT,
    "difficulty_tier" "DifficultyTier" NOT NULL,
    "target_time_seconds" INTEGER NOT NULL,
    "coverage_status" "CoverageStatus" NOT NULL DEFAULT 'uncovered',

    CONSTRAINT "pattern_taxonomy_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provenances" (
    "id" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "source_ref" TEXT,
    "license_ref" TEXT,
    "attributed_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "subconcepts" TEXT[],
    "prerequisites" TEXT[],
    "pattern_taxonomy_cell_id" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "difficulty_tier" "DifficultyTier" NOT NULL,
    "difficulty_dimensions" JSONB NOT NULL,
    "expected_time_seconds" INTEGER NOT NULL,
    "trap_type" TEXT,
    "transformation" TEXT,
    "body" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_answer" TEXT NOT NULL,
    "solution_steps" JSONB NOT NULL,
    "ground_truth_derivation" JSONB NOT NULL,
    "validation_state" "ValidationState" NOT NULL DEFAULT 'draft',
    "provenance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "auth_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "retry_of_attempt_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "time_spent_seconds" INTEGER,
    "chosen_answer" TEXT,
    "is_correct" BOOLEAN,
    "hints_used" INTEGER NOT NULL DEFAULT 0,
    "solution_opened_at" TIMESTAMP(3),
    "working_steps" JSONB,
    "reasoning_text" TEXT,
    "reasoning_input_mode" "ReasoningInputMode" NOT NULL DEFAULT 'text',
    "reasoning_audio_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_events" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "event_type" "AttemptEventType" NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attempt_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_taxonomies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "error_taxonomies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopsies" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "hypothesis_text" TEXT NOT NULL,
    "error_taxonomy_id" TEXT,
    "likely_root_cause" TEXT,
    "evidence_used" JSONB NOT NULL,
    "confirmed" BOOLEAN,
    "student_correction_text" TEXT,
    "generated_by_provider" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autopsies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_plans" (
    "id" TEXT NOT NULL,
    "autopsy_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "target_concept_id" TEXT NOT NULL,
    "target_error_taxonomy_id" TEXT,
    "follow_up_question_ids" TEXT[],
    "status" "RepairStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastery_states" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "speed_ratio" DOUBLE PRECISION NOT NULL,
    "novelty_handling" DOUBLE PRECISION NOT NULL,
    "pressure_performance" DOUBLE PRECISION NOT NULL,
    "pattern_coverage" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mastery_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prep_phase_templates" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "phase_curve" JSONB NOT NULL,

    CONSTRAINT "prep_phase_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catch_up_plans" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "overlay" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catch_up_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exams_code_key" ON "exams"("code");

-- CreateIndex
CREATE INDEX "sections_exam_id_idx" ON "sections"("exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_exam_id_name_key" ON "sections"("exam_id", "name");

-- CreateIndex
CREATE INDEX "chapters_section_id_idx" ON "chapters"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_section_id_name_key" ON "chapters"("section_id", "name");

-- CreateIndex
CREATE INDEX "concepts_chapter_id_idx" ON "concepts"("chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_chapter_id_name_key" ON "concepts"("chapter_id", "name");

-- CreateIndex
CREATE INDEX "concept_relations_from_concept_id_idx" ON "concept_relations"("from_concept_id");

-- CreateIndex
CREATE INDEX "concept_relations_to_concept_id_idx" ON "concept_relations"("to_concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "concept_relations_from_concept_id_to_concept_id_type_key" ON "concept_relations"("from_concept_id", "to_concept_id", "type");

-- CreateIndex
CREATE INDEX "examiner_lens_analyses_concept_id_idx" ON "examiner_lens_analyses"("concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "examiner_lens_analyses_concept_id_version_key" ON "examiner_lens_analyses"("concept_id", "version");

-- CreateIndex
CREATE INDEX "pattern_taxonomy_cells_concept_id_idx" ON "pattern_taxonomy_cells"("concept_id");

-- CreateIndex
CREATE INDEX "pattern_taxonomy_cells_examiner_lens_analysis_id_idx" ON "pattern_taxonomy_cells"("examiner_lens_analysis_id");

-- CreateIndex
CREATE INDEX "pattern_taxonomy_cells_coverage_status_idx" ON "pattern_taxonomy_cells"("coverage_status");

-- CreateIndex
CREATE UNIQUE INDEX "pattern_taxonomy_cells_concept_id_pattern_name_transformati_key" ON "pattern_taxonomy_cells"("concept_id", "pattern_name", "transformation", "trap_type", "difficulty_tier");

-- CreateIndex
CREATE INDEX "questions_concept_id_idx" ON "questions"("concept_id");

-- CreateIndex
CREATE INDEX "questions_pattern_taxonomy_cell_id_idx" ON "questions"("pattern_taxonomy_cell_id");

-- CreateIndex
CREATE INDEX "questions_validation_state_idx" ON "questions"("validation_state");

-- CreateIndex
CREATE UNIQUE INDEX "students_auth_ref_key" ON "students"("auth_ref");

-- CreateIndex
CREATE INDEX "enrollments_exam_id_idx" ON "enrollments"("exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_student_id_exam_id_key" ON "enrollments"("student_id", "exam_id");

-- CreateIndex
CREATE INDEX "attempts_student_id_idx" ON "attempts"("student_id");

-- CreateIndex
CREATE INDEX "attempts_question_id_idx" ON "attempts"("question_id");

-- CreateIndex
CREATE INDEX "attempts_enrollment_id_idx" ON "attempts"("enrollment_id");

-- CreateIndex
CREATE INDEX "attempts_retry_of_attempt_id_idx" ON "attempts"("retry_of_attempt_id");

-- CreateIndex
CREATE INDEX "attempt_events_attempt_id_idx" ON "attempt_events"("attempt_id");

-- CreateIndex
CREATE INDEX "attempt_events_attempt_id_occurred_at_idx" ON "attempt_events"("attempt_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "error_taxonomies_code_key" ON "error_taxonomies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "autopsies_attempt_id_key" ON "autopsies"("attempt_id");

-- CreateIndex
CREATE INDEX "autopsies_error_taxonomy_id_idx" ON "autopsies"("error_taxonomy_id");

-- CreateIndex
CREATE INDEX "repair_plans_autopsy_id_idx" ON "repair_plans"("autopsy_id");

-- CreateIndex
CREATE INDEX "repair_plans_student_id_idx" ON "repair_plans"("student_id");

-- CreateIndex
CREATE INDEX "mastery_states_student_id_idx" ON "mastery_states"("student_id");

-- CreateIndex
CREATE INDEX "mastery_states_concept_id_idx" ON "mastery_states"("concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "mastery_states_student_id_concept_id_key" ON "mastery_states"("student_id", "concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "prep_phase_templates_exam_id_key" ON "prep_phase_templates"("exam_id");

-- CreateIndex
CREATE INDEX "catch_up_plans_student_id_idx" ON "catch_up_plans"("student_id");

-- CreateIndex
CREATE INDEX "catch_up_plans_enrollment_id_idx" ON "catch_up_plans"("enrollment_id");

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_from_concept_id_fkey" FOREIGN KEY ("from_concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_to_concept_id_fkey" FOREIGN KEY ("to_concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examiner_lens_analyses" ADD CONSTRAINT "examiner_lens_analyses_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_taxonomy_cells" ADD CONSTRAINT "pattern_taxonomy_cells_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_taxonomy_cells" ADD CONSTRAINT "pattern_taxonomy_cells_examiner_lens_analysis_id_fkey" FOREIGN KEY ("examiner_lens_analysis_id") REFERENCES "examiner_lens_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_pattern_taxonomy_cell_id_fkey" FOREIGN KEY ("pattern_taxonomy_cell_id") REFERENCES "pattern_taxonomy_cells"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_provenance_id_fkey" FOREIGN KEY ("provenance_id") REFERENCES "provenances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_retry_of_attempt_id_fkey" FOREIGN KEY ("retry_of_attempt_id") REFERENCES "attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopsies" ADD CONSTRAINT "autopsies_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopsies" ADD CONSTRAINT "autopsies_error_taxonomy_id_fkey" FOREIGN KEY ("error_taxonomy_id") REFERENCES "error_taxonomies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_plans" ADD CONSTRAINT "repair_plans_autopsy_id_fkey" FOREIGN KEY ("autopsy_id") REFERENCES "autopsies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_plans" ADD CONSTRAINT "repair_plans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_plans" ADD CONSTRAINT "repair_plans_target_error_taxonomy_id_fkey" FOREIGN KEY ("target_error_taxonomy_id") REFERENCES "error_taxonomies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_states" ADD CONSTRAINT "mastery_states_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prep_phase_templates" ADD CONSTRAINT "prep_phase_templates_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_up_plans" ADD CONSTRAINT "catch_up_plans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catch_up_plans" ADD CONSTRAINT "catch_up_plans_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written invariant (Prisma's schema DSL has no CHECK constraint syntax):
-- Question DNA is enforced, not conventional (docs/DATABASE.md) — a question
-- can never be marked 'published' without a Provenance record attached.
ALTER TABLE "questions" ADD CONSTRAINT "questions_published_requires_provenance"
  CHECK (validation_state <> 'published' OR provenance_id IS NOT NULL);

