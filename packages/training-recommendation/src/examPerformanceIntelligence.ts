import { toFinalizedSimulationEvidence } from "@ipmat/exam-simulation";
import { buildExamPerformanceIntelligence, type ExamPerformanceIntelligence } from "@ipmat/simulation-intelligence";
import { buildCurriculumFromInput, loadExamQueries } from "./adaptiveCurriculum.js";
import { composeTrainingOrchestrationInput } from "./compose.js";
import { composeRevisionFromInput } from "./revisionIntelligence.js";
import type { TrainingRecommendationDependencies, TrainingRecommendationRequest } from "./types.js";

/**
 * Phase 7 Unit 5 (docs/DECISIONS.md D-091): the student's exam-performance / readiness EVIDENCE, derived on read.
 *
 * ONE ownership-verified, exam-scoped composition (the RepairPlan status writer is switched off), then from that single read:
 * Unit 1 evidence, Unit 2 revision intelligence and the Unit 3 curriculum (all unchanged), the FINALIZED simulations of THIS
 * student in THIS exam (read through `finalizedSimulationReader`, exported through Unit 4's explicit
 * `toFinalizedSimulationEvidence` contract - an in-progress simulation can neither be returned by the reader nor exported), the
 * exam's published question DNA and, when an Exam Intelligence source was supplied, Phase 6 content availability and the number of
 * reviewed historical records observed per concept (observation of what was tested - never a forecast).
 *
 * Read-only: nothing is stored, no practice attempt is written from simulation data, no simulation is modified, and no route
 * reads it. Without a `finalizedSimulationReader` the report simply has no simulations. Returns `null` when the exam has no
 * published question pool. It computes no score, percentage, probability, category or verdict.
 */
export async function composeExamPerformanceIntelligence(deps: TrainingRecommendationDependencies, request: TrainingRecommendationRequest): Promise<ExamPerformanceIntelligence | null> {
  const input = await composeTrainingOrchestrationInput({ ...deps, repairPlanStatusWriter: undefined }, request);
  const composition = composeRevisionFromInput(input);
  if (composition === null) return null;
  const curriculum = await buildCurriculumFromInput(deps, input, composition);

  const states = deps.finalizedSimulationReader ? await deps.finalizedSimulationReader.findFinalizedByStudentAndExam(input.studentId, composition.examCode) : [];
  const simulations = states.map(toFinalizedSimulationEvidence);

  const queries = await loadExamQueries(deps, composition.examCode);
  let contentAvailability: Record<string, { available: number; validated: number; published: number }> | null = null;
  let historicalRecordCounts: Record<string, number> | null = null;
  if (queries) {
    contentAvailability = {};
    historicalRecordCounts = {};
    for (const concept of composition.evidence.concepts) {
      try {
        const { available, validated, published } = queries.availability(concept.conceptName);
        contentAvailability[concept.conceptName] = { available, validated, published };
        historicalRecordCounts[concept.conceptName] = queries.historicalEvidence(concept.conceptName).length;
      } catch {
        // a concept the exam pack does not know has neither - left out, never guessed
      }
    }
  }

  return buildExamPerformanceIntelligence({
    studentId: input.studentId,
    examCode: composition.examCode,
    simulations,
    publishedPool: composition.context.candidates.filter((c) => c.validationState === "published").map((c) => c.question),
    evidence: composition.evidence,
    revision: composition.revision,
    curriculum,
    exam: { contentAvailability, historicalRecordCounts }
  });
}
