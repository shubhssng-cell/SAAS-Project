-- Phase 4 Unit 3 -- at most ONE RepairPlan per Autopsy.
--
-- Why: a student's confirmation of one hypothesis (one autopsy row, unique per attempt) must never be able to produce more than one
-- RepairPlan, whatever races, retries or second API instances do. `PrismaAutopsyDecisionRepository.respond()` already creates the plan
-- only inside the single transaction that wins the once-only conditional update; this unique index is the database-level backstop.
-- (A student can still receive many plans over time: each comes from a different autopsy.)
--
-- Replaces the non-unique `repair_plans_autopsy_id_idx` (a unique index serves the same lookups).
-- Fails closed on existing data: if any autopsy already has two plans this statement fails rather than guessing which to keep.

-- DropIndex
DROP INDEX "repair_plans_autopsy_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "repair_plans_autopsy_id_key" ON "repair_plans"("autopsy_id");
