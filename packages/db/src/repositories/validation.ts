import { HypothesisError, type AutopsyHypothesis, type AutopsyOutput, type RepairPlan } from "@ipmat/autopsy";
import type { MasteryStatePersistenceRecord } from "@ipmat/mastery";
import { PersistenceError } from "./errors.js";

/**
 * Pure, database-independent validation shared by every `PrismaXRepository`
 * AND its `InMemoryXRepository` test double (packages/db/test/fixtures/
 * inMemoryRepositories.ts). Extracted here specifically so the two
 * implementations cannot silently diverge — before this, each repository
 * pair carried its own copy of "is this safe to write," which a future
 * edit to one side could drift out of sync with the other without any test
 * catching it. None of these functions touch Prisma or any I/O; they only
 * inspect plain objects, which is what makes reusing them from an
 * in-memory test double both possible and safe.
 */

/** Shared by `AutopsyRepository.save()` implementations — refuses to persist a hypothesis/output pair whose attemptIds don't agree, the same linkage `buildRepairPlan()` (`@ipmat/autopsy`) already checks on the domain side; this is defense-in-depth at the persistence boundary, not a claim that the domain layer's own guarantee is insufficient. */
export function assertAutopsyLinkage(hypothesis: AutopsyHypothesis, output: AutopsyOutput): void {
  if (hypothesis.attemptId !== output.attemptFacts.attemptId) {
    throw new HypothesisError(
      "mismatched_attempt",
      `Hypothesis attemptId "${hypothesis.attemptId}" does not match AutopsyOutput attemptId "${output.attemptFacts.attemptId}" — refusing to persist a linkage that does not hold.`
    );
  }
}

/**
 * Shared by `RepairPlanRepository.save()` implementations. `buildRepairPlan()`
 * (`@ipmat/autopsy`) is the ONLY function that constructs a `RepairPlan`,
 * and it refuses (`HypothesisError("not_confirmed", ...)`) unless
 * `hypothesis.confirmationStatus === "confirmed"` — a plan it produces
 * always carries a real `confirmationSource.hypothesisConfirmedAt` (copied
 * from the confirmed hypothesis's `respondedAt`, which `buildRepairPlan()`
 * itself checks is non-null). TypeScript's structural typing cannot stop a
 * caller from constructing a `RepairPlan`-shaped object some OTHER way,
 * bypassing that gate entirely — this check is the persistence boundary's
 * own re-verification of the SAME invariant, so "RepairPlan cannot be
 * persisted from an unconfirmed hypothesis" holds even against a value
 * that merely has the right TypeScript shape, not just callers that went
 * through `buildRepairPlan()` honestly.
 */
export function assertRepairPlanConfirmed(plan: RepairPlan): void {
  if (!plan.confirmationSource?.hypothesisConfirmedAt) {
    throw new PersistenceError(
      "invalid_record",
      "Cannot persist a RepairPlan without confirmationSource.hypothesisConfirmedAt — a RepairPlan must be built via buildRepairPlan() from a confirmed hypothesis."
    );
  }
}

/** Shared by `RepairPlanRepository.save()` implementations — the resolved-id parameters a repository is handed are real database identifiers it did not compute itself; refuse to write a plan without them rather than writing a dangling/empty reference. */
export function assertRepairPlanIdentifiers(autopsyId: string, studentId: string): void {
  if (!autopsyId) {
    throw new PersistenceError("invalid_record", "Cannot persist a RepairPlan without an autopsyId.");
  }
  if (!studentId) {
    throw new PersistenceError("invalid_record", "Cannot persist a RepairPlan without a studentId.");
  }
}

/**
 * Shared by `AutopsyRepository`/`RepairPlanRepository` implementations for
 * every optional error-taxonomy-code lookup. A `null` proposed code means
 * "no trap matched" and resolves to `null` legitimately (the FK is
 * nullable) — but once a NON-NULL code was proposed, failing to resolve it
 * to a real `ErrorTaxonomy` row means the reference data is out of sync
 * (a seeding gap, a typo, a stale code), not "nothing to report." Silently
 * writing `null` in that case would be exactly the kind of foreign-key
 * resolution that "silently produces an invalid relation" (the row would
 * claim no error-taxonomy match when the domain layer actually proposed
 * one) — so this fails closed instead, consistent with `assertConceptResolved()`
 * below, which already fails closed for the same reason.
 */
export function assertErrorTaxonomyResolved(code: string, resolvedId: string | null): asserts resolvedId is string {
  if (resolvedId === null) {
    throw new PersistenceError("missing_reference", `No ErrorTaxonomy found with code "${code}" — cannot resolve a proposed error-taxonomy reference.`);
  }
}

/** Shared by `RepairPlanRepository.save()` implementations — `RepairPlan.targetConceptName` is always a real, non-optional field, so failing to resolve it to a `Concept.id` is always a genuine data-integrity gap, never a legitimate "nothing to link." */
export function assertConceptResolved(conceptName: string, resolvedId: string | null): asserts resolvedId is string {
  if (resolvedId === null) {
    throw new PersistenceError("missing_reference", `No Concept found named "${conceptName}" — cannot resolve RepairPlan.targetConceptId.`);
  }
}

function assertValidMasteryMeasure(name: string, value: number | null): void {
  if (value !== null && !Number.isFinite(value)) {
    throw new PersistenceError("invalid_record", `MasteryState.${name} must be null or a finite number, got ${String(value)}.`);
  }
}

/** Shared by `MasteryStateRepository.save()` implementations — fails closed on an empty id or a non-finite measure (`NaN`/`Infinity`), which the nullable `Float?` columns can represent in SQL but which would silently corrupt anything reading the row back as a real measurement. */
export function assertValidMasteryStateRecord(record: MasteryStatePersistenceRecord): void {
  if (!record.studentId) {
    throw new PersistenceError("invalid_record", "Cannot persist a MasteryState without a studentId.");
  }
  if (!record.conceptId) {
    throw new PersistenceError("invalid_record", "Cannot persist a MasteryState without a conceptId.");
  }
  assertValidMasteryMeasure("accuracy", record.accuracy);
  assertValidMasteryMeasure("speedRatio", record.speedRatio);
  assertValidMasteryMeasure("noveltyHandling", record.noveltyHandling);
  assertValidMasteryMeasure("pressurePerformance", record.pressurePerformance);
  assertValidMasteryMeasure("patternCoverage", record.patternCoverage);
}
