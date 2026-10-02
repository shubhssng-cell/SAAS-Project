import type { TrainingRequirement } from "@ipmat/training-systems";

/**
 * Revision's requirement: ONE target concept, and nothing else. Deliberately no stage, no
 * day count, no timestamp and no numeric field -- the dormancy fact is about the student's
 * past attempts, never a filterable property of an unattempted candidate question (D-081).
 */
export interface RevisionTrainingRequirement extends TrainingRequirement {
  targetConceptName: string;
}

/** The ONLY not-applicable reason Revision reports (the provider contract's "insufficient evidence" outcome). */
export const REVISION_NOT_APPLICABLE_REASONS = ["insufficient_evidence"] as const;
export type RevisionNotApplicableReason = (typeof REVISION_NOT_APPLICABLE_REASONS)[number];
