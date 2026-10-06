import { buildMasteryEvidenceView, computeMasteryState } from "@ipmat/mastery";
import { buildRevisionIntelligence, scopeContextToExam, type RevisionIntelligence } from "@ipmat/revision-intelligence";
import { orchestrateNextTrainingAction, toTrainingSystemContext, type ActiveRepairPlanContext, type TrainingOrchestrationInput } from "@ipmat/training-orchestration";
import { buildAdaptiveCurriculum, type AdaptiveCurriculum } from "@ipmat/adaptive-curriculum";
import { attempt, candidate, EXAM, NOW, question, realRuns, resetCounter, STUDENT } from "./baseFixtures.js";

export { attempt, candidate, EXAM, NOW, question, resetCounter, STUDENT };
export type Records = ReturnType<typeof attempt>[];
export type Pool = ReturnType<typeof candidate>[];

/** A confirmed repair plan, as the orchestrator receives it (target facts are what a real confirmed plan carries). */
export function repairPlan(over: Partial<ActiveRepairPlanContext["plan"]> = {}): ActiveRepairPlanContext {
  return {
    plan: {
      targetConceptName: "Percentages",
      targetPatternFamilyName: "Reverse Percentage",
      targetTaxonomyCellId: "cell-repair-target",
      targetErrorCategory: "misconception",
      targetErrorTaxonomyCode: "base_confusion",
      recommendedTrainingMode: "guided_hint_first",
      priority: "high",
      rationale: [],
      prerequisites: [],
      confirmationSource: { attemptId: "diagnosed-attempt", hypothesisConfirmedAt: "2026-09-20T10:00:00.000Z" },
      ...over
    }
  };
}

export interface Built {
  curriculum: AdaptiveCurriculum;
  revision: RevisionIntelligence;
  orchestrationInput: TrainingOrchestrationInput;
}

/** Runs the REAL pipeline: scoped context -> real orchestrator -> Unit 1 evidence -> real providers -> Unit 2 intelligence -> curriculum. */
export function build(records: Records, candidates: Pool, plans: ActiveRepairPlanContext[] = [], now: string = NOW): Built {
  // the concept universe is THIS exam's concepts (in the product it comes from the exam's concept reader), never another exam's or student's
  const conceptNames = [...new Set([...records.filter((r) => r.question.examCode === EXAM && r.contribution.studentId === STUDENT).map((r) => r.question.conceptName), ...candidates.filter((c) => c.question.examCode === EXAM).map((c) => c.question.conceptName)])].sort();
  const masteryByConcept = conceptNames.map((conceptName) => computeMasteryState(records.filter((r) => r.question.examCode === EXAM && r.contribution.studentId === STUDENT), { studentId: STUDENT, conceptId: `concept-${conceptName}`, conceptName, now }));
  const orchestrationInput: TrainingOrchestrationInput = { studentId: STUDENT, activeRepairPlans: plans, masteryByConcept, attemptRecords: records, candidates, now };
  const context = scopeContextToExam(toTrainingSystemContext(orchestrationInput), EXAM);
  const evidence = buildMasteryEvidenceView(context.attemptRecords, { studentId: STUDENT, examCode: EXAM, conceptNames });
  const revision = buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence, context, runs: realRuns(context) });
  const orchestration = orchestrateNextTrainingAction({ ...orchestrationInput, attemptRecords: context.attemptRecords, candidates: context.candidates });
  const curriculum = buildAdaptiveCurriculum({ studentId: STUDENT, examCode: EXAM, evidence, revision, orchestration, activeRepairPlans: plans, candidates: context.candidates });
  return { curriculum, revision, orchestrationInput };
}

/** Percentages graded ~20 days ago with a recurring trap and a fresh trap question: Trap Lab selects, Revision is also applicable. */
export function trapWorld(): { records: Records; candidates: Pool } {
  const q1 = question("q-1", { trapErrorTaxonomyCode: "base_confusion" });
  const q2 = question("q-2", { trapErrorTaxonomyCode: "base_confusion", patternFamilyName: "Successive Percentage Change", testingModes: ["combined"] });
  const q3 = question("q-3");
  const trap = question("q-trap", { trapErrorTaxonomyCode: "base_confusion" });
  const fresh = question("q-fresh", { noveltyLevel: "novel_representation", testingModes: ["represented_differently"] });
  return {
    records: [attempt(q1, { isCorrect: false, daysAgo: 22 }), attempt(q2, { isCorrect: false, daysAgo: 21 }), attempt(q3, { isCorrect: true, daysAgo: 20 })],
    candidates: [candidate(q1), candidate(q2), candidate(q3), candidate(trap), candidate(fresh)]
  };
}

/** A recent, thin history: no provider applies, adaptive practice is the fallback. */
export function adaptiveWorld(): { records: Records; candidates: Pool } {
  const a = question("a-1");
  return { records: [attempt(a, { daysAgo: 1 })], candidates: [candidate(a), candidate(question("a-2")), candidate(question("a-3", { patternFamilyName: "Successive Percentage Change" }))] };
}

/** A candidate sitting on the repair plan's exact taxonomy cell, so targeted repair can select it. */
export const repairCandidate = (): ReturnType<typeof candidate> => candidate(question("q-repair", { patternTaxonomyCellId: "cell-repair-target", trapErrorTaxonomyCode: "base_confusion" }));
