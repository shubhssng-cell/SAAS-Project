-- Onboarding completion (Product Phase 1, Unit 6 -- see
-- docs/product-roadmap/PHASE_1_PLATFORM_SHELL.md's Unit 6 section). Hand-
-- written against prisma/schema.prisma (no live/shadow database has ever
-- been reachable in this environment -- see docs/MASTER_PLAN.md "Current
-- state"), following the same convention as every prior migration's header.
--
-- Nullable timestamp, not a boolean: null means "not yet completed," a
-- real timestamp means "completed at this moment" -- set exactly once
-- (StudentAccountRepository.completeOnboarding() never moves it once set,
-- the same "the fact IS the completion, not a separate flag" idea as
-- Session.revoked_at above).

-- AlterTable
ALTER TABLE "students" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
