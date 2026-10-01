import { toAutopsyEvidence, type AttemptState } from "@ipmat/attempt";
import { buildObservationEvidence, type HistoricalAttemptRecord, type ObservationEvidence } from "@ipmat/autopsy";
import type { CanonicalQuestion } from "@ipmat/db";
import { assertEnrollmentOwnership, assertFinalizedAttemptsOwnedBy, assertValidRequest } from "./ownership.js";
import { toAttemptQuestionContext } from "./readModels.js";
import type { TrainingRecommendationDependencies, TrainingRecommendationRequest } from "./types.js";

/**
 * Phase 4 Unit 1 -- assembles the OBSERVATION-ONLY evidence for one finalized attempt from persisted state alone (the same reads the
 * recommendation composition uses: finalized history, the published DNA pool, the canonical question, the concept link). Nothing is
 * stored and nothing is decided here; `buildObservationEvidence()` (`@ipmat/autopsy`) does the assembling.
 *
 * Reproducible by construction: the evidence for an attempt depends only on that attempt and the attempts finalized BEFORE it, so
 * later practice never changes what an old result says, and a new process reads the same rows and produces the same object.
 *
 * Returns `null` (never a guess) when the attempt is not one of this student's finalized attempts, or its canonical question cannot
 * be loaded. Ownership is verified first, exactly as for a recommendation. A prior attempt whose question is not in the published,
 * DNA-complete pool, cannot be loaded, or whose concept link does not resolve is EXCLUDED from history (the same rule mastery uses),
 * never given invented context.
 */
export async function composeAttemptObservationEvidence(
  deps: TrainingRecommendationDependencies,
  request: TrainingRecommendationRequest & { attemptId: string }
): Promise<ObservationEvidence | null> {
  assertValidRequest(request);
  const enrollment = assertEnrollmentOwnership(await deps.enrollmentReader.findById(request.enrollmentId), request);
  const studentId = enrollment.studentId;

  const finalized = await deps.attemptHistoryReader.findFinalizedByStudentId(studentId);
  assertFinalizedAttemptsOwnedBy(finalized, studentId);
  // Total order, regardless of the reader's own: finalization time, then id.
  const ordered: AttemptState[] = [...finalized].sort((a, b) => {
    const ta = a.finalizedAt ?? "";
    const tb = b.finalizedAt ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const targetIndex = ordered.findIndex((attempt) => attempt.id === request.attemptId);
  if (targetIndex === -1) return null;
  const target = ordered[targetIndex]!;

  const questionRecords = await deps.trainingQuestionReader.findPublishedByExamId(enrollment.examId);
  const contextById = new Map(questionRecords.map((record) => [record.question.questionId, record.question]));
  const concepts = await deps.conceptReader.findWithPublishedQuestionsByExamId(enrollment.examId);
  const conceptNameById = new Map(concepts.map((concept) => [concept.id, concept.name]));

  const canonicalById = new Map<string, CanonicalQuestion | null>();
  const loadCanonical = async (questionId: string): Promise<CanonicalQuestion | null> => {
    if (!canonicalById.has(questionId)) canonicalById.set(questionId, await deps.questionReader.findById(questionId));
    return canonicalById.get(questionId) ?? null;
  };

  const targetCanonical = await loadCanonical(target.questionId);
  if (targetCanonical === null || targetCanonical.id !== target.questionId) return null;
  const targetQuestion = contextById.get(target.questionId) ?? null;
  const targetLinked = targetQuestion !== null && conceptNameById.get(targetCanonical.conceptId) === targetQuestion.conceptName;

  const priorAttempts: HistoricalAttemptRecord[] = [];
  for (const attempt of ordered.slice(0, targetIndex)) {
    const question = contextById.get(attempt.questionId);
    if (question === undefined) continue;
    const canonical = await loadCanonical(attempt.questionId);
    if (canonical === null || canonical.id !== attempt.questionId) continue;
    if (conceptNameById.get(canonical.conceptId) !== question.conceptName) continue;
    priorAttempts.push({ evidence: toAutopsyEvidence(attempt, toAttemptQuestionContext(canonical)), question });
  }

  return buildObservationEvidence({
    evidence: toAutopsyEvidence(target, toAttemptQuestionContext(targetCanonical)),
    question: targetLinked ? targetQuestion : null,
    priorAttempts
  });
}

export type { ObservationEvidence } from "@ipmat/autopsy";
export { applyConfirmationResponse, describeObservationEvidence } from "@ipmat/autopsy";
export type { AutopsyHypothesis, ConfirmationResponse } from "@ipmat/autopsy";
