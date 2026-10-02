-- Product Phase 6 Prompt 3 (Question Universe + Content Authoring, docs/DECISIONS.md D-084).
-- Additive only: one enum and eight NULLABLE columns on questions (authoring origin, content fingerprint, review record,
-- independent re-verification), plus the hand-written index/constraints below. No existing row is altered or invalidated.
-- Reversal (controlled, manual): drop the index/constraints named below, drop the eight columns, drop the enum.

-- CreateEnum
CREATE TYPE "QuestionAuthoringOrigin" AS ENUM ('human_authored', 'ai_generated');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "answer_verified_by_reviewer" BOOLEAN,
ADD COLUMN     "authoring_origin" "QuestionAuthoringOrigin",
ADD COLUMN     "content_fingerprint" TEXT,
ADD COLUMN     "independent_reverification_answer" TEXT,
ADD COLUMN     "review_notes" TEXT,
ADD COLUMN     "reviewed_as_distinct" BOOLEAN,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT;

-- Hand-written invariants (Prisma's schema DSL cannot express partial indexes or CHECK constraints; same approach
-- as migrations 0001, 0010, 0012 and 0013). docs/DECISIONS.md D-084.

-- 1. One logical question, one identity: no two NON-REJECTED questions of the same exam may share a content
--    fingerprint (normalized wording + option set). Partial, so (a) rows that pre-date the authoring layer
--    (fingerprint NULL) are untouched and (b) a rejected question never blocks re-authoring the same wording.
--    Until now the only duplicate guarantee was application-level (see D-050): this is the database backstop for
--    everything written through the authoring layer.
CREATE UNIQUE INDEX "questions_exam_content_fingerprint_unique"
  ON "questions" ("exam_id", "content_fingerprint")
  WHERE "content_fingerprint" IS NOT NULL AND "validation_state" <> 'rejected';

-- 2. Review data is all-or-none and never half-recorded.
ALTER TABLE "questions" ADD CONSTRAINT "questions_review_pair" CHECK (
  ("reviewed_by" IS NULL) = ("reviewed_at" IS NULL)
  AND ("reviewed_by" IS NULL OR btrim("reviewed_by") <> '')
);

-- 3. (Deliberately NOT a constraint.) "human_reviewed carries a review record" is enforced by the authoring layer's
--    `review` gate (`review_record_missing`), not by the database: pre-existing flows and test data legitimately hold
--    `human_reviewed` rows with no review record, and a CHECK here would break them (found by the Phase 5 integration
--    suite during verification). The review columns stay all-or-none (constraint 2) so a review is never half-recorded.

-- 3b. A fingerprint is only ever written together with a stated origin (authored rows always state theirs).
ALTER TABLE "questions" ADD CONSTRAINT "questions_fingerprint_needs_origin" CHECK (
  "content_fingerprint" IS NULL OR "authoring_origin" IS NOT NULL
);
