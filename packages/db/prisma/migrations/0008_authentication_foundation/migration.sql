-- Authentication foundation (Product Phase 1, Unit 4 -- see
-- docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's Unit 4 architecture
-- section for the full identity/session model decision). Hand-written
-- against prisma/schema.prisma (no live/shadow database has ever been
-- reachable in this environment -- see docs/MASTER_PLAN.md "Current
-- state"), following the same convention as 0002/0003/0006/0007's headers.
--
-- Adds email/password_hash to "students" (both nullable: an existing
-- auth_ref-based row -- the pre-Unit-4 seeded internal test student -- has
-- neither, and this migration does not touch that seed path) and a new
-- "sessions" table (server-authoritative session state; the bearer token
-- itself is never stored, only its SHA-256 digest via token_hash).

-- AlterTable
ALTER TABLE "students" ADD COLUMN "email" TEXT;
ALTER TABLE "students" ADD COLUMN "password_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "students_email_key" ON "students"("email");

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_student_id_idx" ON "sessions"("student_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
