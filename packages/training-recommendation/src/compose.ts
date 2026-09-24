import type { TrainingOrchestrationInput, TrainingPracticeBlockContext } from "@ipmat/training-orchestration";
import {
  assertBlockAttemptsBelongTo,
  assertBlocksBelongToSession,
  assertEnrollmentOwnership,
  assertFinalizedAttemptsOwnedBy,
  assertRepairPlansOwnedBy,
  assertSessionBelongsToEnrollment,
  assertValidRequest
} from "./ownership.js";
import { buildMasteryAttemptRecords, buildPracticeBlockContext, computeMasteryByConcept, toActiveRepairPlanContexts, toTrainingCandidates } from "./readModels.js";
import type { TrainingRecommendationDependencies, TrainingRecommendationRequest } from "./types.js";

/**
 * Reads persisted state and assembles `TrainingOrchestrationInput` exactly
 * per docs/project-memory/37_TRAINING_RECOMMENDATION.md §5. Pure data
 * assembly — every decision (repair, training systems, adaptive) stays in
 * `@ipmat/training-orchestration`. Reads are issued sequentially (§5: no
 * parallelism for its own sake), none inside a transaction (§11), and no
 * write happens anywhere. Repository errors propagate unchanged.
 *
 * V1 exclusions (§7, §16): `prepPhase` is always `null` (no exam-date
 * resolution / CatchUpPlan "active" semantics exist yet), and
 * `errorTaxonomy` is omitted (optional, non-gating).
 */
export async function composeTrainingOrchestrationInput(
  deps: TrainingRecommendationDependencies,
  request: TrainingRecommendationRequest
): Promise<TrainingOrchestrationInput> {
  assertValidRequest(request);

  // 1. Ownership first — nothing enrollment-scoped is read before this passes.
  const enrollment = assertEnrollmentOwnership(await deps.enrollmentReader.findById(request.enrollmentId), request);
  const studentId = enrollment.studentId;

  // 2. Finalized history (finalizedAt ASC), student-scoped.
  const attempts = await deps.attemptHistoryReader.findFinalizedByStudentId(studentId);
  assertFinalizedAttemptsOwnedBy(attempts, studentId);

  // 3. Confirmed, not-completed RepairPlans, student-scoped.
  const storedRepairPlans = await deps.repairPlanReader.findConfirmedActiveByStudentId(studentId);
  assertRepairPlansOwnedBy(storedRepairPlans, studentId);

  // 4. Published, DNA-complete question pool for the enrollment's exam.
  const questionRecords = await deps.trainingQuestionReader.findPublishedByExamId(enrollment.examId);

  // 5. Concepts resolved through the persisted Question -> Concept relation.
  const concepts = await deps.conceptReader.findWithPublishedQuestionsByExamId(enrollment.examId);

  // 6-7. Fresh mastery from finalized history, via the existing @ipmat/mastery computation.
  const candidates = toTrainingCandidates(questionRecords);
  const attemptRecords = await buildMasteryAttemptRecords({
    attempts,
    questionContextById: new Map(candidates.map((candidate) => [candidate.question.questionId, candidate])),
    conceptNameById: new Map(concepts.map((concept) => [concept.id, concept.name])),
    loadCanonicalQuestion: (questionId) => deps.questionReader.findById(questionId)
  });
  const now = deps.now ? deps.now() : new Date().toISOString();
  const masteryByConcept = computeMasteryByConcept({ attemptRecords, concepts, studentId, now });

  // 8-11. Active session -> its blocks (sequenceNumber order) -> each block's attempts (blockSequenceNumber order).
  const practiceBlocks: TrainingPracticeBlockContext[] = [];
  const session = await deps.practiceSessionReader.findActiveByEnrollmentId(enrollment.id);
  if (session !== null) {
    assertSessionBelongsToEnrollment(session, enrollment);
    const blocks = [...(await deps.practiceBlockReader.findBySessionId(session.id))].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    assertBlocksBelongToSession(blocks, session);

    const attemptRecordIds = new Set(attemptRecords.map((record) => record.contribution.attemptId));
    for (const block of blocks) {
      const blockAttempts = assertBlockAttemptsBelongTo(await deps.attemptHistoryReader.findByPracticeBlockId(block.id), block, enrollment).sort(
        (a, b) => a.blockMembership.blockSequenceNumber - b.blockMembership.blockSequenceNumber
      );
      const context = buildPracticeBlockContext({ block, attempts: blockAttempts, attemptRecordIds });
      if (context !== null) practiceBlocks.push(context);
    }
  }

  // 12-14. Assemble — the orchestration contract, reused as-is.
  return {
    studentId,
    activeRepairPlans: toActiveRepairPlanContexts(storedRepairPlans),
    masteryByConcept,
    attemptRecords,
    candidates,
    practiceBlocks,
    prepPhase: null
  };
}
