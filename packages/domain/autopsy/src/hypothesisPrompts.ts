import type { AutopsyOutput } from "./types.js";

/**
 * The HYPOTHESIS-layer prompt pair (Phase 5B §3). The system prompt is
 * the actual trust boundary — everything it forbids is exactly what
 * would turn a deterministic EVIDENCE layer into an unreliable
 * HYPOTHESIS layer: inventing evidence that wasn't given, stating a
 * psychological trait as fact, or skipping the requirement that the
 * student must confirm before anything downstream trusts this output.
 */
export function buildHypothesisSystemPrompt(): string {
  return [
    "You are proposing a HYPOTHESIS about why a student's answer to a quantitative aptitude question was incorrect.",
    "You will be given deterministic EVIDENCE already computed from the student's actual recorded behavior and the question's design — facts, not your own judgment of what happened.",
    "You MUST use ONLY the evidence given to you. Do NOT invent, assume, or infer any fact that was not explicitly provided — if something is listed as missing evidence, treat it as genuinely unknown, not as something you can guess at.",
    "You MUST NOT make any claim about the student's confidence, motivation, emotional state, intelligence, anxiety, effort, or intent. These are not observable and are not your job to infer. Describe only what the evidence shows.",
    "Your proposedExplanation MUST be phrased explicitly as a hypothesis (e.g. 'this pattern is consistent with...', 'the student may have...') — never as a stated fact or a certain diagnosis. It is not confirmed until the student says so.",
    "You MUST cite the specific evidence that supports your hypothesis in supportingEvidence, note anything that contradicts it in contradictoryEvidence, and note what evidence is missing that would make this more certain in missingEvidence.",
    "If you provide a confidence value, it must be YOUR OWN confidence in this specific hypothesis (modelConfidence) — it is not, and must never be presented as, a measurement of the student's confidence in anything. If you have no reasonable basis for a number, return null for modelConfidence rather than guessing one.",
    "This hypothesis will be shown to the student, who must explicitly confirm, reject, or correct it before it is treated as a real diagnosis or used for anything else — write it as something a student can meaningfully evaluate, not as a final verdict.",
    "Return ONLY a single JSON object matching the required schema. No markdown fences, no commentary."
  ].join(" ");
}

/**
 * Serializes exactly what `AutopsyOutput` already computed — never
 * re-derives or reinterprets it. Every section is explicitly labeled by
 * what kind of claim it is (observed fact, candidate/unconfirmed match,
 * repetition count) so the model cannot mistake one for another.
 */
export function buildHypothesisUserPrompt(input: { autopsyOutput: AutopsyOutput; reasoningText?: string | null }): string {
  const { autopsyOutput: output, reasoningText } = input;
  const lines: string[] = [];

  lines.push("== ATTEMPT FACTS (observed) ==");
  lines.push(`Status: ${output.attemptFacts.status}`);
  lines.push(`Correct answer: ${output.attemptFacts.correctAnswer}`);
  lines.push(`Student's final answer: ${output.attemptFacts.finalAnswer ?? "(none)"}`);
  lines.push(`Was correct: ${output.attemptFacts.isCorrect}`);
  lines.push(
    `Answer-change sequence: ${output.attemptFacts.answerChangeHistory.sequence.map((p) => p.answer).join(" -> ") || "(no changes recorded)"}`
  );
  lines.push(`Time taken (seconds): ${output.attemptFacts.timeTakenSeconds ?? "(unknown)"}`);
  lines.push(`Expected time (seconds): ${output.attemptFacts.expectedTimeSeconds ?? "(unknown)"}`);
  lines.push(`Hints used: ${output.attemptFacts.hintsUsed}`);
  lines.push(`Solution opened: ${output.attemptFacts.solutionOpenedAt !== null}`);

  lines.push("");
  lines.push("== QUESTION CONTEXT (authoritative) ==");
  lines.push(`Concept: ${output.questionFacts.conceptName}`);
  lines.push(`Pattern family: ${output.questionFacts.patternFamilyName}`);
  lines.push(`Difficulty tier: ${output.questionFacts.difficultyTier}`);
  lines.push(`Novelty level: ${output.questionFacts.noveltyLevel}`);
  lines.push(`Testing modes: ${output.questionFacts.testingModes.join(", ") || "(none)"}`);
  lines.push(`Designated trap code (if any): ${output.questionFacts.trapErrorTaxonomyCode ?? "(none)"}`);

  lines.push("");
  lines.push("== BEHAVIOR SIGNALS (deterministic, already computed — observed facts, not your judgment) ==");
  lines.push(JSON.stringify(output.behaviorSignals));

  if (output.historicalSignals) {
    lines.push("");
    lines.push("== HISTORICAL SIGNALS (repetition COUNTS only — not a diagnosis, not evidence of understanding) ==");
    lines.push(JSON.stringify(output.historicalSignals));
  } else {
    lines.push("");
    lines.push("== HISTORICAL SIGNALS: none available — no prior attempt history was supplied ==");
  }

  if (output.candidateErrorEvidence) {
    lines.push("");
    lines.push("== CANDIDATE ERROR EVIDENCE (a deterministic, UNCONFIRMED pattern match — a starting point, not a conclusion) ==");
    lines.push(`Candidate category: ${output.candidateErrorEvidence.proposedErrorCategory ?? "(none resolved)"}`);
    lines.push(`Candidate taxonomy code: ${output.candidateErrorEvidence.proposedErrorTaxonomyCode ?? "(none resolved)"}`);
    lines.push(`Supporting: ${output.candidateErrorEvidence.supportingEvidence.join(" | ")}`);
    lines.push(`Missing: ${output.candidateErrorEvidence.missingEvidence.join(" | ")}`);
  }

  lines.push("");
  lines.push(`== REASONING TEXT (the student's own stated explanation, when available) ==`);
  lines.push(reasoningText ? reasoningText : "(not available for this attempt)");

  lines.push("");
  lines.push("== EVIDENCE EXPLICITLY NOT AVAILABLE ==");
  lines.push(output.missingEvidence.join(" | "));

  lines.push("");
  lines.push("Propose exactly one hypothesis for what likely went wrong, using only the evidence above.");

  return lines.join("\n");
}
