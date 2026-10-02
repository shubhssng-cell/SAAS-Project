import { ExamPackInvalidError, ExamPackNotFoundError, InMemoryExamPackRepository, ipmatIndoreExamPack } from "@ipmat/exam-pack";
import { percentagesPatternFamilies } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { AuthoringError, ContentAuthoringService, InMemoryQuestionAuthoringRepository, proposeAiQuestion } from "../src/index.js";
import { baseDna, baseInput, ERROR_TAXONOMY_CODES, otherExamPack, REVIEW } from "./fixtures.js";

function build(packs = [ipmatIndoreExamPack, otherExamPack()]) {
  const questions = new InMemoryQuestionAuthoringRepository();
  const service = new ContentAuthoringService({
    questions,
    packs: new InMemoryExamPackRepository(packs),
    patternFamiliesFor: (code) => (code === "IPMAT_INDORE" ? percentagesPatternFamilies : []),
    errorTaxonomyCodes: ERROR_TAXONOMY_CODES
  });
  return { questions, service };
}

describe("ContentAuthoringService - the whole path, through repositories", () => {
  it("draft -> validate -> review -> publish for a hard-tier question; each step persisted", async () => {
    const { service, questions } = build();
    const { id } = await service.createDraft(baseInput("h1", { dna: baseDna({ difficultyTier: "hard" }) }));
    expect((await questions.findById(id))!.validationState).toBe("draft");
    expect((await service.validate(id)).advanced).toBe(true);
    await expect(service.publish(id)).rejects.toBeInstanceOf(AuthoringError); // needs human review
    expect((await questions.findById(id))!.validationState).toBe("ai_validated"); // a blocked publish changes nothing
    await service.review(id, REVIEW, "approve");
    expect((await service.publish(id)).validationState).toBe("published");
    expect((await questions.findById(id))!.review?.reviewedBy).toBe("fixture-reviewer");
  });

  it("a failed validation stores no advance and explains itself", async () => {
    const { service, questions } = build();
    const input = baseInput("bad");
    input.content.correctAnswer = "999";
    const { id } = await service.createDraft(input);
    const outcome = await service.validate(id);
    expect(outcome.advanced).toBe(false);
    expect(outcome.report.failed).toContain("structure");
    expect((await questions.findById(id))!.validationState).toBe("draft");
  });

  it("an AI proposal sits as a draft; it needs an independent check before it can be validated clean, and an explicit publish", async () => {
    const { service, questions } = build();
    const ai = proposeAiQuestion({ ...baseInput("ai"), source: { sourceType: "original", sourceRef: "ai-generation:run-9", licenseRef: null, attributedTo: null } });
    const { id } = await questions.createDraft(ai);
    expect((await questions.findById(id))!.origin).toBe("ai_generated");
    const first = await service.validate(id);
    expect(first.report.requiresHuman).toContain("answer");
    await expect(service.publish(id)).rejects.toBeInstanceOf(AuthoringError);
    expect((await questions.findById(id))!.validationState).not.toBe("published");
  });

  it("editing goes back to draft and keeps the identity; the duplicate check sees the stored pool", async () => {
    const { service, questions } = build();
    const { id } = await service.createDraft(baseInput("e1"));
    await service.validate(id);
    const edited = await service.edit(id, { content: { ...(await questions.findById(id))!.content, solutionSteps: ["Edited."] } });
    expect(edited).toMatchObject({ id: "e1", validationState: "draft" });
    // an exact twin is not created
    expect((await service.createDraft(baseInput("twin"))).id).toBe("e1");
  });

  it("near-duplicates are surfaced for a human, never merged", async () => {
    const { service } = build();
    await service.createDraft(baseInput("a"));
    const near = baseInput("b");
    near.content.body = near.content.body.replace("8,000", "9,000");
    const { id } = await service.createDraft(near);
    expect(id).toBe("b");
    const report = await service.gateReport("b");
    expect(report.requiresHuman).toContain("identity");
  });

  it("reject is terminal", async () => {
    const { service } = build();
    const { id } = await service.createDraft(baseInput("r"));
    await service.reject(id);
    await expect(service.validate(id)).rejects.toBeInstanceOf(AuthoringError);
    await expect(service.publish(id)).rejects.toBeInstanceOf(AuthoringError);
  });

  it("an unknown exam is a typed pack-not-found error; an invalid pack fails closed", async () => {
    const { service, questions } = build();
    const q = baseInput("x", { dna: baseDna({ examCode: "NO_EXAM" }) });
    await questions.createDraft({ ...proposeAiQuestion(q), origin: "human_authored" });
    await expect(service.validate("x")).rejects.toBeInstanceOf(ExamPackNotFoundError);
    const broken = otherExamPack();
    broken.relations.push({ from: "percentages", to: "ghost", type: "prerequisite", rationale: "r", sharedKnowledge: "s", usefulForQuestionGeneration: true, requirementLevel: "required", certainty: "probable", source: "human", provenance: broken.provenance });
    const b = build([ipmatIndoreExamPack, broken]);
    await b.questions.createDraft({ ...proposeAiQuestion(baseInput("y", { dna: baseDna({ examCode: "OTHER_EXAM" }) })), origin: "human_authored" });
    await expect(b.service.validate("y")).rejects.toBeInstanceOf(ExamPackInvalidError);
  });
});

describe("cross-exam contamination", () => {
  it("IPMAT DNA labelled as another exam fails validation against that exam's pack", async () => {
    const { service, questions } = build();
    await questions.createDraft({ ...proposeAiQuestion(baseInput("c1", { dna: baseDna({ examCode: "OTHER_EXAM" }) })), origin: "human_authored" });
    const outcome = await service.validate("c1");
    expect(outcome.advanced).toBe(false);
    expect(outcome.report.failed.length).toBeGreaterThan(0);
  });

  it("the universe and identity pool of one exam never include another exam's questions", async () => {
    const { service, questions } = build();
    await service.createDraft(baseInput("ipmat-q"));
    await questions.mutate("ipmat-q", (q) => ({ ...q, validationState: "published" }));
    const foreign = baseInput("other-q", { dna: baseDna({ examCode: "OTHER_EXAM" }) });
    await questions.createDraft({ ...proposeAiQuestion(foreign), origin: "human_authored" });
    await questions.mutate("other-q", (q) => ({ ...q, validationState: "published" }));
    expect((await service.conceptUniverse("IPMAT_INDORE", "Percentages")).totals.published).toBe(1);
    expect((await service.conceptUniverse("OTHER_EXAM", "Percentages")).totals.published).toBe(1);
    expect((await questions.listIdentityRefs("OTHER_EXAM")).map((r) => r.id)).toEqual(["other-q"]);
    expect((await service.examUniverse("IPMAT_INDORE")).every((u) => u.examCode === "IPMAT_INDORE")).toBe(true);
  });

  it("the same wording in two exams is two questions (identity is exam-scoped)", async () => {
    const { service } = build();
    const a = await service.createDraft(baseInput("a"));
    const b = await service.createDraft(baseInput("b", { dna: baseDna({ examCode: "OTHER_EXAM" }) }));
    expect(a.alreadyExisted).toBe(false);
    expect(b.alreadyExisted).toBe(false);
  });
});
