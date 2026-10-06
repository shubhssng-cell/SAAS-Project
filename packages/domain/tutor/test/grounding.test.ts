import { describe, expect, it } from "vitest";
import { tutorResponseAiSchema, type TutorResponseAiOutput } from "@ipmat/ai";
import { buildTutorContext, validateTutorGrounding, type GroundingViolationCode, type TutorRequest } from "../src/index.js";
import { contractParts, CELL_ID, ENROLL_A, EXAM, KEY, OTHER_EXAM, QUESTION_ID, STEP_1, STUDENT_A, TRAP_CODE, modelJson, ports, request, world, type World } from "./fixtures.js";

async function run(req: TutorRequest, over: Record<string, unknown>, w: World = world()) {
  const built = await buildTutorContext(ports(w), req);
  if (built.kind !== "context") throw new Error("expected context");
  // Contract-complete parts by default so each test isolates the ONE defect it names; pass `parts: undefined`-free overrides to test the contract itself.
  const merged = { ...("parts" in over ? {} : { parts: contractParts(req.intent, built.context.answerKey !== null) }), ...over };
  const output: TutorResponseAiOutput = tutorResponseAiSchema.parse(JSON.parse(modelJson(merged)));
  return validateTutorGrounding(built.context, output, { protectedKey: built.protectedKey, internalTokens: built.internalTokens, foreignExamTerms: [OTHER_EXAM, "CAT"] });
}
const codes = (r: { violations: Array<{ code: GroundingViolationCode }> }) => r.violations.map((v) => v.code);

const mistake = request();
const hint = request({ intent: "give_hint" });

describe("grounding: supported responses", () => {
  it("accepts a grounded mistake explanation using only observable facts, with a separate hedged hypothesis", async () => {
    const r = await run(mistake, {
      responseType: "mistake_explanation",
      text: "Your submitted answer was ₹480, while the keyed answer is ₹500. The discount applies to the marked price as a multiplier.",
      citations: ["attempt", "answer_key", "question"],
      hypotheses: [{ text: "It looks like you may have subtracted 20 from 625 directly. Is that what you did?", evidenceRefs: ["attempt"] }],
      questionQuotes: ["625 - 20 = 605"]
    });
    expect(codes(r)).toEqual([]);
    expect(r.passed).toBe(true);
  });
  it("accepts an explicit insufficient_context answer without citations", async () => {
    const r = await run(hint, { responseType: "insufficient_context", text: "I don't have enough information to give a useful hint.", citations: [], missingContext: ["the question's expected approach"] });
    expect(codes(r)).toEqual([]);
  });
  it("accepts a graph relation that really is in the supplied graph, and rejects one that is not", async () => {
    const concept = request({ intent: "explain_concept", conceptName: "Percentages", questionId: undefined });
    const base = { responseType: "concept_explanation", text: "Ratio comes before Percentages.", citations: ["concept:Percentages"] };
    expect(codes(await run(concept, { ...base, relationClaims: [{ from: "Ratio", to: "Percentages", type: "prerequisite" }] }))).toEqual([]);
    expect(codes(await run(concept, { ...base, relationClaims: [{ from: "Percentages", to: "Ratio", type: "prerequisite" }] }))).toContain("unsupported_relation"); // wrong direction
    expect(codes(await run(concept, { ...base, relationClaims: [{ from: "Percentages", to: "Geometry", type: "application" }] }))).toContain("unsupported_relation"); // invented
  });
});

describe("grounding: references and citations", () => {
  it("an answered response must cite something", async () => {
    expect(codes(await run(mistake, { responseType: "mistake_explanation", citations: [] }))).toContain("missing_citation");
  });
  it("a fabricated citation is rejected", async () => {
    const r = await run(mistake, { responseType: "mistake_explanation", citations: ["source:99", "attempt"] });
    expect(codes(r)).toContain("unknown_reference");
  });
  it("a quotation that is not verbatim in the supplied context is rejected", async () => {
    expect(codes(await run(mistake, { responseType: "mistake_explanation", citations: ["attempt"], questionQuotes: ["the student said they divided by 4"] }))).toContain("unverifiable_quote");
  });
  it("a response type outside the intent's contract is rejected", async () => {
    expect(codes(await run(mistake, { responseType: "hint" }))).toContain("disallowed_response_type");
    expect(codes(await run(hint, { responseType: "explanation" }))).toContain("disallowed_response_type");
  });
});

describe("grounding: invented exam rules", () => {
  const concept = request({ intent: "explain_concept", conceptName: "Percentages", questionId: undefined });
  const body = { responseType: "concept_explanation", citations: ["concept:Percentages"] };
  it.each([
    "The IPMAT has negative marking of one mark for each wrong answer.",
    "Each section has a time limit of 40 minutes.",
    "The exam consists of three sections.",
    "The cut-off for last year was high."
  ])("rejects %s when no source states it", async (text) => {
    expect(codes(await run(concept, { ...body, text }))).toContain("invented_exam_rule");
  });
  it("accepts an exam-rule statement ONLY when retrieved source text states the same kind of rule", async () => {
    const w = world({ sources: [{ chunkId: "c1", examCode: EXAM, text: "The paper applies negative marking for incorrect answers.", location: "Rules", source: { sourceKey: "k", title: "Rules sheet", version: 1 } }] });
    const r = await run(concept, { ...body, text: "Negative marking applies to wrong answers.", citations: ["concept:Percentages", "source:1"] }, w);
    expect(codes(r)).not.toContain("invented_exam_rule");
    expect(codes(await run(concept, { ...body, text: "The exam consists of three sections." }, w))).toContain("invented_exam_rule"); // a different rule is still unsupported
  });
});

describe("grounding: psychological inference", () => {
  it.each([
    "You are weak at algebra.",
    "You lack confidence in this topic.",
    "You panic under pressure.",
    "You don't understand percentages.",
    "You always make this mistake.",
    "You seem anxious about timed questions.",
    "Your problem is carelessness.",
    "You are bad at word problems."
  ])("rejects: %s", async (text) => {
    expect(codes(await run(mistake, { responseType: "mistake_explanation", text, citations: ["attempt"] }))).toContain("psychological_claim");
  });
  it("also checks the hypothesis text, not only the main text", async () => {
    const r = await run(mistake, { responseType: "mistake_explanation", citations: ["attempt"], hypotheses: [{ text: "You may be nervous and lack confidence?", evidenceRefs: ["attempt"] }] });
    expect(codes(r)).toContain("psychological_claim");
  });
  it("allows observable facts", async () => {
    const r = await run(mistake, { responseType: "mistake_explanation", text: "Your working shows 625 - 20 = 605. A 20 percent discount multiplies the price by 0.8.", citations: ["attempt"] });
    expect(codes(r)).toEqual([]);
  });
});

describe("grounding: unsupported mastery / readiness claims", () => {
  it.each([
    "You have mastered percentages.",
    "You are ready for the exam.",
    "Your readiness is high.",
    "You will score well in the IPMAT.",
    "You are on track for selection.",
    "Percentages is a strength of yours.",
    "There is a high probability you will clear the cut-off."
  ])("rejects: %s", async (text) => {
    expect(codes(await run(mistake, { responseType: "mistake_explanation", text, citations: ["attempt"] }))).toContain("unsupported_mastery_readiness_claim");
  });
});

describe("grounding: answer-key leakage", () => {
  const h = (text: string) => run(hint, { responseType: "hint", text, citations: ["question"] });
  it.each([
    `The correct answer is ${KEY}.`,
    `Compute it and you get ${KEY}.`,
    `So the result is ${KEY}`,
    `Choose ${KEY}.`
  ])("a hint that asserts the key is rejected: %s", async (text) => {
    expect(codes(await h(text))).toContain("answer_key_leakage");
  });
  it("a hint that reproduces an authored solution step is rejected", async () => {
    expect(codes(await h(STEP_1))).toContain("solution_leakage");
  });
  it("a legitimate hint passes (it may mention the option values without asserting one)", async () => {
    expect(codes(await h("Think about what multiplier a 20 percent decrease corresponds to, then compare with the options."))).toEqual([]);
    expect(codes(await h("Both ₹480 and ₹520 are close; check which one you get from the marked price."))).toEqual([]);
  });
  it("a letter-style key asserted in a hint is also caught", async () => {
    const w = world({ questions: [{ ...world().questions[0]!, correctAnswer: "C" }] });
    expect(codes(await run(hint, { responseType: "hint", text: "The answer is option C.", citations: ["question"] }, w))).toContain("answer_key_leakage");
  });
  it("once the policy authorizes the key (explain_mistake after a finalized attempt) stating it is not leakage", async () => {
    const r = await run(mistake, { responseType: "mistake_explanation", text: `The keyed answer is ${KEY}.`, citations: ["answer_key"] });
    expect(codes(r)).not.toContain("answer_key_leakage");
  });
  it("explain_question before any attempt is also protected", async () => {
    const r = await run(request({ intent: "explain_question" }), { responseType: "explanation", text: `The correct answer is ${KEY}.`, citations: ["question"] }, world({ attempts: [] }));
    expect(codes(r)).toContain("answer_key_leakage");
  });
});

describe("grounding: internal identifiers and cross-exam content", () => {
  const text = (t: string) => run(mistake, { responseType: "mistake_explanation", text: t, citations: ["attempt"] });
  it.each([
    ["a student id", `Student ${STUDENT_A} did this.`],
    ["an enrollment id", `Enrollment ${ENROLL_A}.`],
    ["any uuid", "Reference 99999999-9999-4999-8999-999999999999 applies."],
    ["a question id", `See ${QUESTION_ID} for details.`],
    ["an internal trap code", `The designed trap ${TRAP_CODE} applies.`],
    ["a taxonomy cell id", `Cell ${CELL_ID}.`]
  ])("rejects %s", async (_n, t) => {
    expect(codes(await text(t))).toContain("internal_identifier_leakage");
  });
  it("rejects a mention of another exam by name or code (whole word)", async () => {
    expect(codes(await text(`In ${OTHER_EXAM} this works differently.`))).toContain("cross_exam_content");
    expect(codes(await text("This is a typical CAT style trap."))).toContain("cross_exam_content");
    expect(codes(await text("Catalog prices differ."))).not.toContain("cross_exam_content"); // no substring matching
  });
  it("lists the cross-exam check as run only when the other exams' names were supplied", async () => {
    const built = await buildTutorContext(ports(), mistake);
    if (built.kind !== "context") throw new Error("ctx");
    const out = tutorResponseAiSchema.parse(JSON.parse(modelJson({ responseType: "mistake_explanation", citations: ["attempt"] })));
    expect(validateTutorGrounding(built.context, out, { protectedKey: built.protectedKey }).checksRun).not.toContain("cross_exam_content");
    expect(validateTutorGrounding(built.context, out, { protectedKey: built.protectedKey, foreignExamTerms: ["X"] }).checksRun).toContain("cross_exam_content");
  });
});

describe("grounding: attempt facts and hypotheses", () => {
  const t = (text: string) => run(mistake, { responseType: "mistake_explanation", text, citations: ["attempt"] });
  it("correct statements about the submitted answer pass; a misreported one fails", async () => {
    expect(codes(await t("You submitted ₹480, which is not the keyed answer."))).toEqual([]);
    expect(codes(await t("You submitted ₹450 and that was wrong."))).toContain("misreported_attempt");
    expect(codes(await t("Your answer was correct."))).toContain("misreported_attempt");
  });
  it("a hypothesis must be hedged and tied to attempt evidence; assertive diagnoses fail", async () => {
    const base = { responseType: "mistake_explanation", citations: ["attempt"] };
    expect(codes(await run(mistake, { ...base, hypotheses: [{ text: "You subtracted 20 instead of taking 20 percent.", evidenceRefs: ["attempt"] }] }))).toContain("unhedged_hypothesis");
    expect(codes(await run(mistake, { ...base, hypotheses: [{ text: "You may have subtracted 20 instead of taking 20 percent.", evidenceRefs: ["question"] }] }))).toContain("unknown_reference");
    expect(codes(await run(mistake, { ...base, hypotheses: [{ text: "You may have subtracted 20 instead of taking 20 percent.", evidenceRefs: ["attempt"] }] }))).toEqual([]);
  });
  it("hypotheses are not permitted for intents whose contract does not allow them", async () => {
    const r = await run(hint, { responseType: "hint", citations: ["question"], hypotheses: [{ text: "You may have rushed?", evidenceRefs: ["attempt"] }] });
    expect(codes(r)).toContain("hypothesis_not_permitted");
  });
});
