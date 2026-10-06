import type { TeachingMode, TutorEvidenceKind, TutorIntent } from "./types.js";

/**
 * Per-intent CONTRACT (docs/DECISIONS.md D-092, D-093). The repository specifies
 * no tutoring policy beyond what is cited below, so every value is PROVISIONAL
 * and deliberately conservative: when in doubt the answer key is WITHHELD and
 * the tutor returns less. Loosening any of this is a product decision, not a patch.
 *
 * What IS specified and reused: the practice result screen reveals the correct
 * answer and the solution steps only for a SUBMITTED attempt, never for a skip
 * (Phase 2, `AttemptResultView`). The tutor therefore keys its disclosure to a
 * submitted attempt - Unit 1's looser "any finalized attempt" rule was tightened
 * to this in Unit 2 (D-093).
 *
 * `answerKey`:
 *   "never"                    - the key/solution never enters the prompt
 *   "after_submitted_attempt"  - only when THIS student has a SUBMITTED attempt on THIS question
 */
export type AnswerKeyDisclosure = "never" | "after_submitted_attempt";

export type ExplanationPartName = "asked" | "concept" | "steps" | "whyCorrect" | "whyIncorrectPathFails" | "takeaway" | "tryNext";

export interface TutorIntentPolicy {
  intent: TutorIntent;
  teachingMode: TeachingMode;
  needsQuestion: boolean;
  needsConcept: boolean;
  /** A SUBMITTED attempt is mandatory (else insufficient_context, before any model call). */
  needsSubmittedAttempt: boolean;
  /** The question must carry authored solution steps (the expected reasoning path) to ground in. */
  needsSolutionSteps: boolean;
  answerKey: AnswerKeyDisclosure;
  /** Whether the student's submitted-attempt facts may be placed in the context (when one exists). */
  includeAttempt: boolean;
  /** Whether the student's own autopsy outcome (student-facing wording only) may be placed in the context. */
  includeDiagnosis: boolean;
  /** DNA fields that would reveal approach (testing modes, trap label) - only after a submitted attempt. */
  includeApproachDna: boolean;
  /** 1-hop concept-graph neighbourhood. */
  includeGraph: boolean;
  /** "optional": try the source port; a denial degrades gracefully (and is recorded). */
  sourceRetrieval: "none" | "optional";
  /** Which already-scoped evidence kinds this intent may carry. EMPTY for every intent: no spec says which intent may use which. */
  allowedEvidenceKinds: readonly TutorEvidenceKind[];
  allowHypotheses: boolean;
  /** The one response type that counts as answering (the other allowed type is `insufficient_context`). */
  answerResponseType: string;
  allowedResponseTypes: readonly string[];
  /** Whether a `socraticStep` is required (and, elsewhere, forbidden). */
  requiresSocraticStep: boolean;
  /** Explanation parts that must be present. */
  requiredParts: readonly ExplanationPartName[];
  /** Further parts required only when the key is authorized for this response. */
  requiredPartsWhenKeyAuthorized: readonly ExplanationPartName[];
  /** Parts that must NOT appear while the key is withheld (they would solve the question). */
  forbiddenPartsWhenKeyWithheld: readonly ExplanationPartName[];
  /** Whether parts may be present at all (a hint and a Socratic step carry none). */
  partsPermitted: boolean;
  /** PROVISIONAL cap on `text` length so a hint stays a hint and a guiding question stays one step. Null = no cap. */
  maxTextChars: number | null;
}

const NONE: readonly TutorEvidenceKind[] = [];
const ALL_SOLVING: readonly ExplanationPartName[] = ["steps", "whyCorrect"];

const base = {
  needsConcept: false,
  needsSolutionSteps: false,
  includeDiagnosis: false,
  includeApproachDna: false,
  includeGraph: false,
  sourceRetrieval: "none" as const,
  allowedEvidenceKinds: NONE,
  allowHypotheses: false,
  requiresSocraticStep: false,
  requiredParts: [] as readonly ExplanationPartName[],
  requiredPartsWhenKeyAuthorized: [] as readonly ExplanationPartName[],
  forbiddenPartsWhenKeyWithheld: ALL_SOLVING,
  partsPermitted: true,
  maxTextChars: null as number | null
};

export const TUTOR_INTENT_POLICIES: Readonly<Record<TutorIntent, TutorIntentPolicy>> = {
  explain_question: {
    ...base,
    intent: "explain_question",
    teachingMode: "explanation",
    needsQuestion: true,
    needsSubmittedAttempt: false,
    answerKey: "after_submitted_attempt",
    includeAttempt: false,
    includeGraph: true,
    sourceRetrieval: "optional",
    answerResponseType: "explanation",
    allowedResponseTypes: ["explanation", "insufficient_context"],
    requiredParts: ["asked", "concept", "takeaway"],
    requiredPartsWhenKeyAuthorized: ["steps", "whyCorrect"]
  },
  explain_concept: {
    ...base,
    intent: "explain_concept",
    teachingMode: "concept_clarification",
    needsQuestion: false,
    needsConcept: true,
    needsSubmittedAttempt: false,
    answerKey: "never",
    includeAttempt: false,
    includeGraph: true,
    sourceRetrieval: "optional",
    answerResponseType: "concept_explanation",
    allowedResponseTypes: ["concept_explanation", "insufficient_context"],
    requiredParts: ["concept", "takeaway"]
  },
  give_hint: {
    ...base,
    intent: "give_hint",
    teachingMode: "hint",
    needsQuestion: true,
    needsSubmittedAttempt: false,
    // A hint must never be a way to obtain the answer: the key is not even placed in the prompt. How many hint levels exist is UNSPECIFIED - there is exactly one hint mode and no escalation.
    answerKey: "never",
    includeAttempt: false,
    answerResponseType: "hint",
    allowedResponseTypes: ["hint", "insufficient_context"],
    partsPermitted: false,
    maxTextChars: 500
  },
  guide_with_question: {
    ...base,
    intent: "guide_with_question",
    teachingMode: "guided_question",
    needsQuestion: true,
    needsSubmittedAttempt: false,
    // Socratic guidance is for the student to DISCOVER the step: the key is never provided, even after submission.
    answerKey: "never",
    // Student-work-first: if the student has a submitted attempt, its observable facts and own autopsy outcome ground the question.
    includeAttempt: true,
    includeDiagnosis: true,
    includeGraph: true,
    allowHypotheses: true,
    requiresSocraticStep: true,
    answerResponseType: "guided_question",
    allowedResponseTypes: ["guided_question", "insufficient_context"],
    partsPermitted: false,
    maxTextChars: 500
  },
  explain_mistake: {
    ...base,
    intent: "explain_mistake",
    teachingMode: "mistake_explanation",
    needsQuestion: true,
    needsSubmittedAttempt: true,
    answerKey: "after_submitted_attempt",
    includeAttempt: true,
    includeDiagnosis: true,
    includeApproachDna: true,
    includeGraph: true,
    sourceRetrieval: "optional",
    allowHypotheses: true,
    answerResponseType: "mistake_explanation",
    allowedResponseTypes: ["mistake_explanation", "insufficient_context"],
    requiredParts: ["whyIncorrectPathFails", "whyCorrect", "takeaway"]
  },
  clarify_solution: {
    ...base,
    intent: "clarify_solution",
    teachingMode: "full_solution",
    needsQuestion: true,
    needsSubmittedAttempt: true,
    needsSolutionSteps: true,
    answerKey: "after_submitted_attempt",
    includeAttempt: true,
    includeApproachDna: true,
    answerResponseType: "solution_clarification",
    allowedResponseTypes: ["solution_clarification", "insufficient_context"],
    requiredParts: ["asked", "concept", "steps", "whyCorrect", "takeaway"]
  }
};

/**
 * What the product has NOT decided (D-092, D-093). Surfaced in the review docs
 * and asserted by a test so it cannot silently drift.
 */
export const UNRESOLVED_TUTOR_POLICIES = [
  "how many hint levels exist and what each may reveal (no hint content or level exists anywhere; the tutor has one hint mode and no escalation)",
  "whether any tutor mode may reveal the answer key before the student has submitted an attempt",
  "whether a skipped or abandoned attempt entitles the student to the answer key (the result screen reveals it for submitted attempts only; the tutor follows that)",
  "which student evidence (revision, curriculum, simulation) each intent may use; only the student's own attempt and autopsy outcome are used",
  "whether authorized source text may be quoted to a student (the corpus is internal; students are denied by the content-intelligence retriever)",
  "conversation memory and multi-turn behaviour beyond caller-supplied prior actions (none is stored; no escalation order between teaching modes is defined)",
  "rate limits, quotas and cost budgets for tutor calls",
  "tone, language and reading-level requirements",
  "how a tutor answer is shown, flagged or reported in a student UI",
  "whether refused or failed tutor requests need an audit entry",
  "whether a tutor reply may open or confirm a student's autopsy hypothesis (the tutor only asks; confirmation stays the autopsy flow's)"
] as const;
