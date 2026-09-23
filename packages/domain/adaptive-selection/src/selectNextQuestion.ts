import { validateAdaptiveCandidateQuestion } from "./candidateValidation.js";
import { applyOveruseAvoidance, rankCandidates } from "./tieBreak.js";
import { buildTrainingNeedContext, computeProgressionTargetTier, determineSatisfiedReasons } from "./trainingNeeds.js";
import {
  TRAINING_NEED_PRIORITY_ORDER,
  type AdaptiveCandidateExplanation,
  type AdaptiveCandidateQuestion,
  type AdaptiveSelectionInput,
  type AdaptiveSelectionOutcome,
  type AdaptiveSelectionResult,
  type DifficultyTier,
  type TrainingNeedReasonCode
} from "./types.js";

function explainReason(reason: TrainingNeedReasonCode, candidate: AdaptiveCandidateQuestion): string {
  const q = candidate.question;
  switch (reason) {
    case "repair_priority":
      return `A confirmed diagnosis is actively targeting "${q.patternFamilyName}" in "${q.conceptName}" — this question directly addresses it.`;
    case "repeated_error":
      return `This student has a repeated-error pattern in "${q.conceptName}" — this question offers further practice on it.`;
    case "prerequisite_weakness":
      return `"${q.conceptName}" is a prerequisite flagged by a confirmed diagnosis elsewhere, and this student's mastery of it is weak or unmeasured.`;
    case "accuracy_weakness":
      return `This student's measured accuracy on "${q.conceptName}" is below the training threshold.`;
    case "speed_weakness":
      return `This student's measured speed on "${q.conceptName}" is below the training threshold (taking notably longer than expected).`;
    case "coverage_gap":
      return `This student has never attempted this exact taxonomy cell (pattern family "${q.patternFamilyName}") for "${q.conceptName}".`;
    case "underexposure":
      return `The pattern family "${q.patternFamilyName}" has very few prior attempts by this student overall.`;
    case "pressure_gap":
      return `This student's performance under time pressure on "${q.conceptName}" is weak or unmeasured, and this question is time-pressured.`;
    case "novelty_gap":
      return `This student's performance on novel-representation content for "${q.conceptName}" is weak or unmeasured, and this question is non-standard novelty.`;
    case "difficulty_progression":
      return `This question's difficulty tier ("${q.difficultyTier}") is the appropriate next step for "${q.conceptName}" given current evidence.`;
  }
}

function coverageGapFor(reason: TrainingNeedReasonCode, candidate: AdaptiveCandidateQuestion): string | null {
  if (reason === "coverage_gap") return `Fills an unattempted taxonomy cell in "${candidate.question.patternFamilyName}" (${candidate.question.conceptName}).`;
  if (reason === "underexposure") return `Broadens overall exposure to the "${candidate.question.patternFamilyName}" pattern family.`;
  return null;
}

/**
 * The Global Adaptive Selection domain contract (Phase 5C-3, deterministic
 * core — docs/DECISIONS.md D-051). Deterministically answers "what should
 * this student practice next" across every concept represented in
 * `candidates`, using ONLY existing, real, observable evidence
 * (`MasteryStateResult`, `RepairPlan`, attempt exposure counts) — never an
 * opaque score, never inferred psychology.
 *
 * Selection order:
 * 1. Structural validity (malformed candidates excluded, never silently
 *    repaired).
 * 2. Publication eligibility (`validationState === "published"` — reuses
 *    the SAME rule `@ipmat/practice-loop`'s `QuestionReader` gate
 *    enforces, never a second publication rule).
 * 3. Per-candidate training-need reason detection (`trainingNeeds.ts`) —
 *    every candidate is tagged with every reason it satisfies.
 * 4. Bucketing by each candidate's single highest-priority reason
 *    (`TRAINING_NEED_PRIORITY_ORDER`), then iterating that fixed order —
 *    the first non-empty bucket wins. If NO candidate satisfies ANY named
 *    reason (a genuinely "nothing stands out" pool), every eligible
 *    candidate falls back into `difficulty_progression`, explicitly
 *    labeled `isFallback: true` — mirroring `@ipmat/repair-selection`'s
 *    `concept_fallback` tier: a deliberate, always-available fallback,
 *    never silently indistinguishable from a real match.
 * 5. Deterministic tie-breaking within the winning bucket
 *    (`tieBreak.ts`): overuse avoidance, then coverage preference, then
 *    difficulty-progression suitability, then `questionId`.
 */
export function selectNextQuestion(input: AdaptiveSelectionInput): AdaptiveSelectionOutcome {
  const { candidates } = input;

  if (candidates.length === 0) {
    return {
      status: "no_selection",
      reason: "no_candidates_supplied",
      explanation: "No candidate questions were supplied.",
      candidatesConsidered: 0,
      excludedMalformedCount: 0
    };
  }

  const structurallyValid: AdaptiveCandidateQuestion[] = [];
  let excludedMalformedCount = 0;
  for (const candidate of candidates) {
    if (validateAdaptiveCandidateQuestion(candidate).valid) {
      structurallyValid.push(candidate);
    } else {
      excludedMalformedCount += 1;
    }
  }

  if (structurallyValid.length === 0) {
    return {
      status: "no_selection",
      reason: "no_structurally_valid_candidates",
      explanation: `All ${candidates.length} supplied candidate(s) failed structural validation.`,
      candidatesConsidered: candidates.length,
      excludedMalformedCount
    };
  }

  const eligible = structurallyValid.filter((c) => c.validationState === "published");
  const excludedUnpublishedCount = structurallyValid.length - eligible.length;

  if (eligible.length === 0) {
    return {
      status: "no_selection",
      reason: "no_published_candidates",
      explanation: `${structurallyValid.length} structurally valid candidate(s) exist, but none are published.`,
      candidatesConsidered: candidates.length,
      excludedMalformedCount
    };
  }

  const ctx = buildTrainingNeedContext({
    studentId: input.studentId,
    masteryByConcept: input.masteryByConcept,
    attemptRecords: input.attemptRecords,
    activeRepairPlans: input.activeRepairPlans ?? []
  });

  const satisfiedByQuestionId = new Map<string, TrainingNeedReasonCode[]>();
  for (const candidate of eligible) {
    satisfiedByQuestionId.set(candidate.question.questionId, determineSatisfiedReasons(candidate, ctx));
  }

  const byPrimaryReason = new Map<TrainingNeedReasonCode, AdaptiveCandidateQuestion[]>();
  for (const candidate of eligible) {
    const satisfied = satisfiedByQuestionId.get(candidate.question.questionId) ?? [];
    const primary = TRAINING_NEED_PRIORITY_ORDER.find((reason) => satisfied.includes(reason));
    if (!primary) continue; // satisfies nothing named -- handled by the universal fallback below
    const bucket = byPrimaryReason.get(primary) ?? [];
    bucket.push(candidate);
    byPrimaryReason.set(primary, bucket);
  }

  let winningReason: TrainingNeedReasonCode | undefined;
  let winningPool: AdaptiveCandidateQuestion[] = [];
  for (const reason of TRAINING_NEED_PRIORITY_ORDER) {
    const bucket = byPrimaryReason.get(reason);
    if (bucket && bucket.length > 0) {
      winningReason = reason;
      winningPool = bucket;
      break;
    }
  }

  // `isFallback` distinguishes a candidate that GENUINELY satisfies
  // difficulty_progression's predicate (a real, if lowest-priority, need
  // — "this tier is the right next step") from the true last-resort case
  // below, where NO candidate satisfied ANY named reason at all. Both can
  // end up with `primaryReason === "difficulty_progression"`, but only
  // the second is actually a fallback.
  let isFallback = false;
  if (!winningReason) {
    winningReason = "difficulty_progression";
    winningPool = eligible;
    isFallback = true;
  }

  const progressionTargetTierByConcept = new Map<string, DifficultyTier>();
  for (const candidate of eligible) {
    if (!progressionTargetTierByConcept.has(candidate.question.conceptName)) {
      progressionTargetTierByConcept.set(candidate.question.conceptName, computeProgressionTargetTier(ctx.masteryByConcept.get(candidate.question.conceptName)));
    }
  }

  const afterOveruseAvoidance = applyOveruseAvoidance(winningPool, ctx.exposure);
  const ranked = rankCandidates(afterOveruseAvoidance, { exposure: ctx.exposure, progressionTargetTierByConcept });

  const [winner, ...rest] = ranked;
  if (!winner) {
    // Unreachable: winningPool is only ever set from a non-empty bucket, or from `eligible`
    // itself (already confirmed non-empty above), and neither filtering function empties a
    // non-empty pool. Checked explicitly rather than assumed (fail-closed style already used
    // throughout this codebase, e.g. @ipmat/repair-selection's own unreachable-but-checked case).
    return {
      status: "no_selection",
      reason: "no_structurally_valid_candidates",
      explanation: "No candidate remained after ranking despite passing eligibility — this should not be reachable.",
      candidatesConsidered: candidates.length,
      excludedMalformedCount
    };
  }

  const winnerReasons = satisfiedByQuestionId.get(winner.question.questionId) ?? [];
  const rankedAlternatives: AdaptiveCandidateExplanation[] = rest.map((candidate) => ({
    questionId: candidate.question.questionId,
    primaryReason: TRAINING_NEED_PRIORITY_ORDER.find((r) => (satisfiedByQuestionId.get(candidate.question.questionId) ?? []).includes(r)) ?? "difficulty_progression",
    allReasonsSatisfied: satisfiedByQuestionId.get(candidate.question.questionId) ?? []
  }));

  const result: AdaptiveSelectionResult = {
    question: winner.question,
    primaryReason: winningReason,
    allReasonsSatisfied: winnerReasons,
    targetConceptName: winner.question.conceptName,
    isFallback,
    explanation: explainReason(winningReason, winner),
    coverageGapAddressed: coverageGapFor(winningReason, winner),
    rankedAlternatives,
    candidatesConsidered: candidates.length,
    excludedMalformedCount,
    excludedUnpublishedCount
  };

  return { status: "selected", result };
}
