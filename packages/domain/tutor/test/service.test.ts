import { describe, expect, it } from "vitest";
import { EvidenceRetriever, InMemoryContentIntelligenceRepository, LexicalRetrievalIndex } from "@ipmat/content-intelligence";
import { TUTOR_SERVICE_LIMITS, TutorError, createEvidenceRetrieverSourcePort, toStudentTutorView } from "../src/index.js";
import { contractParts, modelFor, ENROLL_A, ENROLL_B, EXAM, KEY, OTHER_EXAM, QUESTION_ID, STUDENT_A, STUDENT_B, build, modelJson, request, world } from "./fixtures.js";

const mistakeAnswer = modelJson({
  responseType: "mistake_explanation",
  text: "Your submitted answer was ₹480, while the keyed answer is ₹500. A 20 percent discount multiplies the marked price by 0.8.",
  citations: ["attempt", "answer_key"],
  parts: contractParts("explain_mistake", true),
  hypotheses: [{ text: "It looks like you may have subtracted 20 from 625. Is that what you did?", evidenceRefs: ["attempt"] }]
});
const leaking = modelJson({ responseType: "hint", text: `The correct answer is ${KEY}.`, citations: ["question"] });
const goodHint = modelJson({ responseType: "hint", text: "Think about what multiplier a 20 percent decrease gives.", citations: ["question"] });

describe("service: a grounded answer", () => {
  it("returns an answered response with separated epistemic classes, resolved references and an audit entry", async () => {
    const { service, audits } = build([mistakeAnswer]);
    const r = await service.answer(request());
    expect(r.outcome).toBe("answered");
    expect(r.responseType).toBe("mistake_explanation");
    expect(r.text).toContain("₹480");
    expect(r.hypotheses).toEqual([{ epistemic: "AI_HYPOTHESIS", text: expect.stringContaining("may have"), evidenceRefs: ["attempt"] }]);
    expect(r.evidenceReferences.map((e) => [e.ref, e.epistemic])).toEqual([["attempt", "OBSERVED_DATA"], ["answer_key", "SOURCE_CONTENT"]]);
    expect(r.grounding.passed).toBe(true);
    expect(r.grounding.checksRun.length).toBeGreaterThan(5);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: "answered", intent: "explain_mistake", examCode: EXAM, generationAttempts: 1, model: { provider: "scripted", model: "scripted-v1", promptVersion: "tutor-response-v2" } });
  });
  it("audit records metadata only: no prompt, no question text, no response text, no student free text", async () => {
    const { service, audits } = build([mistakeAnswer]);
    await service.answer(request({ focus: "MY-PRIVATE-NOTE" }));
    const dump = JSON.stringify(audits);
    for (const forbidden of ["625 rupees", "keyed answer", "MY-PRIVATE-NOTE", "625 - 20", "multiplies the marked price"]) expect(dump).not.toContain(forbidden);
    expect(audits[0]!.contextDigest).toMatch(/^[0-9a-f]{64}$/);
  });
  it("an audit sink that throws changes nothing for the student", async () => {
    const { service } = build([mistakeAnswer], { service: { audit: { record: () => { throw new Error("sink down"); } } } });
    expect((await service.answer(request())).outcome).toBe("answered");
  });
});

describe("service: insufficient context and the firewall make no model call", () => {
  it("no submitted attempt for a mistake explanation -> insufficient_context, zero provider calls, fixed text", async () => {
    const { service, provider, audits } = build([], { world: world({ attempts: [] }) });
    const r = await service.answer(request());
    expect(r.outcome).toBe("insufficient_context");
    expect(r.text).toBeNull();
    expect(r.fallbackMessage).toBeTruthy();
    expect(r.uncertainty).toEqual({ insufficientContext: true, missing: ["submitted_attempt"] });
    expect(provider.prompts).toHaveLength(0);
    expect(audits[0]!.outcome).toBe("insufficient_context");
  });
  it("a model that itself reports insufficient_context is an insufficient_context outcome, with what is missing", async () => {
    const { service } = build([modelJson({ responseType: "insufficient_context", text: "I can't ground a hint here.", citations: [], missingContext: ["expected approach"] })], { world: world() });
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("insufficient_context");
    expect(r.uncertainty.missing).toEqual(["expected approach"]);
  });
  it.each([
    ["another student's enrollment", { enrollmentId: ENROLL_B }, "ownership_denied"],
    ["another student asking with their own enrollment for A's attempt", { studentId: STUDENT_B, enrollmentId: ENROLL_B, intent: "give_hint" as const }, null],
    ["a question outside the exam", { questionId: "question-other-1" }, "question_unavailable"]
  ])("%s", async (_n, over, expected) => {
    const { service, provider } = build([goodHint]);
    if (expected === null) {
      const r = await service.answer(request(over));
      expect(JSON.stringify(r)).not.toContain("₹480");
      return;
    }
    await expect(service.answer(request(over))).rejects.toMatchObject({ code: expected });
    await expect(service.answer(request(over))).rejects.toBeInstanceOf(TutorError);
    expect(provider.prompts).toHaveLength(0);
  });
});

describe("service: grounding drives regeneration and rejection", () => {
  it("a leaking hint is regenerated once; the second prompt names the violation but NEVER repeats the rejected text", async () => {
    const { service, provider, audits } = build([leaking, goodHint]);
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("answered");
    expect(r.text).not.toContain(KEY);
    expect(provider.prompts).toHaveLength(2);
    expect(provider.prompts[1]!.userPrompt).toContain("answer_key_leakage");
    expect(provider.prompts[1]!.userPrompt).not.toContain("The correct answer is");
    expect(audits[0]!.generationAttempts).toBe(2);
  });
  it("persistent leakage ends as rejected_ungrounded: NO model text is returned anywhere", async () => {
    const { service, audits } = build([leaking, leaking]);
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("rejected_ungrounded");
    expect(r.text).toBeNull();
    expect(r.fallbackMessage).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain("The correct answer is");
    expect(r.grounding.violations.map((v) => v.code)).toContain("answer_key_leakage");
    expect(audits[0]).toMatchObject({ outcome: "rejected_ungrounded", violationCodes: ["answer_key_leakage"], generationAttempts: 2 });
  });
  it("regeneration is bounded: the cap is 2 even if more is requested", async () => {
    const { service, provider } = build([leaking, leaking, leaking, leaking], { service: { groundingRetries: 99 } });
    await service.answer(request({ intent: "give_hint" }));
    expect(provider.prompts).toHaveLength(TUTOR_SERVICE_LIMITS.MAX_GROUNDING_RETRIES + 1);
  });
  it("zero retries means one call", async () => {
    const { service, provider } = build([leaking], { service: { groundingRetries: 0 } });
    expect((await service.answer(request({ intent: "give_hint" }))).outcome).toBe("rejected_ungrounded");
    expect(provider.prompts).toHaveLength(1);
  });
  it("a cross-exam mention is rejected when the other exams' names are supplied", async () => {
    const bad = modelJson({ responseType: "explanation", text: `In ${OTHER_EXAM} this is graded differently.`, citations: ["question"] });
    const { service } = build([bad, bad], { service: { listOtherExamTerms: () => [OTHER_EXAM, EXAM] } });
    const r = await service.answer(request({ intent: "explain_question" }));
    expect(r.outcome).toBe("rejected_ungrounded");
    expect(r.grounding.violations.map((v) => v.code)).toContain("cross_exam_content");
  });
});

describe("provider failures are isolated and classified", () => {
  it("timeout", async () => {
    const { service, audits } = build([{ hangMs: 1000 }]);
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("provider_failure");
    expect(audits[0]!.failure).toBe("timeout");
    expect(r.text).toBeNull();
  });
  it("provider error", async () => {
    const { service, audits } = build([{ throws: new Error("503 upstream") }]);
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("provider_failure");
    expect(audits[0]!.failure).toBe("provider_error");
    expect(JSON.stringify(r)).not.toContain("503 upstream");
  });
  it.each([["not json at all"], [JSON.stringify({ responseType: "explanation" })], [JSON.stringify({ responseType: "made_up", text: "x" })], [JSON.stringify({ responseType: "hint", text: "" })]])("malformed output %#", async (raw) => {
    const { service, audits } = build([raw]);
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("provider_failure");
    expect(audits[0]!.failure).toBe("malformed_output");
    expect(r.text).toBeNull();
  });
  it("malformed output is retried by the shared generateStructured policy and can then succeed", async () => {
    const { service, provider } = build(["garbage", goodHint], { service: { aiOptions: { maxRetries: 1, timeoutMs: 500 } } });
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("answered");
    expect(provider.prompts).toHaveLength(2);
  });
  it("no provider failure ever leaks provider internals or secrets into the response", async () => {
    const { service } = build([{ throws: new Error("401 invalid x-api-key sk-ant-SECRET") }]);
    expect(JSON.stringify(await service.answer(request({ intent: "give_hint" })))).not.toContain("sk-ant-SECRET");
  });
});

describe("no chain-of-thought is stored or exposed", () => {
  it("extra reasoning fields from a model are stripped by the schema and appear nowhere", async () => {
    const raw = JSON.stringify({ ...JSON.parse(goodHint), reasoning: "SECRET-REASONING", chainOfThought: "SECRET-COT", thinking: "SECRET-THINK" });
    const { service, audits } = build([raw]);
    const r = await service.answer(request({ intent: "give_hint" }));
    expect(r.outcome).toBe("answered");
    const dump = JSON.stringify({ r, audits, view: toStudentTutorView(r) });
    for (const s of ["SECRET-REASONING", "SECRET-COT", "SECRET-THINK"]) expect(dump).not.toContain(s);
  });
  it("the instruction and the schema both ask for conclusions only", async () => {
    const { service, provider } = build([goodHint]);
    await service.answer(request({ intent: "give_hint" }));
    expect(provider.prompts[0]!.systemPrompt).toContain("no reasoning steps");
  });
});

describe("source retrieval reuses the Phase 6 abstraction and respects its rights boundary", () => {
  const concept = request({ intent: "explain_concept", conceptName: "Percentages", questionId: undefined });
  const conceptAnswer = modelFor("explain_concept", { text: "A percentage is a ratio expressed per hundred." });

  it("a STUDENT principal is denied by the real EvidenceRetriever: the tutor proceeds on structured context only and records the denial", async () => {
    const retriever = new EvidenceRetriever(new InMemoryContentIntelligenceRepository(), new LexicalRetrievalIndex());
    const sources = createEvidenceRetrieverSourcePort(retriever, { role: "student", examCodes: [EXAM] });
    const { service, audits, provider } = build([conceptAnswer], { service: { sources } });
    const r = await service.answer(concept);
    expect(r.outcome).toBe("answered");
    expect(r.sourceReferences).toEqual([]);
    expect(audits[0]!.withheldSections.join()).toContain("sources(access denied");
    expect(provider.prompts[0]!.userPrompt).not.toContain("SOURCE");
  });
  it("an authorized principal's retrieved chunk keeps provenance and is cited as SOURCE_CONTENT, distinct from the generated explanation", async () => {
    const fake = {
      retrieve: async () => [{ chunkId: "chk_internal_1", score: 1, matchedBy: "lexical", text: "A percentage is a number per hundred.", location: { lineStart: 3, lineEnd: 4, charStart: 0, charEnd: 10, page: null, headingPath: ["Notes", "Percentages"] }, source: { sourceKey: "internal-key", title: "Synthetic notes", version: 2 } }]
    } as unknown as EvidenceRetriever;
    const sources = createEvidenceRetrieverSourcePort(fake, { role: "content_reviewer", examCodes: [EXAM] });
    const cited = modelFor("explain_concept", { text: "A percentage is a number per hundred.", citations: ["concept:Percentages", "source:1"] });
    const { service, provider } = build([cited], { service: { sources } });
    const r = await service.answer(concept);
    expect(r.outcome).toBe("answered");
    expect(r.sourceReferences).toEqual([{ ref: "source:1", chunkId: "chk_internal_1", title: "Synthetic notes", location: "Notes > Percentages", version: 2, epistemic: "SOURCE_CONTENT" }]);
    expect(provider.prompts[0]!.userPrompt).toContain("A percentage is a number per hundred.");
    expect(provider.prompts[0]!.userPrompt).not.toContain("chk_internal_1");
    expect(provider.prompts[0]!.userPrompt).not.toContain("internal-key");
    const view = JSON.stringify(toStudentTutorView(r));
    expect(view).toContain("Synthetic notes");
    for (const hidden of ["chk_internal_1", "internal-key"]) expect(view).not.toContain(hidden);
  });
  it("a citation of a source that was never retrieved is a fabricated citation and is rejected", async () => {
    const fabricated = modelJson({ responseType: "concept_explanation", text: "According to the official notes, percentages are important.", citations: ["concept:Percentages", "source:1"] });
    const { service } = build([fabricated, fabricated]);
    const r = await service.answer(concept);
    expect(r.outcome).toBe("rejected_ungrounded");
    expect(r.grounding.violations.map((v) => v.code)).toContain("unknown_reference");
  });
});

describe("the student view exposes only student-safe fields", () => {
  it("contains no ids, digests, model metadata, chunk ids, grounding internals or violation codes", async () => {
    const { service } = build([mistakeAnswer]);
    const r = await service.answer(request());
    const view = toStudentTutorView(r);
    const json = JSON.stringify(view);
    for (const hidden of [STUDENT_A, ENROLL_A, QUESTION_ID, "req-1", "scripted", "contextDigest", "checksRun", "violations", "audit", "includedSections"]) expect(json).not.toContain(hidden);
    expect(Object.keys(view).sort()).toEqual(["basedOn", "hypotheses", "message", "missing", "mode", "outcome", "parts", "question", "sources"]);
    expect(view.hypotheses[0]!.label).toBe("AI hypothesis");
  });
  it("non-answered outcomes show only the fixed message", async () => {
    const { service } = build([leaking, leaking]);
    const view = toStudentTutorView(await service.answer(request({ intent: "give_hint" })));
    expect(view.outcome).toBe("rejected_ungrounded");
    expect(view.message).not.toContain(KEY);
    expect(view.message.length).toBeGreaterThan(0);
  });
});

describe("intent contracts (policy, not a finished tutoring product)", () => {
  it.each([
    ["give_hint", "hint"],
    ["guide_with_question", "guided_question"],
    ["explain_question", "explanation"],
    ["explain_concept", "concept_explanation"],
    ["explain_mistake", "mistake_explanation"],
    ["clarify_solution", "solution_clarification"]
  ] as const)("%s answers with responseType %s", async (intent, type) => {
    const raw = intent === "explain_mistake" ? mistakeAnswer : modelFor(intent);
    const { service } = build([raw]);
    const r = await service.answer(request({ intent, conceptName: "Percentages" }));
    expect(r.grounding.violations).toEqual([]);
    expect(r.outcome).toBe("answered");
    expect(r.responseType).toBe(type);
  });
});
