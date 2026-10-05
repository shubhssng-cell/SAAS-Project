import type { TutorEvidenceKind, TutorIntent } from "./types.js";

/**
 * Per-intent CONTRACT (docs/DECISIONS.md D-092). The repository specifies no
 * tutoring policy, so every value below is PROVISIONAL and deliberately
 * conservative: when in doubt the answer key is WITHHELD and the tutor
 * returns less. Loosening any of this is a product decision, not a patch.
 *
 * `answerKey`:
 *   "never"                       - the key/solution never enters the prompt
 *   "after_finalized_attempt"     - only when THIS student has a finalized
 *                                   (submitted/skipped/abandoned) attempt on THIS question
 */
export type AnswerKeyDisclosure = "never" | "after_finalized_attempt";

export interface TutorIntentPolicy {
  intent: TutorIntent;
  needsQuestion: boolean;
  needsConcept: boolean;
  /** A finalized attempt is mandatory (else insufficient_context, before any model call). */
  needsFinalizedAttempt: boolean;
  /** The question must carry authored solution steps (the expected reasoning path) to ground in. */
  needsSolutionSteps: boolean;
  answerKey: AnswerKeyDisclosure;
  /** Whether the student's attempt facts may be placed in the context. */
  includeAttempt: boolean;
  /** DNA fields that would reveal approach (testing modes, trap label) - only after a finalized attempt. */
  includeApproachDna: boolean;
  /** 1-hop concept-graph neighbourhood. */
  includeGraph: boolean;
  /** "optional": try the source port; a denial degrades gracefully (and is recorded). */
  sourceRetrieval: "none" | "optional";
  /** Which already-scoped evidence kinds this intent may carry. EMPTY for all intents in Unit 1: no spec says which intent may use which. */
  allowedEvidenceKinds: readonly TutorEvidenceKind[];
  allowHypotheses: boolean;
  allowedResponseTypes: readonly string[];
}

const NONE: readonly TutorEvidenceKind[] = [];

export const TUTOR_INTENT_POLICIES: Readonly<Record<TutorIntent, TutorIntentPolicy>> = {
  explain_question: {
    intent: "explain_question",
    needsQuestion: true,
    needsConcept: false,
    needsFinalizedAttempt: false,
    needsSolutionSteps: false,
    answerKey: "after_finalized_attempt",
    includeAttempt: false,
    includeApproachDna: false,
    includeGraph: true,
    sourceRetrieval: "optional",
    allowedEvidenceKinds: NONE,
    allowHypotheses: false,
    allowedResponseTypes: ["explanation", "insufficient_context"]
  },
  explain_concept: {
    intent: "explain_concept",
    needsQuestion: false,
    needsConcept: true,
    needsFinalizedAttempt: false,
    needsSolutionSteps: false,
    answerKey: "never",
    includeAttempt: false,
    includeApproachDna: false,
    includeGraph: true,
    sourceRetrieval: "optional",
    allowedEvidenceKinds: NONE,
    allowHypotheses: false,
    allowedResponseTypes: ["concept_explanation", "insufficient_context"]
  },
  give_hint: {
    intent: "give_hint",
    needsQuestion: true,
    needsConcept: false,
    needsFinalizedAttempt: false,
    needsSolutionSteps: false,
    // A hint must never be a way to obtain the answer: the key is not even placed in the prompt. How many hint levels exist is UNSPECIFIED.
    answerKey: "never",
    includeAttempt: false,
    includeApproachDna: false,
    includeGraph: false,
    sourceRetrieval: "none",
    allowedEvidenceKinds: NONE,
    allowHypotheses: false,
    allowedResponseTypes: ["hint", "insufficient_context"]
  },
  explain_mistake: {
    intent: "explain_mistake",
    needsQuestion: true,
    needsConcept: false,
    needsFinalizedAttempt: true,
    needsSolutionSteps: false,
    answerKey: "after_finalized_attempt",
    includeAttempt: true,
    includeApproachDna: true,
    includeGraph: true,
    sourceRetrieval: "optional",
    // Only a student-CONFIRMED autopsy could ever be carried here; whether it should be in Unit 1 is an unresolved product decision, so none is allowed yet.
    allowedEvidenceKinds: NONE,
    allowHypotheses: true,
    allowedResponseTypes: ["mistake_explanation", "insufficient_context"]
  },
  clarify_solution: {
    intent: "clarify_solution",
    needsQuestion: true,
    needsConcept: false,
    needsFinalizedAttempt: true,
    needsSolutionSteps: true,
    answerKey: "after_finalized_attempt",
    includeAttempt: true,
    includeApproachDna: true,
    includeGraph: false,
    sourceRetrieval: "none",
    allowedEvidenceKinds: NONE,
    allowHypotheses: false,
    allowedResponseTypes: ["solution_clarification", "insufficient_context"]
  }
};

/** What the product has NOT decided. Surfaced in the review doc and asserted by a test so it cannot silently drift. */
export const UNRESOLVED_TUTOR_POLICIES = [
  "how many hint levels exist and what each may reveal",
  "whether explain_question may reveal the key before the student has attempted the question",
  "whether a skipped or abandoned attempt entitles the student to the answer key",
  "which student evidence (revision, curriculum, simulation, confirmed autopsy) each intent may use",
  "whether authorized source text may be quoted to a student (the corpus is internal; students are denied by the content-intelligence retriever)",
  "conversation memory and multi-turn behaviour (none is built; every request is independent)",
  "rate limits, quotas and cost budgets for tutor calls",
  "tone, language and reading-level requirements",
  "how a tutor answer is shown, flagged or reported in a student UI"
] as const;
