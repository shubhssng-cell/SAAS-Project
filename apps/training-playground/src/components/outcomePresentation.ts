import type { TrainingSystemOutcome } from "@ipmat/training-systems";
import type { TrainingOrchestrationResult } from "@ipmat/training-orchestration";

export type OutcomeTone = "applicable" | "not-applicable" | "selected" | "no-eligible" | "error" | "no-action";

export interface OutcomePresentation {
  statusLabel: string;
  tone: OutcomeTone;
  explanation: string;
  questionId: string | null;
  wasFallbackFromRepair: boolean | null;
  actionType: string | null;
}

/**
 * Pure PRESENTATION mapping only -- every field read here was already
 * decided by the real domain call in `runScenario.ts`. This function
 * chooses a label/badge tone for an already-final status string; it never
 * evaluates applicability, recurrence, or selection itself (docs/
 * DECISIONS.md D-057).
 */
export function describeOutcome(outcome: TrainingSystemOutcome | TrainingOrchestrationResult): OutcomePresentation {
  if (outcome.status === "error") {
    return { statusLabel: `Error: ${outcome.code}`, tone: "error", explanation: outcome.explanation, questionId: null, wasFallbackFromRepair: null, actionType: null };
  }

  if (outcome.status === "not_applicable") {
    return { statusLabel: `Not applicable (${outcome.reason})`, tone: "not-applicable", explanation: outcome.explanation, questionId: null, wasFallbackFromRepair: null, actionType: null };
  }

  if (outcome.status === "no_eligible_question") {
    return { statusLabel: "Applicable, but no eligible question", tone: "no-eligible", explanation: outcome.explanation, questionId: null, wasFallbackFromRepair: null, actionType: null };
  }

  if (outcome.status === "no_action") {
    return { statusLabel: `No action (${outcome.reason})`, tone: "no-action", explanation: outcome.explanation, questionId: null, wasFallbackFromRepair: null, actionType: null };
  }

  // status === "selected", for either a TrainingSystemOutcome or a TrainingOrchestrationResult.
  const actionType = "actionType" in outcome ? outcome.actionType : null;
  const wasFallbackFromRepair = "wasFallbackFromRepair" in outcome ? outcome.wasFallbackFromRepair : null;
  return {
    statusLabel: actionType ? `Selected (${actionType})` : "Selected",
    tone: "selected",
    explanation: outcome.explanation,
    questionId: outcome.question.questionId,
    wasFallbackFromRepair,
    actionType
  };
}

export const SYSTEM_DISPLAY_NAMES: Record<string, string> = {
  "calculation-gym": "Calculation Gym",
  "speed-lab": "Speed Lab",
  "trap-lab": "Trap Lab",
  "training-orchestration": "Training Orchestration"
};
