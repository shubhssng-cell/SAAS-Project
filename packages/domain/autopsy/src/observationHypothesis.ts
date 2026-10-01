import { autopsyHypothesisAiSchema, generateStructured, type AiCallOptions, type AiProvider, type AutopsyHypothesisAiOutput } from "@ipmat/ai";
import { buildHypothesisSystemPrompt } from "./hypothesisPrompts.js";
import { describeObservationEvidence, type ObservationEvidence } from "./observationEvidence.js";
import { HypothesisError, type AutopsyHypothesis } from "./types.js";

/**
 * PHASE 4 UNIT 2 -- OBSERVATION EVIDENCE -> HYPOTHESIS.
 *
 * A model proposes ONE possible explanation from the Unit 1 observation evidence; the APPLICATION owns the safety contract and decides
 * whether the proposal may reach a student. The model's output is untrusted until `validateHypothesisCandidate()` accepts it:
 *   - it must be phrased as a possibility, never as a settled fact or a cause;
 *   - it must not make private-thought, psychological or ability claims ("you thought...", "you were unsure...", "careless", ...);
 *   - every supporting-evidence entry must be one of the numbered observed facts it was given, quoted verbatim -- anything else is an
 *     unsupported claim and the whole proposal is rejected. What reaches the student is the verbatim fact, never the model's paraphrase.
 * Nothing here persists anything, creates a RepairPlan, or confirms anything: the result is always `awaiting_confirmation`, and only the
 * student's own response (`applyConfirmationResponse()`) can move it forward. `modelConfidence` and the generation metadata are internal.
 */

export const OBSERVATION_HYPOTHESIS_PROMPT_VERSION = "autopsy-hypothesis-observation-v1";
const MAX_EXPLANATION_CHARS = 400;
const MIN_EXPLANATION_CHARS = 20;

/** The generic, student-safe sentence for "the question's author designed it around a wrong-answer pattern". The pattern's NAME stays internal (taxonomy labels such as "..._confusion" or "careless_..." are question-design names, not words to put in front of a student). */
export const DESIGNED_PATTERN_FACT = "This question was designed around a common wrong-answer pattern.";

/** The numbered facts a hypothesis may cite: the shared observation sentences, plus the generic designed-pattern sentence when the question has a designed trap. */
export function buildObservationFacts(observation: ObservationEvidence): string[] {
  const facts = describeObservationEvidence(observation);
  if (observation.questionContext?.designedTrapCode) facts.push(DESIGNED_PATTERN_FACT);
  return facts;
}

export function buildObservationHypothesisSystemPrompt(): string {
  return [
    buildHypothesisSystemPrompt(),
    "ADDITIONAL RULES FOR THIS TASK: the evidence is given as numbered OBSERVED FACTS. Every entry in supportingEvidence MUST be one of those facts copied VERBATIM (the full sentence) — never paraphrased, and never a fact that is not listed.",
    "The correct answer and the question text are NOT provided: do not state or guess either.",
    "Write proposedExplanation as one or two short sentences describing a PATTERN the observed facts are consistent with (for example a concept or pattern the question was built around), phrased as a possibility. Do NOT say what the student thought, knew, felt, believed, assumed, wanted or intended, and avoid words like confused, unsure, careless or guessed; prefer wording such as 'treated X as Y' or 'applied X where Y was needed'.",
    "contradictoryEvidence lists facts (verbatim) that do not fit the hypothesis; missingEvidence lists what is not known."
  ].join(" ");
}

export function buildObservationHypothesisUserPrompt(facts: string[], unknown: string[], designedTrapCode?: string | null): string {
  const lines: string[] = ["== OBSERVED FACTS (cite verbatim) =="];
  facts.forEach((fact, i) => lines.push(`${i + 1}. ${fact}`));
  if (designedTrapCode) {
    lines.push("");
    lines.push("== DESIGNED WRONG-ANSWER PATTERN (internal question metadata; describe the idea in plain words and do NOT quote this label) ==");
    lines.push(designedTrapCode.replace(/_/g, " "));
  }
  lines.push("");
  lines.push("== NOT RECORDED / UNKNOWN (treat as unknown, do not infer) ==");
  lines.push(unknown.length > 0 ? unknown.join(" | ") : "(nothing listed)");
  lines.push("");
  lines.push("Propose exactly one hypothesis using only the observed facts above.");
  return lines.join("\n");
}

const POSSIBILITY = /\b(may|might|could|possibly|possible|perhaps|consistent with|one explanation|suggests?)\b/i;
const CERTAINTY = /\b(definitely|certainly|clearly|obviously|undoubtedly|for sure|without doubt|proves?|proved|you misunderstood|you (do not|don't|dont) understand|you failed to|the reason is|because you|is because|was because)\b/i;
const PRIVATE_OR_PSYCHOLOGICAL =
  /\b(confiden\w*|motivat\w*|anxi\w*|nervous\w*|panic\w*|stress\w*|lazy|laziness|careless\w*|intelligen\w*|smart|stupid|emotion\w*|personalit\w*|afraid|fear\w*|effort|attention|distract\w*|unsure|uncertain\w*|confus\w*|doubt\w*|hesitat\w*|guess\w*|rush\w*|gave up|lack\w*|weakness|struggl\w*|understand\w*|misunderstood|knew|thought|felt|believed|assumed|intended|wanted|trying to|realiz\w*)\b/i;

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

export type HypothesisRejection = "empty_or_malformed" | "not_phrased_as_possibility" | "stated_as_certain" | "psychological_or_private_claim" | "unsupported_evidence" | "no_supporting_evidence";

export type HypothesisValidation = { ok: true; supportingEvidence: string[]; contradictoryEvidence: string[]; missingEvidence: string[] } | { ok: false; reasons: HypothesisRejection[] };

/** Pure and deterministic; the single gate between a model's proposal and a student. Exported so every rejection is directly testable. */
export function validateHypothesisCandidate(candidate: AutopsyHypothesisAiOutput, facts: string[]): HypothesisValidation {
  const reasons: HypothesisRejection[] = [];
  const explanation = candidate.proposedExplanation.trim();
  if (explanation.length < MIN_EXPLANATION_CHARS || explanation.length > MAX_EXPLANATION_CHARS) reasons.push("empty_or_malformed");
  if (!POSSIBILITY.test(explanation)) reasons.push("not_phrased_as_possibility");
  if (CERTAINTY.test(explanation)) reasons.push("stated_as_certain");
  if (PRIVATE_OR_PSYCHOLOGICAL.test(explanation)) reasons.push("psychological_or_private_claim");

  const canonicalFacts = facts.map((fact) => ({ fact, key: normalize(fact) }));
  const grounded: string[] = [];
  let unsupported = false;
  for (const item of candidate.supportingEvidence) {
    const key = normalize(item);
    const match = canonicalFacts.find((f) => key === f.key || key.includes(f.key));
    if (match === undefined) unsupported = true;
    else if (!grounded.includes(match.fact)) grounded.push(match.fact);
  }
  if (unsupported) reasons.push("unsupported_evidence");
  if (grounded.length === 0) reasons.push("no_supporting_evidence");

  if (reasons.length > 0) return { ok: false, reasons };

  // Internal lists are kept only when they are themselves safe; they never reach the student.
  const safe = (items: string[]): string[] => items.map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 300 && !PRIVATE_OR_PSYCHOLOGICAL.test(s));
  return { ok: true, supportingEvidence: grounded, contradictoryEvidence: safe(candidate.contradictoryEvidence), missingEvidence: safe(candidate.missingEvidence) };
}

export interface ObservationHypothesisInput {
  observation: ObservationEvidence;
}

/**
 * Generates an `awaiting_confirmation` hypothesis from observation evidence, through `@ipmat/ai`'s `generateStructured()` (no direct provider
 * call, no unvalidated parse). Fails closed WITHOUT an AI call when there is nothing to diagnose (anything but a submitted, incorrect
 * attempt), and with `unsafe_hypothesis_output` when the model's proposal fails `validateHypothesisCandidate()`. Provider and schema
 * failures propagate as `AiGenerationError`; the caller decides how to fall back (it must never fabricate a hypothesis).
 */
export async function generateObservationHypothesis(provider: AiProvider, input: ObservationHypothesisInput, options?: AiCallOptions): Promise<AutopsyHypothesis> {
  const { observation } = input;
  if (observation.outcome.status !== "submitted" || observation.outcome.verdict !== "incorrect") {
    throw new HypothesisError("no_evidence_to_diagnose", "A hypothesis is only generated for a submitted, incorrect attempt; there is nothing to explain here.");
  }

  const facts = buildObservationFacts(observation);
  const result = await generateStructured(provider, {
    task: "autopsy-hypothesis",
    promptVersion: OBSERVATION_HYPOTHESIS_PROMPT_VERSION,
    systemPrompt: buildObservationHypothesisSystemPrompt(),
    userPrompt: buildObservationHypothesisUserPrompt(facts, observation.unknown, observation.questionContext?.designedTrapCode),
    schema: autopsyHypothesisAiSchema,
    options: { temperature: 0, timeoutMs: 20_000, maxRetries: 1, ...options }
  });

  const verdict = validateHypothesisCandidate(result.data, facts);
  if (!verdict.ok) {
    throw new HypothesisError("unsafe_hypothesis_output", `The proposed hypothesis was rejected: ${verdict.reasons.join(", ")}.`);
  }

  return {
    attemptId: observation.identity.attemptId,
    proposedErrorCategory: result.data.proposedErrorCategory,
    proposedExplanation: result.data.proposedExplanation.trim(),
    supportingEvidence: verdict.supportingEvidence,
    contradictoryEvidence: verdict.contradictoryEvidence,
    missingEvidence: verdict.missingEvidence,
    modelConfidence: result.data.modelConfidence,
    confirmationRequired: true,
    confirmationStatus: "awaiting_confirmation",
    studentCorrectionText: null,
    respondedAt: null,
    generationMetadata: result.metadata
  };
}
