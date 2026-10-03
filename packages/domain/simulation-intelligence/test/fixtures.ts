import { buildMasteryEvidenceView } from "@ipmat/mastery";
import {
  applyMutation,
  assemblePaper,
  planAnswer,
  planSubmit,
  startSimulation,
  toFinalizedSimulationEvidence,
  type AnswerKey,
  type FinalizedSimulationEvidence,
  type PaperCandidate,
  type SimulationConfig,
  type SimulationState
} from "@ipmat/exam-simulation";
import { buildExamPerformanceIntelligence, type ExamPerformanceInput, type ExamPerformanceIntelligence } from "../src/index.js";
import { attempt, build, candidate, EXAM, question, repairCandidate, repairPlan, resetCounter, STUDENT, trapWorld, type Pool, type Records } from "./curriculumFixtures.js";

export { attempt, build, candidate, EXAM, question, repairCandidate, repairPlan, resetCounter, STUDENT, trapWorld };

const SIM_T0 = "2026-10-03T10:00:00.000Z";
export const ms = (offset: number): string => new Date(Date.parse(SIM_T0) + offset).toISOString();

/** FIXTURE configuration for the Unit 4 engine (labelled test data - not an exam rule). */
export const simConfig = (configVersion = "fixture-v1", over: Partial<SimulationConfig> = {}): SimulationConfig => ({
  examCode: EXAM,
  configVersion,
  overallDurationSeconds: 600,
  sections: [{ sectionName: "Quant", order: 1, questionCount: 3 }],
  provenance: { kind: "authored", sourceRef: "fixture:simulation-intelligence-tests (not an exam rule)", reviewState: "unvalidated", reviewedBy: null, note: "TEST DATA" },
  ...over
});

const fp = (id: string): string => `fp-${id}`;
export const keyFor = (ids: readonly string[]): AnswerKey => Object.fromEntries(ids.map((id) => [id, { correctAnswer: "right", contentFingerprint: fp(id) }]));

export interface FinalizedSimOptions {
  id: string;
  questionIds: readonly string[];
  /** position (1-based) -> answer text ("right" is correct, anything else incorrect). Absent = unanswered. */
  answers?: Record<number, string>;
  configVersion?: string;
  studentId?: string;
  examCode?: string;
  /** Offset (ms) of the simulation start from a fixed instant; finalization is always after it. */
  startMs?: number;
  /** "submit" finalizes by the student at `submitAfterMs`; "deadline" lets the deadline end it. */
  end?: "submit" | "deadline";
  submitAfterMs?: number;
  sectionName?: string;
}

/** A REAL finalized simulation, produced by the Unit 4 engine and exported through its explicit evidence contract. */
export async function finalizedSimulation(o: FinalizedSimOptions): Promise<{ state: SimulationState; evidence: FinalizedSimulationEvidence }> {
  const sectionName = o.sectionName ?? "Quant";
  const config = simConfig(o.configVersion ?? "fixture-v1", { examCode: o.examCode ?? EXAM, sections: [{ sectionName, order: 1, questionCount: o.questionIds.length }] });
  const candidates: PaperCandidate[] = o.questionIds.map((questionId) => ({ questionId, examCode: config.examCode, sectionName, validationState: "published", sourceType: "original", contentFingerprint: fp(questionId) }));
  const paper = assemblePaper(config, { origin: "assembled", sourceRef: "fixture:paper", sections: { [sectionName]: o.questionIds } }, candidates);
  const start = o.startMs ?? 0;
  let state = startSimulation({ id: o.id, studentId: o.studentId ?? STUDENT, enrollmentId: "enr-1", config, paper, now: ms(start) });
  const loadKey = async (): Promise<AnswerKey> => keyFor(o.questionIds);
  let t = start;
  for (const [position, answer] of Object.entries(o.answers ?? {})) {
    t += 1000;
    const r = await planAnswer(state, { position: Number(position), answer }, ms(t), { options: null, currentFingerprint: fp(o.questionIds[Number(position) - 1]!) }, loadKey);
    state = applyMutation(state, r.mutation);
  }
  const end = o.end ?? "submit";
  const at = end === "deadline" ? start + 600_000 + 5_000 : start + (o.submitAfterMs ?? t - start + 1000);
  state = applyMutation(state, (await planSubmit(state, ms(at), loadKey)).mutation);
  return { state, evidence: toFinalizedSimulationEvidence(state) };
}

export interface Units {
  records: Records;
  pool: Pool;
}

/** The Unit 3 trap world (real orchestrator/providers/Unit 1/Unit 2) and the pool DNA, ready to combine with simulations. */
export function unitsFor(records: Records, pool: Pool, plans = [] as ReturnType<typeof repairPlan>[]) {
  const built = build(records, pool, plans);
  const evidence = buildMasteryEvidenceView(records.filter((r) => r.contribution.studentId === STUDENT && r.question.examCode === EXAM), { studentId: STUDENT, examCode: EXAM, conceptNames: built.curriculum.concepts.map((c) => c.conceptName) });
  return { curriculum: built.curriculum, revision: built.curriculum.revision, evidence, publishedPool: pool.filter((c) => c.validationState === "published" && c.question.examCode === EXAM).map((c) => c.question) };
}

export function intelligence(simulations: readonly FinalizedSimulationEvidence[], world = trapWorld(), over: Partial<ExamPerformanceInput> = {}): ExamPerformanceIntelligence {
  const u = unitsFor(world.records, world.candidates);
  return buildExamPerformanceIntelligence({ studentId: STUDENT, examCode: EXAM, simulations, publishedPool: u.publishedPool, evidence: u.evidence, revision: u.revision, curriculum: u.curriculum, ...over });
}

/** Paper ids that exist in the trap world's pool. */
export const PAPER = ["q-1", "q-2", "q-trap"];
export const PAPER_B = ["q-3", "q-fresh", "q-trap"];
