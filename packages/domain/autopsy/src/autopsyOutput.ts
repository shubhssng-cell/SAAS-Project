import { deriveBehaviorSignals, deriveHintSolutionEvidence } from "./behaviorSignals.js";
import { deriveCandidateErrorEvidence } from "./errorEvidence.js";
import { deriveHistoricalSignals } from "./historicalSignals.js";
import type { AutopsyInput, AutopsyOutput } from "./types.js";

/**
 * The single entry point that assembles a full, deterministic
 * `AutopsyOutput` from an `AutopsyInput` (Phase 5A §9). Pure — never
 * mutates `input.evidence`/`input.priorAttempts`, never calls an AI
 * provider, never writes prose. This is the OBSERVATION -> EVIDENCE
 * boundary this phase implements; nothing past this function's return
 * value is a hypothesis or a diagnosis (see docs/PHASE_5A_REVIEW.md).
 */
export function buildAutopsyOutput(input: AutopsyInput): AutopsyOutput {
  const priorAttempts = input.priorAttempts ?? [];

  const behaviorSignals = deriveBehaviorSignals(input.evidence);
  const hintSolutionEvidence = deriveHintSolutionEvidence(input.evidence);
  const historicalSignals = deriveHistoricalSignals({ evidence: input.evidence, question: input.question }, priorAttempts);
  const candidateErrorEvidence = deriveCandidateErrorEvidence(input.evidence, input.question, input.errorTaxonomy);

  const availableEvidence: string[] = [
    "attempt_event_timeline",
    "answer_change_sequence",
    "question_dna_context",
    "error_taxonomy_reference"
  ];
  if (input.evidence.hintsUsed > 0) availableEvidence.push("hints_used_count");
  if (input.evidence.solutionOpenedAt !== null) availableEvidence.push("solution_opened_timestamp");
  if (input.evidence.timeTakenSeconds !== null) availableEvidence.push("time_taken");
  if (input.evidence.expectedTimeSeconds !== null) availableEvidence.push("expected_time");
  if (priorAttempts.length > 0) availableEvidence.push("prior_attempt_history");

  const missingEvidence: string[] = [
    "reasoning_text (why the student answered this way — not consumed by this phase's evidence contract)",
    "working_steps (the student's scratch/computation input — not consumed by this phase's evidence contract)"
  ];
  if (input.evidence.timeTakenSeconds === null || input.evidence.expectedTimeSeconds === null) {
    missingEvidence.push("valid time/expected-time pair — speedRatio and every *_fast/*_slow/time_above_expected/time_below_expected signal are unavailable");
  }
  if (priorAttempts.length === 0) {
    missingEvidence.push("prior attempt history — no repeated/historical evidence could be evaluated");
  }

  return {
    attemptFacts: input.evidence,
    questionFacts: input.question,
    behaviorSignals,
    hintSolutionEvidence,
    historicalSignals,
    candidateErrorEvidence,
    availableEvidence,
    missingEvidence
  };
}
