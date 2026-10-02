import { decidePublication } from "@ipmat/question-engine";
import { evaluateGates } from "./gates.js";
import type { AuthoredQuestion, AuthoringOrigin, GateContext, GateReport, QuestionContent, QuestionInstanceDna, QuestionReview, QuestionSource } from "./types.js";

/**
 * The authoring lifecycle (docs/DECISIONS.md D-084), expressed in the EXISTING
 * persisted `ValidationState` vocabulary - nothing was added to it:
 *
 *   draft          authored or proposed; nothing about it is established
 *   ai_validated   the automated gates found no FAILURE (the established name
 *                  for "passed automated validation"; for human-authored
 *                  content it means exactly that and nothing about AI). Gates
 *                  that need a human (`requires_human`) may still be open -
 *                  this state does not claim they are settled
 *   human_reviewed a named reviewer approved it, with every gate unfailed
 *   published      every gate passed AND the lifecycle allows it
 *   rejected       terminal
 *
 * "Structured" is not a separate state: it is the `structure`/`metadata`/`dna`
 * gates passing, derived on every evaluation, never stored.
 *
 * Every function is PURE (returns a new question, never mutates) and takes
 * time from the caller. Content cannot become published merely because it
 * exists, is AI-generated, has valid JSON or has syntactically valid DNA: only
 * `publishQuestion` publishes, and only when `evaluateGates(...).publishable`.
 */

export class AuthoringError extends Error {
  readonly code: "edit_not_allowed" | "invalid_transition" | "gate_failed" | "publication_blocked";
  readonly report: GateReport | null;
  constructor(code: AuthoringError["code"], message: string, report: GateReport | null = null) {
    super(message);
    this.name = "AuthoringError";
    this.code = code;
    this.report = report;
  }
}

export interface NewQuestionInput {
  id: string;
  dna: QuestionInstanceDna;
  content: QuestionContent;
  source: QuestionSource;
  origin: AuthoringOrigin;
  independentReverification?: { derivedAnswer: string } | null;
}

/** Creates a DRAFT. Nothing is validated and nothing is claimed; an AI-proposed question starts here too. */
export function createDraft(input: NewQuestionInput): AuthoredQuestion {
  return {
    id: input.id,
    dna: structuredClone(input.dna),
    content: structuredClone(input.content),
    source: { ...input.source },
    origin: input.origin,
    validationState: "draft",
    review: null,
    independentReverification: input.independentReverification ?? null
  };
}

/** An AI-generated proposal: identical to a draft except for its recorded origin. It is never anything more until it passes the gates. */
export function proposeAiQuestion(input: Omit<NewQuestionInput, "origin">): AuthoredQuestion {
  return createDraft({ ...input, origin: "ai_generated" });
}

export interface QuestionEdit {
  dna?: QuestionInstanceDna;
  content?: QuestionContent;
  source?: QuestionSource;
  independentReverification?: { derivedAnswer: string } | null;
}

/**
 * Any edit INVALIDATES every earlier result: the question returns to `draft`
 * and a prior review is dropped (it reviewed content that no longer exists).
 * The id never changes. A published or rejected question cannot be edited.
 */
export function editQuestion(q: AuthoredQuestion, edit: QuestionEdit): AuthoredQuestion {
  if (q.validationState === "published" || q.validationState === "rejected") {
    throw new AuthoringError("edit_not_allowed", `a ${q.validationState} question cannot be edited`);
  }
  return {
    ...q,
    dna: edit.dna ? structuredClone(edit.dna) : q.dna,
    content: edit.content ? structuredClone(edit.content) : q.content,
    source: edit.source ? { ...edit.source } : q.source,
    independentReverification: edit.independentReverification === undefined ? q.independentReverification : edit.independentReverification,
    validationState: "draft",
    review: null
  };
}

export interface ValidationOutcome {
  question: AuthoredQuestion;
  report: GateReport;
  /** True iff the question advanced draft -> ai_validated. */
  advanced: boolean;
}

/**
 * draft -> ai_validated iff no gate FAILED. Open `requires_human` gates do not
 * block this step (they block publication). A question with a failed gate
 * stays `draft` and the report says exactly why.
 */
export function runAutomatedValidation(q: AuthoredQuestion, ctx: GateContext): ValidationOutcome {
  if (q.validationState !== "draft") {
    throw new AuthoringError("invalid_transition", `automated validation applies to a draft (this question is ${q.validationState}); edit it to return it to draft`);
  }
  const report = evaluateGates(q, ctx);
  if (report.failed.length > 0) return { question: q, report, advanced: false };
  return { question: { ...q, validationState: "ai_validated" }, report, advanced: true };
}

/**
 * A named reviewer's decision on an `ai_validated` question. Approval is
 * refused while any gate has FAILED (a reviewer cannot approve past a failed
 * check); reject is always allowed and terminal. The review record is stored
 * with the decision either way.
 */
export function recordHumanReview(q: AuthoredQuestion, review: QuestionReview, decision: "approve" | "reject", ctx: GateContext): ValidationOutcome {
  if (q.validationState !== "ai_validated") {
    throw new AuthoringError("invalid_transition", `only an ai_validated question can be reviewed (this question is ${q.validationState})`);
  }
  const reviewed: AuthoredQuestion = { ...q, review: { ...review } };
  if (decision === "reject") {
    return { question: { ...reviewed, validationState: "rejected" }, report: evaluateGates(reviewed, ctx), advanced: false };
  }
  const report = evaluateGates(reviewed, ctx);
  if (report.failed.length > 0) {
    throw new AuthoringError("gate_failed", `cannot approve: gate(s) failed: ${report.failed.join(", ")}`, report);
  }
  return { question: { ...reviewed, validationState: "human_reviewed" }, report: evaluateGates({ ...reviewed, validationState: "human_reviewed" }, ctx), advanced: true };
}

/** Rejects a question that has not reached a terminal state. Terminal and irreversible. */
export function rejectQuestion(q: AuthoredQuestion): AuthoredQuestion {
  if (q.validationState === "published" || q.validationState === "rejected") {
    throw new AuthoringError("invalid_transition", `a ${q.validationState} question cannot be rejected`);
  }
  return { ...q, validationState: "rejected" };
}

/**
 * The ONLY path to `published`. Re-evaluates every gate at the moment of
 * publication (a stale earlier result is never trusted) and then applies the
 * existing `decidePublication` rule (the same one the persisted publication
 * repository uses). If anything blocks, throws with the full gate report.
 */
export function publishQuestion(q: AuthoredQuestion, ctx: GateContext): AuthoredQuestion {
  const report = evaluateGates(q, ctx);
  if (!report.publishable) {
    throw new AuthoringError("publication_blocked", `publication blocked: failed=[${report.failed.join(", ")}] requires_human=[${report.requiresHuman.join(", ")}] state=${q.validationState}`, report);
  }
  const next = decidePublication("publish", { currentValidationState: q.validationState, difficultyTier: q.dna.difficultyTier, hasProvenance: true });
  return { ...q, validationState: next };
}
