-- Phase 9 Unit 1 (Production persistence foundation, docs/DECISIONS.md D-097).
-- Additive only: two NEW tables (student_preferences, orchestration_audits), their constraints, one trigger function and
-- one trigger. No existing table or column is altered and no existing row is touched.
-- These are the only two pieces of state earlier phases explicitly left unpersisted (D-095 preferences, D-096 audit);
-- everything else the production system needs was already persisted by migrations 0001-0016.
-- Reversal (controlled, manual): DROP TABLE orchestration_audits, student_preferences; DROP FUNCTION
-- orchestration_audits_append_only().

-- CreateTable
CREATE TABLE "student_preferences" (
    "student_id" TEXT NOT NULL,
    "language" TEXT,
    "verbosity" TEXT,
    "preferred_help" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_preferences_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "orchestration_audits" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "task" TEXT NOT NULL,
    "workflow_id" TEXT,
    "actor_kind" TEXT NOT NULL,
    "student_id" TEXT,
    "exam_code" TEXT,
    "status" TEXT NOT NULL,
    "fallback_occurred" BOOLEAN NOT NULL,
    "selection_rule" TEXT NOT NULL,
    "decided_by" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestration_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_audits_request_id_key" ON "orchestration_audits"("request_id");

-- CreateIndex
CREATE INDEX "orchestration_audits_student_id_occurred_at_idx" ON "orchestration_audits"("student_id", "occurred_at");

-- CreateIndex
CREATE INDEX "orchestration_audits_task_occurred_at_idx" ON "orchestration_audits"("task", "occurred_at");

-- AddForeignKey
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- An audit outlives its student: deleting a student detaches (never deletes) their audit rows. Whether audit rows must
-- instead be deleted with the student is an UNRESOLVED retention/legal decision (docs/DECISIONS.md D-097).
ALTER TABLE "orchestration_audits" ADD CONSTRAINT "orchestration_audits_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written constraints (Prisma cannot express them).
-- A preference is one of three explicit choices; the value sets are the closed vocabularies of @ipmat/tutor
-- (TUTOR_LANGUAGES, TUTOR_VERBOSITIES) and @ipmat/personalization (PREFERRED_HELP). There is deliberately no other column.
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_language_check" CHECK ("language" IS NULL OR "language" IN ('english', 'hindi', 'hinglish'));
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_verbosity_check" CHECK ("verbosity" IS NULL OR "verbosity" IN ('concise', 'standard', 'detailed'));
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_preferred_help_check" CHECK ("preferred_help" IS NULL OR "preferred_help" IN ('hint', 'guided_question', 'explanation'));

ALTER TABLE "orchestration_audits" ADD CONSTRAINT "orchestration_audits_actor_kind_check" CHECK ("actor_kind" IN ('student', 'staff'));
ALTER TABLE "orchestration_audits" ADD CONSTRAINT "orchestration_audits_status_check" CHECK ("status" IN ('completed', 'partial', 'failed', 'refused'));
ALTER TABLE "orchestration_audits" ADD CONSTRAINT "orchestration_audits_steps_array_check" CHECK (jsonb_typeof("steps") = 'array');
ALTER TABLE "orchestration_audits" ADD CONSTRAINT "orchestration_audits_request_id_nonblank_check" CHECK (length(btrim("request_id")) > 0);

-- Append-only: the only permitted UPDATE is the foreign key's own detach of a deleted student (student_id -> NULL with
-- every other column unchanged). Deletion is not blocked here: retention is an unresolved policy decision (D-097).
CREATE FUNCTION orchestration_audits_append_only() RETURNS trigger AS $$
BEGIN
  IF NEW.student_id IS NULL AND OLD.student_id IS NOT NULL
     AND ROW(NEW.id, NEW.request_id, NEW.occurred_at, NEW.task, NEW.workflow_id, NEW.actor_kind, NEW.exam_code, NEW.status,
             NEW.fallback_occurred, NEW.selection_rule, NEW.decided_by, NEW.steps, NEW.recorded_at)
         IS NOT DISTINCT FROM
         ROW(OLD.id, OLD.request_id, OLD.occurred_at, OLD.task, OLD.workflow_id, OLD.actor_kind, OLD.exam_code, OLD.status,
             OLD.fallback_occurred, OLD.selection_rule, OLD.decided_by, OLD.steps, OLD.recorded_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'orchestration_audits is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orchestration_audits_append_only_trg BEFORE UPDATE ON "orchestration_audits"
  FOR EACH ROW EXECUTE FUNCTION orchestration_audits_append_only();
