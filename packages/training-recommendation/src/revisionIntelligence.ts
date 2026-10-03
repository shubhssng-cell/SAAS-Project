import { buildMasteryEvidenceView } from "@ipmat/mastery";
import type { MasteryEvidenceView } from "@ipmat/mastery";
import { buildRevisionIntelligence, REVISION_INTELLIGENCE_SYSTEM_IDS, scopeContextToExam, type RevisionIntelligence } from "@ipmat/revision-intelligence";
import { toTrainingSystemContext, type TrainingOrchestrationInput } from "@ipmat/training-orchestration";
import { runTrainingSystem } from "@ipmat/training-session";
import { composeTrainingOrchestrationInput } from "./compose.js";
import { TrainingRecommendationError, type TrainingRecommendationDependencies, type TrainingRecommendationRequest } from "./types.js";

export interface RevisionComposition {
  examCode: string;
  /** The context the providers were run on: scoped to this one student and exam. */
  context: ReturnType<typeof toTrainingSystemContext>;
  evidence: MasteryEvidenceView;
  revision: RevisionIntelligence;
}

/**
 * The pure part of the composition, shared with the curriculum composer so both derive from ONE read: from an already
 * ownership-verified, exam-scoped `TrainingOrchestrationInput` to the Unit 1 evidence and the Unit 2 intelligence.
 * `null` when the pool is empty; a pool spanning more than one exam is refused.
 */
export function composeRevisionFromInput(input: TrainingOrchestrationInput): RevisionComposition | null {
  const examCodes = [...new Set(input.candidates.map((candidate) => candidate.question.examCode))];
  if (examCodes.length === 0) return null;
  if (examCodes.length > 1) {
    throw new TrainingRecommendationError("repository_contract_violation", "The enrollment's published question pool spans more than one exam");
  }
  const examCode = examCodes[0]!;
  const context = scopeContextToExam(toTrainingSystemContext(input), examCode);
  const evidence = buildMasteryEvidenceView(context.attemptRecords, { studentId: input.studentId, examCode, conceptNames: input.masteryByConcept.map((state) => state.conceptName) });
  const runs = REVISION_INTELLIGENCE_SYSTEM_IDS.map((systemId) => {
    const ran = runTrainingSystem(systemId, context);
    return { systemId, outcome: ran.status === "ran" ? ran.outcome : null };
  });
  return { examCode, context, evidence, revision: buildRevisionIntelligence({ studentId: input.studentId, examCode, evidence, context, runs }) };
}

/**
 * Phase 7 Unit 2 (docs/DECISIONS.md D-088): the student's revision intelligence, derived from persisted attempts.
 *
 * ONE ownership-verified, exam-scoped composition (the same read every recommendation uses; its one possible write, the
 * RepairPlan status sync, is switched off here), then:
 *   1. the Unit 1 mastery evidence view over those attempts,
 *   2. each existing training system's OWN provider run through the product's catalog-aware `runTrainingSystem()` on a
 *      context scoped to this one student and exam (no selection logic is added or bypassed),
 *   3. `buildRevisionIntelligence()` - signals, traced recommendations, unserved signals, preserved conflicts.
 *
 * Nothing is stored or cached and no route reads it. Like the training-system path it ignores repair plans and mastery
 * measures. Returns `null` when the exam has no published question pool (nothing can then be attributed to an exam).
 */
export async function composeRevisionIntelligence(deps: TrainingRecommendationDependencies, request: TrainingRecommendationRequest): Promise<RevisionIntelligence | null> {
  const input = await composeTrainingOrchestrationInput({ ...deps, repairPlanStatusWriter: undefined }, request);
  return composeRevisionFromInput(input)?.revision ?? null;
}
