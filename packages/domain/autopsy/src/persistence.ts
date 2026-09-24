import type { ErrorCategory } from "@ipmat/examiner-lens";
import type {
  AutopsyHypothesis,
  AutopsyOutput,
  AutopsyPersistenceRecord,
  RecommendedTrainingMode,
  RepairPlan,
  RepairPlanPersistenceRecord,
  RepairPriority
} from "./types.js";

/**
 * Maps a domain `AutopsyHypothesis` to the exact shape the `autopsies`
 * Prisma table supports. The 4-value `HypothesisConfirmationStatus`
 * collapses cleanly onto the table's `confirmed: Boolean?` +
 * `studentCorrectionText: String?` pair, which already distinguishes all
 * 4 states:
 *
 * | confirmationStatus     | confirmed | studentCorrectionText |
 * |-------------------------|-----------|------------------------|
 * | awaiting_confirmation    | null      | null                   |
 * | confirmed                | true      | null                   |
 * | rejected                 | false     | null                   |
 * | corrected                | false     | the correction text    |
 *
 * `confirmedAt` (docs/DECISIONS.md D-039 addendum) is `hypothesis.respondedAt`
 * verbatim — the exact instant the confirmation response was applied,
 * never inferred from `createdAt`/the current time. `errorTaxonomyId` is a
 * real database foreign key this function cannot resolve (no DB access) —
 * the caller/adapter must resolve `proposedErrorTaxonomyCode` to a real
 * `ErrorTaxonomy.id` and pass it in.
 */
export function toAutopsyPersistenceRecord(
  hypothesis: AutopsyHypothesis,
  output: AutopsyOutput,
  resolvedErrorTaxonomyId: string | null
): AutopsyPersistenceRecord {
  const confirmed: boolean | null =
    hypothesis.confirmationStatus === "awaiting_confirmation" ? null : hypothesis.confirmationStatus === "confirmed";

  return {
    attemptId: hypothesis.attemptId,
    hypothesisText: hypothesis.proposedExplanation,
    errorTaxonomyId: resolvedErrorTaxonomyId,
    likelyRootCause: hypothesis.proposedErrorCategory,
    evidenceUsed: {
      supportingEvidence: hypothesis.supportingEvidence,
      contradictoryEvidence: hypothesis.contradictoryEvidence,
      missingEvidence: hypothesis.missingEvidence,
      behaviorSignals: output.behaviorSignals,
      historicalSignals: output.historicalSignals,
      candidateErrorEvidence: output.candidateErrorEvidence,
      modelConfidence: hypothesis.modelConfidence
    },
    confirmed,
    confirmedAt: hypothesis.respondedAt,
    studentCorrectionText: hypothesis.studentCorrectionText,
    generatedByProvider: hypothesis.generationMetadata.provider,
    promptVersion: hypothesis.generationMetadata.promptVersion
  };
}

/**
 * Maps a domain `RepairPlan` to the exact shape the `repair_plans` Prisma
 * table supports. `followUpQuestionIds` is always `[]` (this package
 * never selects questions) and `status` is always `"pending"` (a freshly
 * built plan has not been acted on yet). `studentId`/`autopsyId`/
 * `targetConceptId`/`targetErrorTaxonomyId` are real database identifiers
 * this function cannot resolve itself — the caller/adapter supplies them
 * via the unchanged `resolvedIds` parameter. The six snapshot fields
 * (docs/DECISIONS.md D-039 addendum) are copied directly off `plan` —
 * never recomputed, never resolved from `Concept`/`QuestionPatternFamily`
 * tables — because they are historical facts about what was diagnosed,
 * not current state to re-derive.
 */
export function toRepairPlanPersistenceRecord(
  plan: RepairPlan,
  resolvedIds: { studentId: string; autopsyId: string; targetConceptId: string; targetErrorTaxonomyId: string | null }
): RepairPlanPersistenceRecord {
  return {
    studentId: resolvedIds.studentId,
    autopsyId: resolvedIds.autopsyId,
    targetConceptId: resolvedIds.targetConceptId,
    targetErrorTaxonomyId: resolvedIds.targetErrorTaxonomyId,
    followUpQuestionIds: [],
    status: "pending",
    targetConceptName: plan.targetConceptName,
    targetPatternFamilyName: plan.targetPatternFamilyName,
    targetTaxonomyCellId: plan.targetTaxonomyCellId,
    targetErrorCategory: plan.targetErrorCategory,
    recommendedTrainingMode: plan.recommendedTrainingMode,
    priority: plan.priority
  };
}

/**
 * The reverse of `toRepairPlanPersistenceRecord()` — reconstructs a full
 * domain `RepairPlan` from already-resolved, plain persisted data (never a
 * Prisma row, never a Prisma-generated type — the caller/adapter resolves
 * `targetErrorTaxonomyCode` from `targetErrorTaxonomyId` and `confirmedAt`/
 * `attemptId` from the joined `Autopsy` row before calling this).
 *
 * Returns `null` — never a partially-fabricated `RepairPlan` — when any of
 * the six snapshot fields or `confirmedAt` is missing (docs/DECISIONS.md
 * D-039 addendum): this is exactly what distinguishes a genuine,
 * fully-persisted plan from a pre-migration row that predates this fix.
 * `rationale`/`prerequisites` are reconstructed as `[]` — the accepted V1
 * default, since neither is read by `@ipmat/repair-selection` or
 * `@ipmat/training-orchestration` (verified before this fix), and `[]` is
 * already `buildRepairPlan()`'s own fallback when no concept graph is
 * supplied.
 */
export function fromRepairPlanPersistenceRecord(stored: {
  targetConceptName: string | null;
  targetPatternFamilyName: string | null;
  targetTaxonomyCellId: string | null;
  targetErrorCategory: ErrorCategory | null;
  recommendedTrainingMode: RecommendedTrainingMode | null;
  priority: RepairPriority | null;
  targetErrorTaxonomyCode: string | null;
  attemptId: string;
  confirmedAt: string | null;
}): RepairPlan | null {
  if (
    stored.targetConceptName === null ||
    stored.targetPatternFamilyName === null ||
    stored.targetTaxonomyCellId === null ||
    stored.targetErrorCategory === null ||
    stored.recommendedTrainingMode === null ||
    stored.priority === null ||
    stored.confirmedAt === null
  ) {
    return null;
  }

  return {
    targetConceptName: stored.targetConceptName,
    targetPatternFamilyName: stored.targetPatternFamilyName,
    targetTaxonomyCellId: stored.targetTaxonomyCellId,
    targetErrorCategory: stored.targetErrorCategory,
    targetErrorTaxonomyCode: stored.targetErrorTaxonomyCode,
    recommendedTrainingMode: stored.recommendedTrainingMode,
    priority: stored.priority,
    rationale: [],
    prerequisites: [],
    confirmationSource: { attemptId: stored.attemptId, hypothesisConfirmedAt: stored.confirmedAt }
  };
}
