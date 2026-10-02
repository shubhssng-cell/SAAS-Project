import { describe, expect, it } from "vitest";
import {
  AuthoringError,
  createDraft,
  editQuestion,
  proposeAiQuestion,
  publishQuestion,
  recordHumanReview,
  rejectQuestion,
  runAutomatedValidation,
  type AuthoredQuestion
} from "../src/index.js";
import { baseDna, baseInput, ctx, REVIEW } from "./fixtures.js";

const draft = (id = "q-1", over: Parameters<typeof baseInput>[1] = {}) => createDraft(baseInput(id, over));
const aiSource = { sourceType: "original" as const, sourceRef: "ai-generation:run-1", licenseRef: null, attributedTo: null };

describe("draft creation", () => {
  it("creates a DRAFT with nothing established: no review, no verification, state draft", () => {
    const q = draft();
    expect(q.validationState).toBe("draft");
    expect(q.review).toBeNull();
    expect(q.independentReverification).toBeNull();
    expect(q.origin).toBe("human_authored");
  });
  it("copies its input: later mutation of the input does not change the question", () => {
    const input = baseInput("q");
    const q = createDraft(input);
    input.content.body = "tampered";
    input.dna.skill = "tampered";
    expect(q.content.body).not.toBe("tampered");
    expect(q.dna.skill).not.toBe("tampered");
  });
  it("an AI proposal is a draft with origin ai_generated - never anything more", () => {
    const q = proposeAiQuestion({ ...baseInput("ai-1"), source: aiSource });
    expect(q.origin).toBe("ai_generated");
    expect(q.validationState).toBe("draft");
  });
});

describe("automated validation: draft -> ai_validated", () => {
  it("advances a clean draft and reports every gate", () => {
    const out = runAutomatedValidation(draft(), ctx());
    expect(out.advanced).toBe(true);
    expect(out.question.validationState).toBe("ai_validated");
    expect(out.report.gates).toHaveLength(11);
  });
  it("a failed gate leaves the question a draft with explicit, machine-readable reasons", () => {
    const q = draft("q", { content: { ...baseInput("q").content, correctAnswer: "999" } });
    const out = runAutomatedValidation(q, ctx());
    expect(out.advanced).toBe(false);
    expect(out.question.validationState).toBe("draft");
    expect(out.report.failed).toContain("structure");
    expect(out.report.gates.find((g) => g.gate === "structure")!.reasons[0]!.code).toBe("multiple_or_no_correct_answer");
  });
  it("open human gates do NOT block this step, but do block publication", () => {
    const q = draft("q", { content: { ...baseInput("q").content, groundTruthDerivation: null } });
    const out = runAutomatedValidation(q, ctx());
    expect(out.advanced).toBe(true);
    expect(out.report.requiresHuman).toEqual(["answer"]);
    expect(() => publishQuestion(out.question, ctx())).toThrow(AuthoringError);
  });
  it("only drafts are validated", () => {
    const v = runAutomatedValidation(draft(), ctx()).question;
    expect(() => runAutomatedValidation(v, ctx())).toThrow(AuthoringError);
  });
});

describe("editing invalidates", () => {
  it("returns an ai_validated question to draft, drops its review, and keeps its id", () => {
    const validated = runAutomatedValidation(draft("stable"), ctx()).question;
    const reviewed = recordHumanReview(validated, REVIEW, "approve", ctx()).question;
    expect(reviewed.validationState).toBe("human_reviewed");
    const edited = editQuestion(reviewed, { content: { ...reviewed.content, solutionSteps: ["Changed step."] } });
    expect(edited.validationState).toBe("draft");
    expect(edited.review).toBeNull();
    expect(edited.id).toBe("stable");
  });
  it("an edit that breaks the question is caught by the next validation", () => {
    const validated = runAutomatedValidation(draft(), ctx()).question;
    const broken = editQuestion(validated, { dna: baseDna({ conceptName: "Nope" }) });
    expect(runAutomatedValidation(broken, ctx()).report.failed).toContain("concept");
  });
  it("a published or rejected question cannot be edited", () => {
    const published = publishQuestion(runAutomatedValidation(draft(), ctx()).question, ctx());
    expect(() => editQuestion(published, { content: published.content })).toThrow(AuthoringError);
    expect(() => editQuestion(rejectQuestion(draft()), {})).toThrow(AuthoringError);
  });
  it("does not mutate its input", () => {
    const q = draft();
    const snapshot = JSON.stringify(q);
    editQuestion(q, { content: { ...q.content, body: "A different but long enough body for the question." } });
    expect(JSON.stringify(q)).toBe(snapshot);
  });
});

describe("human review", () => {
  it("only an ai_validated question can be reviewed", () => {
    expect(() => recordHumanReview(draft(), REVIEW, "approve", ctx())).toThrow(AuthoringError);
  });
  it("approve -> human_reviewed with the review stored; reject -> rejected (terminal)", () => {
    const v = runAutomatedValidation(draft(), ctx()).question;
    const approved = recordHumanReview(v, REVIEW, "approve", ctx()).question;
    expect(approved.validationState).toBe("human_reviewed");
    expect(approved.review?.reviewedBy).toBe("fixture-reviewer");
    const rejected = recordHumanReview(v, REVIEW, "reject", ctx()).question;
    expect(rejected.validationState).toBe("rejected");
    expect(() => rejectQuestion(rejected)).toThrow(AuthoringError);
  });
  it("a reviewer cannot approve past a failed gate", () => {
    const v = { ...runAutomatedValidation(draft(), ctx()).question, content: { ...baseInput("q").content, correctAnswer: "999" } };
    expect(() => recordHumanReview(v, REVIEW, "approve", ctx())).toThrow(/gate\(s\) failed/);
  });
  it("review settles an open answer gate only when the reviewer states they verified it", () => {
    const v = runAutomatedValidation(draft("q", { content: { ...baseInput("q").content, groundTruthDerivation: null } }), ctx()).question;
    const unverified = recordHumanReview(v, REVIEW, "approve", ctx()).question;
    expect(() => publishQuestion(unverified, ctx())).toThrow(AuthoringError);
    const verified = recordHumanReview(v, { ...REVIEW, answerVerifiedByReviewer: true }, "approve", ctx()).question;
    expect(publishQuestion(verified, ctx()).validationState).toBe("published");
  });
});

describe("publication gates: content never becomes published merely because it exists", () => {
  it("a draft cannot be published, however clean", () => {
    expect(() => publishQuestion(draft(), ctx())).toThrow(AuthoringError);
  });
  it("valid JSON / syntactically valid DNA / an AI origin do not publish anything", () => {
    const ai = proposeAiQuestion({ ...baseInput("ai"), source: aiSource });
    expect(ai.validationState).toBe("draft");
    expect(() => publishQuestion(ai, ctx())).toThrow(AuthoringError);
  });
  it("an AI-generated question publishes only after an independent answer check, validation and an explicit publish call", () => {
    const ai = proposeAiQuestion({ ...baseInput("ai"), source: aiSource });
    const v1 = runAutomatedValidation(ai, ctx());
    expect(v1.report.requiresHuman).toContain("answer");
    expect(() => publishQuestion(v1.question, ctx())).toThrow(AuthoringError);
    const checked = editQuestion(v1.question, { independentReverification: { derivedAnswer: "20000" } });
    const v2 = runAutomatedValidation(checked, ctx());
    expect(v2.question.validationState).toBe("ai_validated");
    expect(v2.question.validationState).not.toBe("published");
    expect(publishQuestion(v2.question, ctx()).validationState).toBe("published");
  });
  it("hard / extreme / novel need human review first, even when every machine gate is clean", () => {
    for (const tier of ["hard", "extreme", "novel"] as const) {
      const v = runAutomatedValidation(draft("q", { dna: baseDna({ difficultyTier: tier }) }), ctx()).question;
      expect(() => publishQuestion(v, ctx()), tier).toThrow(AuthoringError);
      const reviewed = recordHumanReview(v, REVIEW, "approve", ctx()).question;
      expect(publishQuestion(reviewed, ctx()).validationState).toBe("published");
    }
  });
  it("a gate that fails at publication time blocks it, even if validation once passed (nothing stale is trusted)", () => {
    const v = runAutomatedValidation(draft(), ctx()).question;
    const drifted: AuthoredQuestion = { ...v, source: { sourceType: "licensed", sourceRef: null, licenseRef: null, attributedTo: null } };
    expect(() => publishQuestion(drifted, ctx())).toThrow(/provenance/);
  });
  it("blocked publication carries the full gate report", () => {
    try {
      publishQuestion(draft(), ctx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthoringError);
      expect((e as AuthoringError).code).toBe("publication_blocked");
      expect((e as AuthoringError).report?.gates).toHaveLength(11);
    }
  });
  it("a published question cannot be published again or rejected (terminal)", () => {
    const p = publishQuestion(runAutomatedValidation(draft(), ctx()).question, ctx());
    expect(() => publishQuestion(p, ctx())).toThrow(AuthoringError);
    expect(() => rejectQuestion(p)).toThrow(AuthoringError);
  });
  it("identity is stable across the whole lifecycle", () => {
    const ids = new Set<string>();
    let q = draft("the-id");
    ids.add(q.id);
    q = runAutomatedValidation(q, ctx()).question; ids.add(q.id);
    q = recordHumanReview(q, REVIEW, "approve", ctx()).question; ids.add(q.id);
    q = publishQuestion(q, ctx()); ids.add(q.id);
    expect([...ids]).toEqual(["the-id"]);
  });
});
