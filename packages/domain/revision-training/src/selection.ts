import { buildTrainingSystemDiagnostics } from "@ipmat/training-systems";
import type { TrainingCandidateQuestion, TrainingSystemContext, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { computeLocalExposureCounts, computeSeenTaxonomyCellsForConcept } from "./exposure.js";
import type { RevisionTrainingRequirement } from "./types.js";

function isStructurallyValid(candidate: TrainingCandidateQuestion): boolean {
  return Boolean(candidate?.question?.questionId && candidate.question.conceptName && candidate.question.patternTaxonomyCellId && Number.isFinite(candidate.expectedTimeSeconds));
}

function qualifies(candidate: TrainingCandidateQuestion, requirement: RevisionTrainingRequirement): boolean {
  return candidate.validationState === "published" && candidate.question.conceptName === requirement.targetConceptName;
}

/**
 * Deterministic, bounded tie-break over the QUALIFYING pool only (D-081): (1) prefer a taxonomy
 * cell this student has not previously attempted at the target concept, (2) least prior
 * exposure, (3) questionId ascending. No weighting, no score, no global ranking.
 */
function pickWinner(qualifying: TrainingCandidateQuestion[], seenCellIds: Set<string>, exposureCounts: Map<string, number>): TrainingCandidateQuestion {
  const unseen = qualifying.filter((c) => !seenCellIds.has(c.question.patternTaxonomyCellId));
  const pool = unseen.length > 0 ? unseen : qualifying;
  return [...pool].sort((a, b) => {
    const exposureDiff = (exposureCounts.get(a.question.questionId) ?? 0) - (exposureCounts.get(b.question.questionId) ?? 0);
    if (exposureDiff !== 0) return exposureDiff;
    return a.question.questionId < b.question.questionId ? -1 : a.question.questionId > b.question.questionId ? 1 : 0;
  })[0]!;
}

/**
 * Called ONLY after `evaluateRevision()` has decided applicability. The first place
 * `context.candidates` is read. Never switches to another concept: an empty target pool is the
 * explicit `no_eligible_question` outcome.
 */
export function selectRevisionQuestion(providerId: string, context: TrainingSystemContext, requirement: RevisionTrainingRequirement, explanation: string): TrainingSystemSelectionOutcome {
  let excludedMalformedCount = 0;
  let excludedIneligibleCount = 0;
  const qualifying: TrainingCandidateQuestion[] = [];
  for (const candidate of context.candidates) {
    if (!isStructurallyValid(candidate)) {
      excludedMalformedCount += 1;
      continue;
    }
    if (!qualifies(candidate, requirement)) {
      excludedIneligibleCount += 1;
      continue;
    }
    qualifying.push(candidate);
  }

  const diagnostics = buildTrainingSystemDiagnostics({
    providerId,
    studentId: context.studentId,
    eligible: true,
    candidatesConsidered: context.candidates.length,
    excludedMalformedCount,
    excludedIneligibleCount,
    notes: requirement.notes ?? []
  });

  if (qualifying.length === 0) {
    return { status: "no_eligible_question", requirement, explanation: `No published, structurally valid candidate matches concept "${requirement.targetConceptName}".`, diagnostics };
  }

  const winner = pickWinner(
    qualifying,
    computeSeenTaxonomyCellsForConcept(context.studentId, context.attemptRecords, requirement.targetConceptName),
    computeLocalExposureCounts(context.studentId, context.attemptRecords)
  );
  return { status: "selected", question: winner.question, requirement, explanation, diagnostics };
}
