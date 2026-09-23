import { buildTrainingSystemDiagnostics } from "@ipmat/training-systems";
import type { TrainingCandidateQuestion, TrainingSystemContext, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { computeLocalExposureCounts, computeSeenTaxonomyCellsForConcept } from "./exposure.js";
import type { PressureTrainingRequirement } from "./types.js";

function isStructurallyValid(candidate: TrainingCandidateQuestion): boolean {
  return Boolean(
    candidate?.question?.questionId &&
      candidate.question.conceptName &&
      candidate.question.patternTaxonomyCellId &&
      candidate.question.difficultyTier &&
      Array.isArray(candidate.question.testingModes) &&
      candidate.question.testingModes.length > 0 &&
      typeof candidate.expectedTimeSeconds === "number"
  );
}

function qualifies(candidate: TrainingCandidateQuestion, requirement: PressureTrainingRequirement): boolean {
  if (candidate.validationState !== "published") return false;
  if (candidate.question.conceptName !== requirement.targetConceptName) return false;
  return true;
}

/**
 * Deterministic, fully bounded tie-break over the QUALIFYING pool only
 * (docs/DECISIONS.md D-061): (1) prefer a candidate whose taxonomy cell
 * this student has NOT previously attempted at this target concept
 * (surface variation), (2) least prior exposure for this student, (3)
 * lexicographic questionId as the final deterministic break. No
 * weighting, no composite score, no delegation to `@ipmat/adaptive-
 * selection` or `@ipmat/repair-selection`.
 */
function pickWinner(qualifying: TrainingCandidateQuestion[], seenCellIds: Set<string>, exposureCounts: Map<string, number>): TrainingCandidateQuestion {
  const unseen = qualifying.filter((c) => !seenCellIds.has(c.question.patternTaxonomyCellId));
  const pool = unseen.length > 0 ? unseen : qualifying;

  return [...pool].sort((a, b) => {
    const exposureDiff = (exposureCounts.get(a.question.questionId) ?? 0) - (exposureCounts.get(b.question.questionId) ?? 0);
    if (exposureDiff !== 0) return exposureDiff;
    return a.question.questionId.localeCompare(b.question.questionId);
  })[0]!;
}

/**
 * The selection step, called ONLY after `evaluatePressureTraining()` has
 * already decided applicability (never re-decides it — see
 * `runTrainingSystemProvider()` in `@ipmat/training-systems`). This is
 * the FIRST place `context.candidates` is read anywhere in this package.
 */
export function selectPressureTrainingQuestion(
  providerId: string,
  context: TrainingSystemContext,
  requirement: PressureTrainingRequirement,
  explanation: string
): TrainingSystemSelectionOutcome {
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
    return {
      status: "no_eligible_question",
      requirement,
      explanation: `No published, structurally valid candidate matches concept "${requirement.targetConceptName}".`,
      diagnostics
    };
  }

  const seenCellIds = computeSeenTaxonomyCellsForConcept(context.studentId, context.attemptRecords, requirement.targetConceptName);
  const exposureCounts = computeLocalExposureCounts(context.studentId, context.attemptRecords);
  const winner = pickWinner(qualifying, seenCellIds, exposureCounts);

  return { status: "selected", question: winner.question, requirement, explanation, diagnostics };
}
