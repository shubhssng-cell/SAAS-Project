-- Product Phase 6 Prompt 2 (Historical Examiner Intelligence, docs/DECISIONS.md D-083).
-- Adds ONLY new objects: three enums and the historical_question_records table (no existing table is altered).
-- Reversal (controlled, manual - same convention as earlier migrations): DROP TABLE historical_question_records; then DROP TYPE the three enums.

-- CreateEnum
CREATE TYPE "HistoricalDataOrigin" AS ENUM ('real_source', 'fixture');

-- CreateEnum
CREATE TYPE "HistoricalAnnotationState" AS ENUM ('raw_imported', 'candidate_annotation', 'reviewed_validated');

-- CreateEnum
CREATE TYPE "AnnotationAuthorshipKind" AS ENUM ('human', 'ai_assisted');

-- CreateTable
CREATE TABLE "historical_question_records" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "exam_version" TEXT,
    "exam_year" INTEGER,
    "exam_session" TEXT,
    "question_label" TEXT,
    "source_type" "SourceType" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "license_ref" TEXT,
    "attributed_to" TEXT,
    "data_origin" "HistoricalDataOrigin" NOT NULL,
    "fixture_label" TEXT,
    "annotation_state" "HistoricalAnnotationState" NOT NULL,
    "authorship" "AnnotationAuthorshipKind",
    "proposed_by" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "editorial_relevance" "ExamRelevance",
    "editorial_rationale" TEXT,
    "editorial_annotated_by" TEXT,
    "section_id" TEXT,
    "chapter_id" TEXT,
    "concept_id" TEXT,
    "pattern_family_id" TEXT,
    "subconcept_ids" TEXT[],
    "prerequisite_ids" TEXT[],
    "combines_with_concept_ids" TEXT[],
    "skill" TEXT,
    "difficulty_tier" "DifficultyTier",
    "difficulty_dimensions" JSONB,
    "novelty_level" "NoveltyLevel",
    "expected_time_seconds" INTEGER,
    "testing_modes" "TestingMode"[],
    "trap_error_taxonomy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_question_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historical_question_records_exam_id_annotation_state_data_o_idx" ON "historical_question_records"("exam_id", "annotation_state", "data_origin");

-- CreateIndex
CREATE INDEX "historical_question_records_concept_id_idx" ON "historical_question_records"("concept_id");

-- CreateIndex
CREATE INDEX "historical_question_records_pattern_family_id_idx" ON "historical_question_records"("pattern_family_id");

-- AddForeignKey
ALTER TABLE "historical_question_records" ADD CONSTRAINT "historical_question_records_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_question_records" ADD CONSTRAINT "historical_question_records_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_question_records" ADD CONSTRAINT "historical_question_records_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_question_records" ADD CONSTRAINT "historical_question_records_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_question_records" ADD CONSTRAINT "historical_question_records_pattern_family_id_fkey" FOREIGN KEY ("pattern_family_id") REFERENCES "question_pattern_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_question_records" ADD CONSTRAINT "historical_question_records_trap_error_taxonomy_id_fkey" FOREIGN KEY ("trap_error_taxonomy_id") REFERENCES "error_taxonomies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written invariants (Prisma's schema DSL cannot express CHECK constraints; same approach as
-- questions_published_requires_provenance in 0001). docs/DECISIONS.md D-083. Each mirrors a rule that
-- `validateHistoricalRecord()` (@ipmat/examiner-intelligence) enforces in the domain, so a record that bypasses the
-- application layer still cannot violate them. Fails closed: the table is new and empty, so no data can violate these.

-- Every historical artifact is traceable to a source.
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_source_ref_not_blank" CHECK (btrim("source_ref") <> '');

-- Fixture vs real source is never ambiguous: a fixture carries a label, is project-authored ("original") and its
-- source reference says "fixture:"; a real source is never "original", never labelled, and states its rights basis
-- unless it is public domain (free-to-access is not free-to-copy).
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_fixture_vs_real_source" CHECK (
  (
    "data_origin" = 'fixture'
    AND "fixture_label" IS NOT NULL AND btrim("fixture_label") <> ''
    AND "source_type" = 'original'
    AND "source_ref" LIKE 'fixture:%'
  ) OR (
    "data_origin" = 'real_source'
    AND "fixture_label" IS NULL
    AND "source_type" <> 'original'
    AND ("source_type" = 'public_domain' OR ("license_ref" IS NOT NULL AND btrim("license_ref") <> ''))
  )
);

-- A raw import has no classification, authorship, review or editorial annotation.
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_raw_has_no_classification" CHECK (
  "annotation_state" <> 'raw_imported' OR (
    "section_id" IS NULL AND "chapter_id" IS NULL AND "concept_id" IS NULL AND "pattern_family_id" IS NULL
    AND "skill" IS NULL AND "difficulty_tier" IS NULL AND "difficulty_dimensions" IS NULL
    AND "novelty_level" IS NULL AND "expected_time_seconds" IS NULL AND "trap_error_taxonomy_id" IS NULL
    AND cardinality("testing_modes") = 0 AND cardinality("subconcept_ids") = 0
    AND cardinality("prerequisite_ids") = 0 AND cardinality("combines_with_concept_ids") = 0
    AND "authorship" IS NULL AND "proposed_by" IS NULL AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL
    AND "editorial_relevance" IS NULL
  )
);

-- A candidate or reviewed record has a complete classification and says who produced it.
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_classified_is_complete" CHECK (
  "annotation_state" = 'raw_imported' OR (
    "section_id" IS NOT NULL AND "chapter_id" IS NOT NULL AND "concept_id" IS NOT NULL AND "pattern_family_id" IS NOT NULL
    AND "skill" IS NOT NULL AND btrim("skill") <> '' AND "difficulty_tier" IS NOT NULL AND "difficulty_dimensions" IS NOT NULL
    AND "novelty_level" IS NOT NULL AND "expected_time_seconds" IS NOT NULL AND "expected_time_seconds" > 0
    AND cardinality("testing_modes") > 0 AND "authorship" IS NOT NULL
  )
);

-- An AI proposal is never authoritative on its own: reviewed_validated REQUIRES a named reviewer and a time, a
-- candidate must NOT carry a review, and an ai_assisted annotation names its proposer (a human one does not).
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_review_matches_state" CHECK (
  ("annotation_state" = 'reviewed_validated') = ("reviewed_by" IS NOT NULL AND btrim("reviewed_by") <> '' AND "reviewed_at" IS NOT NULL)
  AND ("reviewed_by" IS NULL OR "annotation_state" = 'reviewed_validated')
);
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_authorship_proposer" CHECK (
  ("authorship" = 'ai_assisted') = ("proposed_by" IS NOT NULL AND btrim("proposed_by") <> '')
  AND ("authorship" = 'ai_assisted' OR "proposed_by" IS NULL)
);

-- Editorial relevance (an annotation, not evidence and not a prediction): all three parts or none.
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_editorial_all_or_none" CHECK (
  ("editorial_relevance" IS NULL AND "editorial_rationale" IS NULL AND "editorial_annotated_by" IS NULL)
  OR ("editorial_relevance" IS NOT NULL AND "editorial_rationale" IS NOT NULL AND btrim("editorial_rationale") <> ''
      AND "editorial_annotated_by" IS NOT NULL AND btrim("editorial_annotated_by") <> '')
);

-- A year, where present, is a plausible year.
ALTER TABLE "historical_question_records" ADD CONSTRAINT "hqr_year_plausible" CHECK ("exam_year" IS NULL OR ("exam_year" BETWEEN 1900 AND 2100));
