import { buildMasteryEvidenceView, type MasteryEvidenceView } from "@ipmat/mastery";
import { composeTrainingOrchestrationInput } from "./compose.js";
import { TrainingRecommendationError, type TrainingRecommendationDependencies, type TrainingRecommendationRequest } from "./types.js";

/**
 * Phase 7 Unit 1 (docs/DECISIONS.md D-087): the student's mastery EVIDENCE view, derived from persisted attempts.
 *
 * It reuses the existing composition's ownership-verified, student-scoped, exam-scoped read of finalized attempts
 * (the same `MasteryAttemptRecord`s every other consumer gets), then re-presents them with `buildMasteryEvidenceView()`.
 * Evidence only: no verdict, score, threshold or unlock; nothing is stored or cached; no route reads it yet.
 *
 * Scoping is the existing one - an attempt contributes only if its question is in the enrollment's exam's published,
 * DNA-complete pool and resolves to the same concept (so another exam's attempts never appear, and an attempt whose
 * question is no longer published drops out; see the Phase 7 Unit 1 review for that limitation). The concept universe
 * is the exam's concepts that have published questions. The ONLY write the underlying composition can make (the
 * RepairPlan status sync) is switched off here: this is a pure read.
 *
 * Returns `null` when the exam has no published question pool, because evidence cannot then be attributed to an exam.
 */
export async function composeMasteryEvidenceView(deps: TrainingRecommendationDependencies, request: TrainingRecommendationRequest): Promise<MasteryEvidenceView | null> {
  const input = await composeTrainingOrchestrationInput({ ...deps, repairPlanStatusWriter: undefined }, request);
  const examCodes = [...new Set(input.candidates.map((candidate) => candidate.question.examCode))];
  if (examCodes.length === 0) return null;
  if (examCodes.length > 1) {
    throw new TrainingRecommendationError("repository_contract_violation", "The enrollment's published question pool spans more than one exam");
  }
  return buildMasteryEvidenceView(input.attemptRecords, {
    studentId: input.studentId,
    examCode: examCodes[0]!,
    conceptNames: input.masteryByConcept.map((state) => state.conceptName)
  });
}
