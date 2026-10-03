import { buildAdaptiveCurriculum, type AdaptiveCurriculum } from "@ipmat/adaptive-curriculum";
import { ExamIntelligenceService } from "@ipmat/exam-intelligence";
import { orchestrateNextTrainingAction } from "@ipmat/training-orchestration";
import { composeTrainingOrchestrationInput } from "./compose.js";
import { composeRevisionFromInput } from "./revisionIntelligence.js";
import type { TrainingRecommendationDependencies, TrainingRecommendationRequest } from "./types.js";

/**
 * Phase 7 Unit 3 (docs/DECISIONS.md D-089): the student's adaptive curriculum view, derived from persisted attempts.
 *
 * ONE ownership-verified, exam-scoped composition (its one possible write, the RepairPlan status sync, is switched off), then
 * from that single read: the existing orchestrator's own next action (`orchestrateNextTrainingAction`, exactly what
 * `recommendNextTrainingAction` returns), the Unit 1 evidence and Unit 2 revision intelligence, and `buildAdaptiveCurriculum()`
 * which composes them - it selects, filters and ranks nothing. Optional Phase 6 content availability per concept is attached
 * only when an Exam Intelligence source was supplied (content availability only, never a prediction); a concept the exam
 * pack does not know simply has none (`null`), never a guess.
 *
 * Nothing is stored or cached and no route reads it. Returns `null` when the exam has no published question pool.
 */
export async function composeAdaptiveCurriculum(deps: TrainingRecommendationDependencies, request: TrainingRecommendationRequest): Promise<AdaptiveCurriculum | null> {
  const input = await composeTrainingOrchestrationInput({ ...deps, repairPlanStatusWriter: undefined }, request);
  const composition = composeRevisionFromInput(input);
  if (composition === null) return null;

  let contentAvailability: Record<string, { available: number; validated: number; published: number }> | null = null;
  if (deps.examIntelligenceSource) {
    const queries = await new ExamIntelligenceService(deps.examIntelligenceSource).queries(composition.examCode);
    contentAvailability = {};
    for (const concept of composition.evidence.concepts) {
      try {
        const { available, validated, published } = queries.availability(concept.conceptName);
        contentAvailability[concept.conceptName] = { available, validated, published };
      } catch {
        // a concept the exam pack does not know has no known availability - left out, never guessed
      }
    }
  }

  return buildAdaptiveCurriculum({
    studentId: input.studentId,
    examCode: composition.examCode,
    evidence: composition.evidence,
    revision: composition.revision,
    orchestration: orchestrateNextTrainingAction(input),
    activeRepairPlans: input.activeRepairPlans,
    candidates: composition.context.candidates,
    contentAvailability
  });
}
