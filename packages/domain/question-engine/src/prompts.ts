import type { QuestionBlueprint } from "./blueprint.js";
import type { QuestionCandidateAiOutput } from "@ipmat/ai";

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
    "You will be given a precise blueprint. You MUST NOT change the concept, pattern family, or target skill it specifies.",
    "Your groundTruthDerivation.computation MUST be a plain arithmetic expression (numbers and + - * / ^ ( ) only) that evaluates to groundTruthDerivation.expectedAnswer — it will be independently recomputed and compared; do not include any words or variable names in it.",
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
    "You are not told anything about how the question was created or what answer anyone else derived.",
    "Return ONLY a single JSON object with your own derived answer and derivation steps — no markdown fences, no commentary."
  ].join(" ");
}

export function buildJudgeSystemPrompt(): string {
  return [
    "You are a strict quality reviewer for exam questions. You do not write questions; you only judge ones already written.",
    "Check specifically: is it syllabus-relevant, does it have exactly one defensible correct answer, is any wording ambiguous,",
    "are any conditions contradictory, and is the claimed difficulty tier honest given the actual reasoning required.",
    "List every concrete issue you find in `issues` — do not pass a question just because it looks fine at a glance.",
    "Return ONLY a single JSON object matching the required schema."
  ].join(" ");
}

export function buildJudgeUserPrompt(candidate: QuestionCandidateAiOutput): string {
  return [
    `Claimed difficulty tier: ${candidate.questionDna.difficultyTier}`,
    `Stem: ${candidate.stem}`,
    `Options: ${candidate.options ? candidate.options.join(" | ") : "(numeric entry, no options)"}`,
    `Claimed correct answer: ${candidate.correctAnswer}`,
    `Explanation: ${candidate.explanation}`
  ].join("\n");
}
