import { SimulationError, type SimulationQuestionOutcome, type SimulationResult, type SimulationSectionOutcome, type SimulationState } from "./types.js";

/**
 * The DOWNSTREAM INTEGRATION CONTRACT (Unit 4 -> Unit 5 and any later consumer).
 *
 * This is the ONLY shape in which simulation data may later feed other intelligence, and only for a FINALIZED simulation.
 * Nothing in the codebase calls it today: finalizing a simulation writes no practice attempt, no mastery evidence, no repair
 * plan, no revision state and no training or adaptive input. A consumer must opt in explicitly by calling this function.
 *
 * It carries raw observable outcomes only: no score (none is defined), no readiness, no mastery, no confidence, no ability,
 * no prediction, no interpretation, and no chosen answer or answer key.
 */
export interface FinalizedSimulationEvidence {
  contract: "finalized_simulation_evidence_v1";
  simulationId: string;
  studentId: string;
  enrollmentId: string;
  examCode: string;
  configVersion: string;
  paperSourceRef: string;
  isHistoricalPaper: false;
  status: SimulationResult["status"];
  timing: SimulationResult["timing"];
  questions: readonly Omit<SimulationQuestionOutcome, "chosenAnswer">[];
  sections: readonly SimulationSectionOutcome[];
  totals: SimulationResult["totals"];
  scoring: SimulationResult["scoring"];
  interpretation: "none";
}

/** Builds the downstream evidence for a FINALIZED simulation; refuses an in-progress one (its answers are partial and not evidence). */
export function toFinalizedSimulationEvidence(state: SimulationState): FinalizedSimulationEvidence {
  if (state.status === "in_progress" || state.result === null) {
    throw new SimulationError("not_finalized", "Only a finalized simulation can become downstream evidence.");
  }
  const r = state.result;
  return {
    contract: "finalized_simulation_evidence_v1",
    simulationId: state.id,
    studentId: state.studentId,
    enrollmentId: state.enrollmentId,
    examCode: state.examCode,
    configVersion: r.configVersion,
    paperSourceRef: r.paperSourceRef,
    isHistoricalPaper: false,
    status: r.status,
    timing: r.timing,
    questions: r.questions.map(({ chosenAnswer: _chosen, ...rest }) => {
      void _chosen;
      return rest;
    }),
    sections: r.sections,
    totals: r.totals,
    scoring: r.scoring,
    interpretation: "none"
  };
}
