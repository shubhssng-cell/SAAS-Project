-- Product Phase 2 Unit 7 -- at most ONE open attempt per (student, question, enrollment).
--
-- Why: Phase 2 Unit 5 made `POST /v1/attempts` idempotent (a reload resumes the open attempt), but its
-- find-then-create only serializes inside one API process. Against a real Postgres, two API instances
-- racing on the same student+question each created an attempt (reproduced during Unit 7: 6 of 6 trials
-- with 20 parallel starts split across 2 instances produced duplicate open attempts). This partial unique
-- index is the database-level guarantee; `PrismaAttemptRepository.save()` maps the violation to a typed
-- `PersistenceError("conflict")`, and `PracticeApiService.startAttempt()` then resumes the winner.
--
-- Hand-written (Prisma's schema DSL cannot express a partial index -- the same reason
-- `questions_published_requires_provenance` and the block-membership CHECK are hand-written), and
-- verified against a real disposable Postgres 16 in Unit 7 (`prisma migrate deploy` from scratch, then
-- `prisma migrate diff` reported no drift).
--
-- Fails closed on existing data: if any student already holds two `in_progress` attempts for the same
-- question and enrollment, this statement fails rather than guessing which to abandon. No live database
-- existed before Unit 7, so none is expected; resolve by finalizing the older duplicates first.

-- CreateIndex
CREATE UNIQUE INDEX "attempts_one_open_per_student_question_enrollment" ON "attempts" ("student_id", "question_id", "enrollment_id") WHERE "status" = 'in_progress';
