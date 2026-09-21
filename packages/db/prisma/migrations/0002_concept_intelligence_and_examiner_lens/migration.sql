-- Phase 2: Concept Intelligence + Examiner Lens (docs/MASTER_PLAN.md).
-- Generated via `prisma migrate diff --from-schema-datamodel <phase-1
-- schema snapshot from git> --to-schema-datamodel prisma/schema.prisma`
-- rather than `migrate dev`, since no live/shadow database was available
-- in the implementing environment (see the Phase 2 report). Safe to apply
-- to a fresh database or directly after 0001_init — no environment has
-- ever had data in the tables this migration alters, since 0001 was also
-- never applied to a live database (see docs/MASTER_PLAN.md "Current
-- state"). `error_taxonomies.category` and the new NOT NULL ConceptRelation
-- columns rely on that: they would need a backfill step if any target
-- database already held rows.

-- CreateEnum
CREATE TYPE "RequirementLevel" AS ENUM ('required', 'optional', 'contextual');

-- CreateEnum
CREATE TYPE "Certainty" AS ENUM ('confirmed', 'probable', 'speculative');

-- CreateEnum
CREATE TYPE "AuthorshipSource" AS ENUM ('human', 'ai');

-- CreateEnum
CREATE TYPE "TestingMode" AS ENUM ('direct', 'reverse', 'transformed', 'combined', 'contextualized', 'represented_differently', 'constrained', 'time_pressured', 'multi_step', 'novel_representation');

-- CreateEnum
CREATE TYPE "PatternFamilyStatus" AS ENUM ('draft', 'reviewed', 'published');

-- CreateEnum
CREATE TYPE "NoveltyLevel" AS ENUM ('standard', 'novel_representation', 'novel_combination', 'novel_context');

-- CreateEnum
CREATE TYPE "ExamRelevance" AS ENUM ('core', 'peripheral', 'stretch');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('misconception', 'trap', 'calculation_mistake', 'interpretation_mistake', 'method_selection_mistake');

-- AlterEnum
BEGIN;
CREATE TYPE "RelationType_new" AS ENUM ('prerequisite', 'foundational', 'directly_related', 'commonly_combined', 'application', 'dependent', 'advanced_extension', 'related_but_distinct');
ALTER TABLE "concept_relations" ALTER COLUMN "type" TYPE "RelationType_new" USING ("type"::text::"RelationType_new");
ALTER TYPE "RelationType" RENAME TO "RelationType_old";
ALTER TYPE "RelationType_new" RENAME TO "RelationType";
DROP TYPE "RelationType_old";
COMMIT;

-- DropIndex
DROP INDEX "pattern_taxonomy_cells_concept_id_pattern_name_transformati_key";

-- AlterTable
ALTER TABLE "concept_relations" DROP COLUMN "strength",
ADD COLUMN     "certainty" "Certainty" NOT NULL,
ADD COLUMN     "rationale" TEXT NOT NULL,
ADD COLUMN     "requirement_level" "RequirementLevel" NOT NULL,
ADD COLUMN     "shared_knowledge" TEXT NOT NULL,
ADD COLUMN     "useful_for_question_generation" BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE "examiner_lens_analyses" DROP COLUMN "legitimate_patterns",
DROP COLUMN "novel_representations",
DROP COLUMN "prerequisites_exercised",
DROP COLUMN "transformations",
DROP COLUMN "valid_combinations",
DROP COLUMN "valid_traps",
DROP COLUMN "what_is_tested",
ADD COLUMN     "authored_by" "AuthorshipSource" NOT NULL DEFAULT 'human',
ADD COLUMN     "difficulty_dimensions" JSONB NOT NULL,
ADD COLUMN     "error_modes" JSONB NOT NULL,
ADD COLUMN     "testing_modes" "TestingMode"[],
ADD COLUMN     "what_is_tested_concept" TEXT NOT NULL,
ADD COLUMN     "what_is_tested_prerequisite_id" TEXT,
ADD COLUMN     "what_is_tested_skill" TEXT NOT NULL,
ADD COLUMN     "what_is_tested_subconcept" TEXT NOT NULL,
ALTER COLUMN "generated_by_provider" DROP NOT NULL,
ALTER COLUMN "prompt_version" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pattern_taxonomy_cells" DROP COLUMN "pattern_name",
DROP COLUMN "transformation",
DROP COLUMN "trap_type",
ADD COLUMN     "pattern_family_id" TEXT NOT NULL,
ADD COLUMN     "testing_mode" "TestingMode",
ADD COLUMN     "trap_error_taxonomy_id" TEXT;

-- AlterTable
ALTER TABLE "questions" DROP COLUMN "transformation",
DROP COLUMN "trap_type",
ADD COLUMN     "combines_with_concept_ids" TEXT[],
ADD COLUMN     "exam_relevance" "ExamRelevance" NOT NULL DEFAULT 'core',
ADD COLUMN     "novelty_level" "NoveltyLevel" NOT NULL DEFAULT 'standard',
ADD COLUMN     "testing_modes" "TestingMode"[],
ADD COLUMN     "trap_error_taxonomy_id" TEXT;

-- AlterTable
ALTER TABLE "error_taxonomies" ADD COLUMN     "category" "ErrorCategory" NOT NULL;

-- DropEnum
DROP TYPE "RelationStrength";

-- CreateTable
CREATE TABLE "concept_depths" (
    "id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "intuition" TEXT NOT NULL,
    "formulas" JSONB NOT NULL,
    "methods" JSONB NOT NULL,
    "alternative_methods" JSONB NOT NULL,
    "shortcuts" JSONB NOT NULL,
    "common_misconceptions" JSONB NOT NULL,
    "common_traps" JSONB NOT NULL,
    "application_areas" JSONB NOT NULL,
    "difficulty_progression" JSONB NOT NULL,
    "status" "ConceptStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_depths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_pattern_families" (
    "id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "examiner_lens_analysis_id" TEXT,
    "name" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expected_difficulty_tier" "DifficultyTier" NOT NULL,
    "potential_combination_concept_ids" TEXT[],
    "potential_trap_error_taxonomy_ids" TEXT[],
    "potential_testing_modes" "TestingMode"[],
    "status" "PatternFamilyStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_pattern_families_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concept_depths_concept_id_key" ON "concept_depths"("concept_id");

-- CreateIndex
CREATE INDEX "question_pattern_families_concept_id_idx" ON "question_pattern_families"("concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_pattern_families_concept_id_name_key" ON "question_pattern_families"("concept_id", "name");

-- CreateIndex
CREATE INDEX "pattern_taxonomy_cells_pattern_family_id_idx" ON "pattern_taxonomy_cells"("pattern_family_id");

-- CreateIndex
CREATE UNIQUE INDEX "pattern_taxonomy_cells_concept_id_pattern_family_id_testing_key" ON "pattern_taxonomy_cells"("concept_id", "pattern_family_id", "testing_mode", "trap_error_taxonomy_id", "difficulty_tier");

-- AddForeignKey
ALTER TABLE "concept_depths" ADD CONSTRAINT "concept_depths_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examiner_lens_analyses" ADD CONSTRAINT "examiner_lens_analyses_what_is_tested_prerequisite_id_fkey" FOREIGN KEY ("what_is_tested_prerequisite_id") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_pattern_families" ADD CONSTRAINT "question_pattern_families_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_pattern_families" ADD CONSTRAINT "question_pattern_families_examiner_lens_analysis_id_fkey" FOREIGN KEY ("examiner_lens_analysis_id") REFERENCES "examiner_lens_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_taxonomy_cells" ADD CONSTRAINT "pattern_taxonomy_cells_pattern_family_id_fkey" FOREIGN KEY ("pattern_family_id") REFERENCES "question_pattern_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_taxonomy_cells" ADD CONSTRAINT "pattern_taxonomy_cells_trap_error_taxonomy_id_fkey" FOREIGN KEY ("trap_error_taxonomy_id") REFERENCES "error_taxonomies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_trap_error_taxonomy_id_fkey" FOREIGN KEY ("trap_error_taxonomy_id") REFERENCES "error_taxonomies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

