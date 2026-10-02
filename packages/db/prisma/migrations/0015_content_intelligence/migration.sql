-- Product Phase 6 Prompt 4 (Content Intelligence pipeline, docs/DECISIONS.md D-085).
-- Additive only: five enums and five NEW tables (content_sources, content_source_versions, content_chunks,
-- content_candidates, content_candidate_evidence). No existing table is altered; no existing row is touched.
-- Raw documents are NOT stored: only a content hash and the extracted chunks.
-- Reversal (controlled, manual): DROP the five tables (evidence, candidates, chunks, versions, sources - in that order), then the five enums.

-- CreateEnum
CREATE TYPE "ContentIngestionState" AS ENUM ('registered', 'accepted', 'extracted', 'normalized', 'chunked', 'enriched', 'reviewed', 'available', 'failed');

-- CreateEnum
CREATE TYPE "ContentChunkValidation" AS ENUM ('unreviewed', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "ContentCandidateKind" AS ENUM ('concept_mention', 'relationship', 'question');

-- CreateEnum
CREATE TYPE "ContentCandidateState" AS ENUM ('candidate', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "ContentProposerKind" AS ENUM ('deterministic', 'ai_assisted', 'human');

-- CreateTable
CREATE TABLE "content_sources" (
    "id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "source_ref" TEXT,
    "license_ref" TEXT,
    "attributed_to" TEXT,
    "authority" TEXT,
    "data_origin" "HistoricalDataOrigin" NOT NULL,
    "fixture_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_source_versions" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "state" "ContentIngestionState" NOT NULL,
    "failure_stage" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_source_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_chunks" (
    "id" TEXT NOT NULL,
    "source_version_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "heading_path" TEXT[],
    "line_start" INTEGER NOT NULL,
    "line_end" INTEGER NOT NULL,
    "char_start" INTEGER NOT NULL,
    "char_end" INTEGER NOT NULL,
    "block_kinds" TEXT[],
    "validation_state" "ContentChunkValidation" NOT NULL DEFAULT 'unreviewed',

    CONSTRAINT "content_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_candidates" (
    "id" TEXT NOT NULL,
    "source_version_id" TEXT NOT NULL,
    "kind" "ContentCandidateKind" NOT NULL,
    "state" "ContentCandidateState" NOT NULL DEFAULT 'candidate',
    "proposer_kind" "ContentProposerKind" NOT NULL,
    "proposed_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_candidate_evidence" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "char_start" INTEGER NOT NULL,
    "char_end" INTEGER NOT NULL,

    CONSTRAINT "content_candidate_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_sources_exam_id_source_key_key" ON "content_sources"("exam_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "content_source_versions_source_id_content_hash_key" ON "content_source_versions"("source_id", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "content_source_versions_source_id_version_key" ON "content_source_versions"("source_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "content_chunks_source_version_id_ordinal_key" ON "content_chunks"("source_version_id", "ordinal");

-- CreateIndex
CREATE INDEX "content_candidates_source_version_id_state_idx" ON "content_candidates"("source_version_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "content_candidate_evidence_candidate_id_ordinal_key" ON "content_candidate_evidence"("candidate_id", "ordinal");

-- AddForeignKey
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_source_versions" ADD CONSTRAINT "content_source_versions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "content_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "content_source_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_candidates" ADD CONSTRAINT "content_candidates_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "content_source_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_candidate_evidence" ADD CONSTRAINT "content_candidate_evidence_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "content_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_candidate_evidence" ADD CONSTRAINT "content_candidate_evidence_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "content_chunks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written invariants (Prisma's schema DSL cannot express CHECK constraints; same approach as migrations 0001,
-- 0013, 0014). docs/DECISIONS.md D-085. Each mirrors a rule the domain (`@ipmat/content-intelligence`) enforces, so a row
-- that bypasses the application layer still cannot violate it. The tables are new and empty, so nothing can violate these.

-- A source's identity and reference are never blank.
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_key_format" CHECK ("source_key" ~ '^[a-z0-9][a-z0-9._-]{0,63}$' AND btrim("title") <> '');

-- RIGHTS BOUNDARY (free-to-access is not free-to-copy): third-party material must be traceable (source_ref), carry a rights
-- basis (license_ref) unless public domain, and name its owner (authority) unless original/public domain. A source that
-- fails this cannot exist, so unauthorized material can never be persisted in the pipeline.
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_rights" CHECK (
  "source_type" = 'original'
  OR (
    "source_ref" IS NOT NULL AND btrim("source_ref") <> ''
    AND ("source_type" = 'public_domain' OR (
      "license_ref" IS NOT NULL AND btrim("license_ref") <> ''
      AND "authority" IS NOT NULL AND btrim("authority") <> ''
    ))
  )
);

-- Narrow guard: a reference naming a known unauthorized-distribution channel is refused at the database too.
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_no_unauthorized_marker" CHECK (
  NOT (
    coalesce("source_ref", '') ~* '(t\.me/|telegram|torrent|libgen|z-?library|sci-?hub|pirat)'
    OR coalesce("license_ref", '') ~* '(t\.me/|telegram|torrent|libgen|z-?library|sci-?hub|pirat)'
    OR coalesce("attributed_to", '') ~* '(t\.me/|telegram|torrent|libgen|z-?library|sci-?hub|pirat)'
  )
);

-- Real source vs fixture is never ambiguous (same rule as historical records, migration 0013).
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_fixture_vs_real_source" CHECK (
  (
    "data_origin" = 'fixture'
    AND "fixture_label" IS NOT NULL AND btrim("fixture_label") <> ''
    AND "source_type" = 'original'
    AND coalesce("source_ref", '') LIKE 'fixture:%'
  ) OR (
    "data_origin" = 'real_source'
    AND "fixture_label" IS NULL
    AND coalesce("source_ref", '') NOT LIKE 'fixture:%'
  )
);

-- A version is identified by a real sha256 and a sane size; its failure is recorded iff it failed. `format` is the
-- format the caller DECLARED (non-blank text, NOT restricted to the supported set): an unsupported format must be
-- representable, because it is recorded as a `failed` version with code `unsupported_format` rather than silently dropped.
ALTER TABLE "content_source_versions" ADD CONSTRAINT "content_source_versions_shape" CHECK (
  "content_hash" ~ '^[0-9a-f]{64}$'
  AND btrim("format") <> ''
  AND "byte_length" >= 0 AND "version" >= 1 AND "attempts" >= 0
);
ALTER TABLE "content_source_versions" ADD CONSTRAINT "content_source_versions_failure_matches_state" CHECK (
  ("state" = 'failed') = ("failure_stage" IS NOT NULL AND "failure_code" IS NOT NULL AND "failure_message" IS NOT NULL)
  AND ("state" = 'failed' OR ("failure_stage" IS NULL AND "failure_code" IS NULL AND "failure_message" IS NULL))
);

-- Chunk spans are sane and its text hash is a sha256.
ALTER TABLE "content_chunks" ADD CONSTRAINT "content_chunks_shape" CHECK (
  "ordinal" >= 0 AND "line_start" >= 1 AND "line_end" >= "line_start"
  AND "char_start" >= 0 AND "char_end" > "char_start"
  AND "text_hash" ~ '^[0-9a-f]{64}$' AND btrim("text") <> ''
);

-- A decision is all-or-none and final: a candidate is undecided iff it has no reviewer; a decided one names a reviewer.
ALTER TABLE "content_candidates" ADD CONSTRAINT "content_candidates_review_matches_state" CHECK (
  ("state" = 'candidate') = ("reviewed_by" IS NULL AND "reviewed_at" IS NULL)
  AND ("reviewed_by" IS NULL OR btrim("reviewed_by") <> '')
  AND btrim("proposed_by") <> ''
);

-- Evidence is real in shape: a non-blank quote with a positive span.
ALTER TABLE "content_candidate_evidence" ADD CONSTRAINT "content_candidate_evidence_shape" CHECK (
  btrim("quote") <> '' AND "char_start" >= 0 AND "char_end" > "char_start" AND "ordinal" >= 0
);
