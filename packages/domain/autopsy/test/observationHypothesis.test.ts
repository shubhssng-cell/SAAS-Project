import { AiGenerationError, FixtureProvider, type AiCompletion, type AiProvider } from "@ipmat/ai";
import { describe, expect, it } from "vitest";
import { buildEvidence } from "../fixtures/evidence.js";
import { percentagesQuestionContext } from "../fixtures/questionContext.js";
import { applyConfirmationResponse } from "../src/hypothesis.js";
import { buildObservationEvidence } from "../src/observationEvidence.js";
import {
  OBSERVATION_HYPOTHESIS_PROMPT_VERSION,
  buildObservationFacts,
  buildObservationHypothesisSystemPrompt,
  buildObservationHypothesisUserPrompt,
  generateObservationHypothesis,
  validateHypothesisCandidate
} from "../src/observationHypothesis.js";
import { HypothesisError } from "../src/types.js";

/**
 * Phase 4 Unit 2 -- observation evidence -> HYPOTHESIS. The model is replaced by deterministic fixtures; nothing here calls a paid model.
 * The point is the application-owned safety contract: a proposal reaches a student only if it is possibility-phrased, free of private-thought
 * and psychological claims, and rests ONLY on facts it was given, quoted verbatim.
 */

const incorrect = () => buildObservationEvidence({ evidence: buildEvidence({ isCorrect: false, finalAnswer: "420", timeTakenSeconds: 120, expectedTimeSeconds: 90 }), question: percentagesQuestionContext });
const facts = (o = incorrect()) => buildObservationFacts(o);

function modelOutput(overrides: Record<string, unknown> = {}): string {
  const f = facts();
  return JSON.stringify({
    proposedErrorCategory: null,
    proposedExplanation: "The answer you selected may reflect the trap this question was designed around, which is consistent with a possible slip between related ideas.",
    supportingEvidence: [f[0], f[1]],
    contradictoryEvidence: [],
    missingEvidence: ["The steps used are not recorded."],
    modelConfidence: 0.6,
    ...overrides
  });
}

/** Counts calls and remembers prompts, so tests can prove "no AI call" and inspect exactly what the model was given. */
class RecordingProvider implements AiProvider {
  readonly name = "recording";
  readonly model = "recording-v1";
  calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
  constructor(private readonly responses: Array<string | Error>) {}
  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<AiCompletion> {
    this.calls.push({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt });
    const next = this.responses.shift();
    if (next === undefined) throw new Error("no response left");
    if (next instanceof Error) throw next;
    return { rawText: next, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 1 };
  }
}

describe("a valid proposal becomes an awaiting_confirmation hypothesis", () => {
  it("is grounded, possibility-phrased, never pre-confirmed, and carries its generation metadata internally", async () => {
    const provider = new FixtureProvider([modelOutput()]);
    const observation = incorrect();
    const h = await generateObservationHypothesis(provider, { observation });
    expect(h.confirmationStatus).toBe("awaiting_confirmation");
    expect(h.confirmationRequired).toBe(true);
    expect(h.studentCorrectionText).toBeNull();
    expect(h.respondedAt).toBeNull();
    expect(h.attemptId).toBe(observation.identity.attemptId);
    expect(h.proposedExplanation).toMatch(/\bmay\b/);
    expect(h.supportingEvidence).toEqual([facts()[0], facts()[1]]); // verbatim observed facts, not the model's wording
    expect(h.generationMetadata).toMatchObject({ task: "autopsy-hypothesis", promptVersion: OBSERVATION_HYPOTHESIS_PROMPT_VERSION, success: true });
  });

  it("its supporting evidence references observed facts only, even when the model adds extra text around a fact", async () => {
    const f = facts();
    const provider = new FixtureProvider([modelOutput({ supportingEvidence: [`Evidence: ${f[0]} (this is what was recorded)`, f[1]] })]);
    const h = await generateObservationHypothesis(provider, { observation: incorrect() });
    expect(h.supportingEvidence).toEqual([f[0], f[1]]);
  });

  it("the prompt carries the numbered observed facts and the unknowns, and NOT the correct answer, the question text, or any psychological field", async () => {
    const provider = new RecordingProvider([modelOutput()]);
    const observation = incorrect();
    await generateObservationHypothesis(provider, { observation });
    const prompt = provider.calls[0]!.userPrompt;
    facts(observation).forEach((fact, i) => expect(prompt).toContain(`${i + 1}. ${fact}`));
    for (const unknown of observation.unknown) expect(prompt).toContain(unknown);
    expect(prompt).not.toMatch(/correct answer|480|confidence score|motivation/i); // 480 is the fixture's correct answer
    expect(prompt).toContain("DESIGNED WRONG-ANSWER PATTERN");
    expect(facts(observation).join(" ")).not.toMatch(/confus|careless/i); // the pattern's name stays internal; only a generic sentence is a citable fact
    expect(provider.calls[0]!.systemPrompt).toMatch(/VERBATIM/);
    expect(provider.calls[0]!.systemPrompt).toMatch(/NOT provided/);
    expect(buildObservationHypothesisSystemPrompt()).toMatch(/MUST NOT make any claim about the student's confidence/);
    expect(buildObservationHypothesisUserPrompt(["A."], [])).toContain("1. A.");
  });

  it("missing evidence is not invented: an unrecorded fact cannot be cited, and the unknowns are handed to the model as unknown", async () => {
    const observation = incorrect(); // one recorded selection: answer changes are UNKNOWN
    expect(facts(observation).some((f) => /changed your answer/.test(f))).toBe(false);
    expect(observation.unknown).toContain("interaction.answerChangeCount");
    const provider = new FixtureProvider([modelOutput({ supportingEvidence: ["You changed your answer twice before submitting."] })]);
    await expect(generateObservationHypothesis(provider, { observation })).rejects.toMatchObject({ code: "unsafe_hypothesis_output" });
  });
});

describe("unsafe, ungrounded or malformed output never becomes a hypothesis", () => {
  const reject = (overrides: Record<string, unknown>) => generateObservationHypothesis(new FixtureProvider([modelOutput(overrides)]), { observation: incorrect() });

  it.each([
    ["stated as a fact", "You misunderstood how percentage points work."],
    ["certain", "This is definitely caused by mixing up the base."],
    ["a cause with 'because you'", "The answer may be wrong because you used the wrong base."],
    ["not a possibility", "The selected answer used the wrong base in the calculation."],
    ["a private thought", "You may have thought the base was the new value."],
    ["an emotional/state claim", "You may have been unsure about the base and guessed."],
    ["a confidence claim", "This may be consistent with low confidence on percentages."],
    ["a carelessness label", "You may have been careless with the base."],
    ["an ability claim", "This may suggest a weakness in understanding percentages."],
    ["a motivation/effort claim", "You may not have put in enough effort here."],
    ["too short to be a proposal", "May be wrong"]
  ])("rejects an explanation that is %s", async (_label, explanation) => {
    await expect(reject({ proposedExplanation: explanation })).rejects.toMatchObject({ code: "unsafe_hypothesis_output" });
  });

  it("rejects supporting evidence that is not one of the given facts (an unsupported claim), and a hypothesis that cites nothing", async () => {
    await expect(reject({ supportingEvidence: ["You usually rush percentage questions."] })).rejects.toMatchObject({ code: "unsafe_hypothesis_output" });
    await expect(reject({ supportingEvidence: [facts()[0], "An invented fact about timing."] })).rejects.toMatchObject({ code: "unsafe_hypothesis_output" });
    await expect(reject({ supportingEvidence: [] })).rejects.toBeInstanceOf(AiGenerationError); // schema requires at least one
  });

  it("rejects malformed output: not JSON, empty, wrong shape -- as an AI error, never as text for the student", async () => {
    for (const raw of ["not json at all", "", "{}", JSON.stringify({ proposedExplanation: 5 }), "```json\n{}\n```"]) {
      await expect(generateObservationHypothesis(new FixtureProvider([raw, raw]), { observation: incorrect() })).rejects.toBeInstanceOf(AiGenerationError);
    }
  });

  it("a provider error or a timeout surfaces as an AI error (the caller falls back; nothing is fabricated)", async () => {
    const failing = new RecordingProvider([new Error("provider down"), new Error("provider down")]);
    await expect(generateObservationHypothesis(failing, { observation: incorrect() })).rejects.toBeInstanceOf(AiGenerationError);
    const slow: AiProvider = { name: "slow", model: "slow", complete: () => new Promise<AiCompletion>(() => {}) };
    await expect(generateObservationHypothesis(slow, { observation: incorrect() }, { timeoutMs: 20, maxRetries: 0 })).rejects.toBeInstanceOf(AiGenerationError);
  });

  it("internal missing/contradictory notes are dropped when they carry psychological wording; they never reach the student anyway", async () => {
    const h = await generateObservationHypothesis(new FixtureProvider([modelOutput({ missingEvidence: ["The student seemed unsure."], contradictoryEvidence: ["The attempt was quick."] })]), { observation: incorrect() });
    expect(h.missingEvidence).toEqual([]);
    expect(h.contradictoryEvidence).toEqual(["The attempt was quick."]);
  });

  it("validateHypothesisCandidate reports every reason it rejects for", () => {
    const verdict = validateHypothesisCandidate(
      { proposedErrorCategory: null, proposedExplanation: "You were careless and definitely misunderstood.", supportingEvidence: ["made up"], contradictoryEvidence: [], missingEvidence: [], modelConfidence: null },
      facts()
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reasons).toEqual(expect.arrayContaining(["not_phrased_as_possibility", "stated_as_certain", "psychological_or_private_claim", "unsupported_evidence"]));
  });
});

describe("nothing to explain means no AI call", () => {
  it.each([
    ["correct", buildEvidence({ isCorrect: true })],
    ["skipped", buildEvidence({ status: "skipped", skipped: true, isCorrect: null, finalAnswer: null })],
    ["abandoned", buildEvidence({ status: "abandoned", isCorrect: null, finalAnswer: null })]
  ])("a %s attempt fails closed without calling the provider", async (_label, evidence) => {
    const provider = new RecordingProvider([modelOutput()]);
    const observation = buildObservationEvidence({ evidence, question: percentagesQuestionContext });
    await expect(generateObservationHypothesis(provider, { observation })).rejects.toMatchObject({ code: "no_evidence_to_diagnose" });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("the student's response (existing confirmation semantics, applied to an observation hypothesis)", () => {
  const generate = () => generateObservationHypothesis(new FixtureProvider([modelOutput()]), { observation: incorrect() });
  const NOW = "2026-09-22T12:00:00.000Z";

  it("confirm: status confirmed, nothing else changes, the proposal is untouched", async () => {
    const h = await generate();
    const c = applyConfirmationResponse(h, { type: "confirmed" }, { now: NOW });
    expect(c).toMatchObject({ confirmationStatus: "confirmed", respondedAt: NOW, studentCorrectionText: null, proposedExplanation: h.proposedExplanation });
    expect(h.confirmationStatus).toBe("awaiting_confirmation"); // the input is never mutated
  });

  it("reject: status rejected -- never confirmed, no correction", async () => {
    const r = applyConfirmationResponse(await generate(), { type: "rejected" }, { now: NOW });
    expect(r.confirmationStatus).toBe("rejected");
    expect(r.studentCorrectionText).toBeNull();
  });

  it("correct: the student's words are preserved EXACTLY (spacing, punctuation, unicode) alongside the unchanged proposal", async () => {
    const h = await generate();
    const words = "  I used 120% as the base — not the original.  \n(second line) ✓ ";
    const c = applyConfirmationResponse(h, { type: "corrected", correctedExplanation: words }, { now: NOW });
    expect(c.confirmationStatus).toBe("corrected");
    expect(c.studentCorrectionText).toBe(words);
    expect(c.proposedExplanation).toBe(h.proposedExplanation);
  });

  it("a whitespace-only correction is refused; a second response is refused (a response applies once)", async () => {
    const h = await generate();
    expect(() => applyConfirmationResponse(h, { type: "corrected", correctedExplanation: "   " }, { now: NOW })).toThrow(HypothesisError);
    const rejected = applyConfirmationResponse(h, { type: "rejected" }, { now: NOW });
    expect(() => applyConfirmationResponse(rejected, { type: "confirmed" }, { now: NOW })).toThrowError(/already/);
  });
});
