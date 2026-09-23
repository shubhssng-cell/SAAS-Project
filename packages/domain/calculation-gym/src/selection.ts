import { buildTrainingSystemDiagnostics } from "@ipmat/training-systems";
import type { TrainingCandidateQuestion, TrainingSystemContext, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { computeLocalExposureCounts } from "./exposure.js";
import type { CalculationGymRequirement } from "./types.js";

function isStructurallyValid(candidate: TrainingCandidateQuestion): boolean {
  return Boolean(
    candidate?.question?.questionId &&
      candidate.question.conceptName &&
      candidate.question.difficultyDimensions &&
      typeof candidate.question.difficultyDimensions.computationalLoad === "number" &&
      Array.isArray(candidate.question.testingModes) &&
      typeof candidate.expectedTimeSeconds === "number"
  );
}

function qualifies(candidate: TrainingCandidateQuestion, requirement: CalculationGymRequirement): boolean {
  if (candidate.validationState !== "published") return false;
  if (candidate.question.conceptName !== requirement.targetConceptName) return false;
  if (candidate.question.difficultyDimensions.computationalLoad < requirement.minComputationalLoad) return false;
  if (requirement.requireMultiStep && !candidate.question.testingModes.includes("multi_step")) return false;
  if (requirement.requireTimePressured && !candidate.question.testingModes.includes("time_pressured")) return false;
  return true;
}

/**
 * Deterministic, fully bounded tie-break over the QUALIFYING pool only
 * (docs/DECISIONS.md D-054 adjustment 4) — exactly the three approved
 * steps, nothing else: (1) least prior exposure for this student, (2)
 * computational-load closest to the requirement's own floor (never more
 * calculation-heavy than necessary), (3) lexicographic questionId as the
 * final deterministic break. No composite score, no weighting, no
 * delegation to a general ranking engine.
 */
function pickWinner(qualifying: TrainingCandidateQuestion[], exposureCounts: Map<string, number>, targetLoad: number): TrainingCandidateQuestion {
  return [...qualifying].sort((a, b) => {
    const exposureDiff = (exposureCounts.get(a.question.questionId) ?? 0) - (exposureCounts.get(b.question.questionId) ?? 0);
    if (exposureDiff !== 0) return exposureDiff;

    const loadDiff = Math.abs(a.question.difficultyDimensions.computationalLoad - targetLoad) - Math.abs(b.question.difficultyDimensions.computationalLoad - targetLoad);
    if (loadDiff !== 0) return loadDiff;

    return a.question.questionId.localeCompare(b.question.questionId);
  })[0]!;
}

/**
 * The selection step, called ONLY after `evaluateCalculationGym()` has
 * already decided applicability (never re-decides it — see
 * `runTrainingSystemProvider()` in `@ipmat/training-systems`).
 */
export function selectCalculationGymQuestion(providerId: string, context: TrainingSystemContext, requirement: CalculationGymRequirement, explanation: string): TrainingSystemSelectionOutcome {
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
      explanation: `No published, structurally valid candidate for concept "${requirement.targetConceptName}" satisfies stage "${requirement.stage}"'s DNA requirements.`,
      diagnostics
    };
  }

  const exposureCounts = computeLocalExposureCounts(context.studentId, context.attemptRecords);
  const winner = pickWinner(qualifying, exposureCounts, requirement.minComputationalLoad);

  return { status: "selected", question: winner.question, requirement, explanation, diagnostics };
}
