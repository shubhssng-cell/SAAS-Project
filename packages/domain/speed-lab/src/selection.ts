import { buildTrainingSystemDiagnostics } from "@ipmat/training-systems";
import type { TrainingCandidateQuestion, TrainingSystemContext, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { computeLocalExposureCounts } from "./exposure.js";
import type { SpeedLabRequirement } from "./types.js";

function isStructurallyValid(candidate: TrainingCandidateQuestion): boolean {
  return Boolean(
    candidate?.question?.questionId &&
      candidate.question.conceptName &&
      candidate.question.difficultyDimensions &&
      typeof candidate.question.difficultyDimensions.conceptualLoad === "number" &&
      Array.isArray(candidate.question.testingModes) &&
      typeof candidate.expectedTimeSeconds === "number"
  );
}

function qualifies(candidate: TrainingCandidateQuestion, requirement: SpeedLabRequirement): boolean {
  if (candidate.validationState !== "published") return false;
  if (candidate.question.conceptName !== requirement.targetConceptName) return false;
  if (requirement.maxConceptualLoad !== null && candidate.question.difficultyDimensions.conceptualLoad >= requirement.maxConceptualLoad) return false;
  if (requirement.requireTimePressured && !candidate.question.testingModes.includes("time_pressured")) return false;
  return true;
}

/**
 * Deterministic, fully bounded tie-break over the QUALIFYING pool only
 * (docs/DECISIONS.md D-055): (1) least prior exposure for this student,
 * (2) LOWEST `expectedTimeSeconds` among otherwise-qualifying candidates,
 * (3) lexicographic questionId as the final deterministic break. Step (2)
 * is a deterministic PREFERENCE for the tighter available expected-time
 * budget only -- `expectedTimeSeconds` is uncalibrated content metadata
 * (docs/DECISIONS.md D-021-style caveat), and this is deliberately NOT
 * claimed to represent a harder, better, or maximum training stimulus.
 */
function pickWinner(qualifying: TrainingCandidateQuestion[], exposureCounts: Map<string, number>): TrainingCandidateQuestion {
  return [...qualifying].sort((a, b) => {
    const exposureDiff = (exposureCounts.get(a.question.questionId) ?? 0) - (exposureCounts.get(b.question.questionId) ?? 0);
    if (exposureDiff !== 0) return exposureDiff;

    const timeDiff = a.expectedTimeSeconds - b.expectedTimeSeconds;
    if (timeDiff !== 0) return timeDiff;

    return a.question.questionId.localeCompare(b.question.questionId);
  })[0]!;
}

/**
 * The selection step, called ONLY after `evaluateSpeedLab()` has already
 * decided applicability (never re-decides it -- see
 * `runTrainingSystemProvider()` in `@ipmat/training-systems`).
 */
export function selectSpeedLabQuestion(providerId: string, context: TrainingSystemContext, requirement: SpeedLabRequirement, explanation: string): TrainingSystemSelectionOutcome {
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
  const winner = pickWinner(qualifying, exposureCounts);

  return { status: "selected", question: winner.question, requirement, explanation, diagnostics };
}
