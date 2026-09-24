import type { AttemptState } from "@ipmat/attempt";
import type { EnrollmentRecord, StoredRepairPlan } from "@ipmat/db";
import type { PracticeBlockState } from "@ipmat/practice-block";
import type { PracticeSessionState } from "@ipmat/practice-session";
import { TrainingRecommendationError, type TrainingRecommendationRequest } from "./types.js";

/**
 * Ownership guards (docs/project-memory/37_TRAINING_RECOMMENDATION.md §10,
 * 54_SECURITY_AND_OWNERSHIP.md). The ONE authoritative check is
 * `assertEnrollmentOwnership()`; every other guard here re-verifies that a
 * row a repository returned actually sits on the already-verified chain
 * `Student -> Enrollment -> PracticeSession -> PracticeBlock -> Attempt`.
 * A mismatch is never filtered away quietly — it throws, because it means
 * a scoped query returned data it should never have returned.
 */

export function assertValidRequest(request: TrainingRecommendationRequest): void {
  if (typeof request.studentId !== "string" || request.studentId.trim() === "") {
    throw new TrainingRecommendationError("invalid_request", "studentId must be a non-empty string.");
  }
  if (typeof request.enrollmentId !== "string" || request.enrollmentId.trim() === "") {
    throw new TrainingRecommendationError("invalid_request", "enrollmentId must be a non-empty string.");
  }
}

/** Returns the enrollment only once it is proven to exist AND to belong to the requesting student. */
export function assertEnrollmentOwnership(enrollment: EnrollmentRecord | null, request: TrainingRecommendationRequest): EnrollmentRecord {
  if (enrollment === null) {
    throw new TrainingRecommendationError("enrollment_not_found", `No Enrollment found with id "${request.enrollmentId}".`);
  }
  if (enrollment.id !== request.enrollmentId) {
    throw new TrainingRecommendationError(
      "ownership_inconsistency",
      `EnrollmentReader returned Enrollment "${enrollment.id}" for requested id "${request.enrollmentId}".`
    );
  }
  if (enrollment.studentId !== request.studentId) {
    throw new TrainingRecommendationError(
      "enrollment_ownership_mismatch",
      `Enrollment "${enrollment.id}" does not belong to student "${request.studentId}".`
    );
  }
  return enrollment;
}

export function assertFinalizedAttemptsOwnedBy(attempts: AttemptState[], studentId: string): void {
  for (const attempt of attempts) {
    if (attempt.studentId !== studentId) {
      throw new TrainingRecommendationError(
        "ownership_inconsistency",
        `Finalized-attempt history for student "${studentId}" contained Attempt "${attempt.id}" owned by "${attempt.studentId}".`
      );
    }
    if (attempt.status === "in_progress" || attempt.finalizedAt === null) {
      throw new TrainingRecommendationError(
        "repository_contract_violation",
        `Finalized-attempt history contained Attempt "${attempt.id}", which is not finalized.`
      );
    }
  }
}

export function assertRepairPlansOwnedBy(plans: StoredRepairPlan[], studentId: string): void {
  for (const plan of plans) {
    if (plan.studentId !== studentId) {
      throw new TrainingRecommendationError(
        "ownership_inconsistency",
        `Confirmed RepairPlans for student "${studentId}" contained RepairPlan "${plan.id}" owned by "${plan.studentId}".`
      );
    }
  }
}

export function assertSessionBelongsToEnrollment(session: PracticeSessionState, enrollment: EnrollmentRecord): void {
  if (session.enrollmentId !== enrollment.id) {
    throw new TrainingRecommendationError(
      "ownership_inconsistency",
      `Active PracticeSession "${session.id}" belongs to Enrollment "${session.enrollmentId}", not "${enrollment.id}".`
    );
  }
  if (session.status !== "active") {
    throw new TrainingRecommendationError("repository_contract_violation", `PracticeSession "${session.id}" was returned as active but is "${session.status}".`);
  }
}

export function assertBlocksBelongToSession(blocks: PracticeBlockState[], session: PracticeSessionState): void {
  for (const block of blocks) {
    if (block.practiceSessionId !== session.id) {
      throw new TrainingRecommendationError(
        "ownership_inconsistency",
        `PracticeBlock "${block.id}" belongs to PracticeSession "${block.practiceSessionId}", not "${session.id}".`
      );
    }
  }
}

/**
 * Every attempt in a block must belong to the verified student AND
 * enrollment AND carry membership in exactly this block. Returns the
 * attempts narrowed to non-null `blockMembership`.
 */
export function assertBlockAttemptsBelongTo(
  attempts: AttemptState[],
  block: PracticeBlockState,
  enrollment: EnrollmentRecord
): Array<AttemptState & { blockMembership: NonNullable<AttemptState["blockMembership"]> }> {
  return attempts.map((attempt) => {
    if (attempt.studentId !== enrollment.studentId || attempt.enrollmentId !== enrollment.id) {
      throw new TrainingRecommendationError(
        "ownership_inconsistency",
        `PracticeBlock "${block.id}" contained Attempt "${attempt.id}" owned by student "${attempt.studentId}"/enrollment "${attempt.enrollmentId}", not "${enrollment.studentId}"/"${enrollment.id}".`
      );
    }
    const membership = attempt.blockMembership;
    if (membership === null || membership.practiceBlockId !== block.id) {
      throw new TrainingRecommendationError(
        "ownership_inconsistency",
        `Attempt "${attempt.id}" was returned for PracticeBlock "${block.id}" but records membership in "${membership?.practiceBlockId ?? "no block"}".`
      );
    }
    return { ...attempt, blockMembership: membership };
  });
}
