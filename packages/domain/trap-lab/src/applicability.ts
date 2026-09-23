import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import type { TrainingSystemApplicability, TrainingSystemContext } from "@ipmat/training-systems";
import { computeTrapAssociatedFailureRecurrence } from "./trapEvidence.js";
import type { TrapAssociatedFailureRecurrence, TrapLabRequirement } from "./types.js";

export const TRAP_LAB_NOT_APPLICABLE_REASONS = ["insufficient_evidence", "no_recurring_trap_detected"] as const;
export type TrapLabNotApplicableReason = (typeof TRAP_LAB_NOT_APPLICABLE_REASONS)[number];

/**
 * Cumulative-history disclosure (docs/DECISIONS.md D-056): Trap Lab V1 has
 * no recency/decay model. Once a code reaches recurrence, later
 * correct/resisted attempts do NOT remove or reduce it.
 */
const CUMULATIVE_HISTORY_NOTE =
  "This evidence is cumulative over the entire supplied attempt history and is never decayed or aged out. " +
  "Later correct/resisted attempts against this trap do not remove or reduce the historical recurrence that " +
  "established applicability. Recency-aware behavior is deferred to a future Revision/Overtraining/Exposure-control system.";

function pickTarget(recurring: TrapAssociatedFailureRecurrence[]): TrapAssociatedFailureRecurrence {
  return [...recurring].sort((a, b) => b.distinctFailingQuestionIds.length - a.distinctFailingQuestionIds.length || a.errorTaxonomyCode.localeCompare(b.errorTaxonomyCode))[0]!;
}

function buildRequirement(target: TrapAssociatedFailureRecurrence): TrapLabRequirement {
  return {
    targetErrorTaxonomyCode: target.errorTaxonomyCode,
    notes: [
      `Trap-associated failure recurrence: error-taxonomy code "${target.errorTaxonomyCode}" was the question-designed trap of ${target.distinctFailingQuestionIds.length} distinct incorrectly-answered question(s), across ${target.distinctConceptNames.length} distinct concept(s) and ${target.distinctPatternTaxonomyCellIds.length} distinct taxonomy cell(s).`,
      ...target.diagnosticNotes,
      CUMULATIVE_HISTORY_NOTE
    ]
  };
}

/**
 * The ONE authoritative applicability decision for Trap Lab
 * (docs/DECISIONS.md D-053 adjustment 2 / D-056). Evaluates recurrence at
 * the ERROR-TAXONOMY-CODE level, ACROSS ALL CONCEPTS in the supplied
 * attempt history -- never concept-partitioned. Fails closed: a single
 * incorrect trap-tagged attempt can never trigger this, since
 * `distinctFailingQuestionIds` requires at least
 * `AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT` DISTINCT questionIds
 * (a retried single question never accumulates past 1).
 */
export function evaluateTrapLab(context: TrainingSystemContext): TrainingSystemApplicability {
  const evidenceByCode = computeTrapAssociatedFailureRecurrence(context.studentId, context.attemptRecords, context.errorTaxonomy);

  const withAnyFailure = evidenceByCode.filter((e) => e.distinctFailingQuestionIds.length > 0);
  if (withAnyFailure.length === 0) {
    return {
      applicable: false,
      reason: "insufficient_evidence",
      explanation:
        "No incorrect attempt in the supplied history carries a question-designed trap-taxonomy code, so there is no trap-associated failure recurrence evidence to evaluate."
    };
  }

  const recurring = withAnyFailure.filter((e) => e.distinctFailingQuestionIds.length >= AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT);
  if (recurring.length === 0) {
    return {
      applicable: false,
      reason: "no_recurring_trap_detected",
      explanation:
        "Repeated failure on trap-tagged questions was observed, but no single error-taxonomy code recurred across enough distinct questions to count as trap-associated failure recurrence."
    };
  }

  const target = pickTarget(recurring);
  const requirement = buildRequirement(target);

  return {
    applicable: true,
    requirement,
    explanation: `Trap-associated failure recurrence detected for error-taxonomy code "${target.errorTaxonomyCode}" -- repeated failure on trap-tagged questions across ${target.distinctFailingQuestionIds.length} distinct question(s). This is candidate-level recurrence evidence about the question's designed trap, not a claim about why the student answered as they did.`
  };
}
