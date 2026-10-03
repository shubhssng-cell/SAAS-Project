import { buildAdaptiveCurriculum, type AdaptiveCurriculum } from "@ipmat/adaptive-curriculum";
import { ExamIntelligenceQueries, ExamIntelligenceService } from "@ipmat/exam-intelligence";
import { orchestrateNextTrainingAction, type TrainingOrchestrationInput } from "@ipmat/training-orchestration";
import { composeTrainingOrchestrationInput } from "./compose.js";
import { composeRevisionFromInput, type RevisionComposition } from "./revisionIntelligence.js";
import type { TrainingRecommendationDependencies, TrainingRecommendationRequest } from "./types.js";

/** Optional Phase 6 queries for the exam, or `null` when no Exam Intelligence source was supplied. */
export async function loadExamQueries(deps: TrainingRecommendationDependencies, examCode: string): Promise<ExamIntelligenceQueries | null> {
  return deps.examIntelligenceSource ? new ExamIntelligenceService(deps.examIntelligenceSource).queries(examCode) : null;
}

/**
 * The curriculum from an already-composed single read: the existing orchestrator's own next action, the Unit 1 evidence and Unit 2
 * revision intelligence, and `buildAdaptiveCurriculum()`. Optional Phase 6 content availability per concept is attached only when
 * an Exam Intelligence source was supplied (content availability only, never a prediction); a concept the exam pack does not know
 * simply has none, never a guess. Shared by the curriculum composer and the Unit 5 readiness-evidence composer so both derive
 * from ONE read.
 */
export async function buildCurriculumFromInput(deps: TrainingRecommendationDependencies, input: TrainingOrchestrationInput, composition: RevisionComposition): Promise<AdaptiveCurriculum> {
  const queries = await loadExamQueries(deps, composition.examCode);
  let contentAvailability: Record<string, { available: number; validated: number; published: number }> | null = null;
  if (queries) {
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

/**
 * Phase 7 Unit 3 (docs/DECISIONS.md D-089): the student's adaptive curriculum view, derived from persisted attempts.
 *
 * ONE ownership-verified, exam-scoped composition (its one possible write, the RepairPlan status sync, is switched off), then
 * from that single read `buildCurriculumFromInput()`. Nothing is stored or cached and no route reads it. Returns `null` when the
 * exam has no published question pool.
 */
export async function composeAdaptiveCurriculum(deps: TrainingRecommendationDependencies, request: TrainingRecommendationRequest): Promise<AdaptiveCurriculum | null> {
  const input = await composeTrainingOrchestrationInput({ ...deps, repairPlanStatusWriter: undefined }, request);
  const composition = composeRevisionFromInput(input);
  if (composition === null) return null;
  return buildCurriculumFromInput(deps, input, composition);
}
