import type {
  AutopsyHypothesis,
  AutopsyOutput,
  AutopsyPersistenceRecord,
  RepairPlan,
  RepairPlanPersistenceRecord
} from "./types.js";

/**
 * Maps a domain `AutopsyHypothesis` to the exact shape the EXISTING
 * `autopsies` Prisma table already supports — no schema change needed
 * (Phase 5B §5). The 4-value `HypothesisConfirmationStatus` collapses
 * cleanly onto the table's `confirmed: Boolean?` + `studentCorrectionText:
 * String?` pair, which turns out to already distinguish all 4 states:
 *
 * | confirmationStatus     | confirmed | studentCorrectionText |
 * |-------------------------|-----------|------------------------|
 * | awaiting_confirmation    | null      | null                   |
 * | confirmed                | true      | null                   |
 * | rejected                 | false     | null                   |
 * | corrected                | false     | the correction text    |
 *
 * `errorTaxonomyId` is a real database foreign key this function cannot
 * resolve (no DB access) — the caller/adapter must resolve
 * `proposedErrorTaxonomyCode` to a real `ErrorTaxonomy.id` and pass it in.
 * NOTHING calls `prisma.autopsy.create()` anywhere in this package — no
 * adapter is implemented this phase.
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
    studentCorrectionText: hypothesis.studentCorrectionText,
    generatedByProvider: hypothesis.generationMetadata.provider,
    promptVersion: hypothesis.generationMetadata.promptVersion
  };
}

/**
 * Maps a domain `RepairPlan` to the exact shape the EXISTING
 * `repair_plans` Prisma table already supports — also no schema change
 * needed. `followUpQuestionIds` is always `[]` (this package never
 * selects questions) and `status` is always `"pending"` (a freshly built
 * plan has not been acted on yet). `studentId`/`autopsyId`/
 * `targetConceptId`/`targetErrorTaxonomyId` are real database identifiers
 * this function cannot resolve itself — the caller/adapter supplies them.
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
    status: "pending"
  };
}
