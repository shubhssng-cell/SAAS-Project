import type { QuestionBlueprint } from "./blueprint.js";
import type { JudgeView, PresentedQuestionView } from "./verifierView.js";

/**
 * Real, usable prompts — not exercised against a live provider in this
 * environment (no API key configured; see the Phase 3 report), but
 * written to actually work the moment one is. Every prompt explicitly
 * forbids completeness claims, since that's the one failure mode a
 * schema alone cannot rule out (docs/DECISIONS.md D-007).
 */

export function buildLensRegenerationSystemPrompt(): string {
  return [
    "You are analyzing one concept from an Indian competitive exam (IPMAT) quant syllabus.",
    "Identify what is actually tested, how it can legitimately be tested, and what can go wrong when a student attempts it.",
    "Never claim or imply that your analysis is complete or exhaustive — describe only what you can concretely support.",
    "Return ONLY a single JSON object matching the required schema. No markdown fences, no commentary outside the JSON."
  ].join(" ");
}

export function buildLensRegenerationUserPrompt(input: {
  conceptName: string;
  conceptDescription: string;
  neighborConcepts: Array<{ name: string; description: string }>;
}): string {
  const neighbors = input.neighborConcepts.map((n) => `- ${n.name}: ${n.description}`).join("\n");
  return [
    `Concept: ${input.conceptName}`,
    `Description: ${input.conceptDescription}`,
    "",
    "Other concepts that exist in this exam's syllabus (you are not told how, or whether, they relate to the concept above):",
    neighbors,
    "",
    "Analyze the concept above. Propose which of the other concepts it could legitimately combine with in a question, and why.",
    "Identify testing modes from the fixed vocabulary, error modes a student might fall into, and difficulty dimensions (0-1 each)."
  ].join("\n");
}

export function buildGenerationSystemPrompt(): string {
  return [
    "You generate exam-quality quantitative aptitude questions for Indian competitive exams (IPMAT).",
    "You will be given a precise blueprint. You MUST NOT change ANY of the following from what the blueprint specifies:",
    "the concept, the pattern family, the target skill, the difficulty tier, the required combination concepts (exactly that set, not a superset or subset), the trap you are asked to build in (if one is specified), and every testing mode listed as required (you may exercise additional modes, but never fewer).",
    "These are checked deterministically after you respond and a mismatch on any one of them causes the whole candidate to be rejected — echo the blueprint's own values back in questionDna, do not paraphrase or substitute a similar-sounding alternative.",
    "Your groundTruthDerivation.computation MUST be a plain arithmetic expression (numbers and + - * / ^ ( ) only) that evaluates to groundTruthDerivation.expectedAnswer — it will be independently recomputed and compared; do not include any words, variable names, or commas in it.",
    "The stem must never state or imply the correct answer's value, and must never contain any internal identifier such as the blueprint id — a student reading only the stem and options must not already know the answer.",
    "Never claim your method covers every possible question of this type, or any similar completeness claim.",
    "Return ONLY a single JSON object matching the required schema. No markdown fences, no commentary."
  ].join(" ");
}

export function buildGenerationUserPrompt(blueprint: QuestionBlueprint): string {
  return [
    `Blueprint id (echo this back exactly as blueprintId): ${blueprint.id}`,
    `Concept: ${blueprint.conceptName}`,
    `Pattern family: ${blueprint.patternFamilyName}`,
    `Target skill: ${blueprint.targetSkill}`,
    `Difficulty tier: ${blueprint.difficultyTier}`,
    `Combination concepts to include: ${blueprint.combinationConcepts.join(", ") || "(none)"}`,
    `Testing modes to exercise: ${blueprint.testingModes.join(", ") || "(none specified)"}`,
    blueprint.transformationDescription ? `Specific transformation: ${blueprint.transformationDescription}` : "",
    blueprint.trapErrorTaxonomyCode ? `Trap to build in: ${blueprint.trapErrorTaxonomyCode}` : "",
    `Expected solving time: ${blueprint.expectedTimeSeconds} seconds`,
    `Answer format: ${blueprint.answerFormat}`,
    "",
    "Generate exactly one candidate question matching this blueprint."
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReverificationSystemPrompt(): string {
  return [
    "You solve quantitative aptitude questions from scratch, showing your steps.",
    "You are not told anything about how the question was created, what answer anyone else derived, or any explanation.",
    "If the question is multiple-choice, determine which option is correct and give its exact text as derivedAnswer.",
    "If it is numeric-entry, give the exact numeric value as derivedAnswer.",
    "Return ONLY a single JSON object with your own derived answer and derivation steps — no markdown fences, no commentary."
  ].join(" ");
}

/**
 * Built ONLY from a PresentedQuestionView (docs/DECISIONS.md D-020) —
 * never from the full candidate. This function's parameter type alone
 * makes it impossible to accidentally reference candidate.correctAnswer,
 * .explanation, .groundTruthDerivation, .solutionSteps, or .reasoning:
 * those fields don't exist on the type this function accepts.
 */
export function buildReverificationUserPrompt(view: PresentedQuestionView): string {
  const lines = [`Question: ${view.stem}`];
  if (view.answerFormat === "multiple_choice" && view.options) {
    lines.push("Options:");
    view.options.forEach((option, i) => lines.push(`${String.fromCharCode(65 + i)}. ${option}`));
    lines.push("Determine which option is correct.");
  } else {
    lines.push("This is a numeric-entry question. Compute the exact numeric answer.");
  }
  return lines.join("\n");
}

export function buildJudgeSystemPrompt(): string {
  return [
    "You are a strict quality reviewer for exam questions. You do not write questions; you only judge ones already written.",
    "You are shown ONLY the question stem and its options (and the difficulty tier it claims to be) — exactly what a student",
    "would see, plus that one claim. You are NOT told what anyone believes the correct answer is, and must not assume one.",
    "Independently determine: is it syllabus-relevant, does it have exactly one defensible correct answer among the options",
    "(if multiple options could be defended as correct, or none can, say so), is any wording ambiguous, are any conditions",
    "contradictory, and is the claimed difficulty tier honest given the actual reasoning the question demands.",
    "List every concrete issue you find in `issues` — do not pass a question just because it looks fine at a glance.",
    "Return ONLY a single JSON object matching the required schema."
  ].join(" ");
}

/**
 * Built ONLY from a JudgeView — the judge never sees the candidate's
 * claimed answer, explanation, solution steps, or reasoning (docs/
 * QUESTION_ENGINE.md §5b / Phase 3.1 §8). It must independently determine
 * whether the question has exactly one defensible answer, not check
 * whether it agrees with a claim it was never shown.
 */
export function buildJudgeUserPrompt(view: JudgeView): string {
  const lines = [`Claimed difficulty tier: ${view.claimedDifficultyTier}`, `Stem: ${view.stem}`];
  if (view.answerFormat === "multiple_choice" && view.options) {
    lines.push("Options:");
    view.options.forEach((option, i) => lines.push(`${String.fromCharCode(65 + i)}. ${option}`));
  } else {
    lines.push("(numeric entry, no options)");
  }
  lines.push(
    "Judge only the question above. Determine independently whether it has exactly one defensible correct answer — do not assume any particular answer is correct."
  );
  return lines.join("\n");
}
