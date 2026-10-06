import type { AiResultMetadata, TutorResponseAiOutput } from "@ipmat/ai";
import type { Certainty, ConceptGraph, RelationType } from "@ipmat/concept-graph";

/**
 * The AI Tutor's contracts (Phase 8 Unit 1, docs/DECISIONS.md D-092).
 *
 * The tutor is a CONSTRAINED layer over structured intelligence the system
 * already holds - never a chatbot. A request names an explicit INTENT; the
 * context is assembled deterministically from ports (each result re-verified
 * here), a model is asked for a structured answer, and a deterministic
 * validator decides whether that answer may reach the student.
 *
 * Every piece of information is one of six epistemic classes and is never
 * allowed to masquerade as another:
 *   OBSERVED_DATA     - recorded facts (the student's submitted answer, their working)
 *   SOURCE_CONTENT    - text of an authorized source chunk, with provenance
 *   DERIVED_EVIDENCE  - deterministic derivations (concept-graph edges, question DNA)
 *   AI_EXPLANATION    - the model's explanation text
 *   AI_HYPOTHESIS     - a hedged proposal about the student's attempt
 *   UNRESOLVED        - what could not be grounded (insufficient_context)
 */
export type EpistemicClass = "OBSERVED_DATA" | "SOURCE_CONTENT" | "DERIVED_EVIDENCE" | "AI_EXPLANATION" | "AI_HYPOTHESIS" | "UNRESOLVED";

/**
 * Intents are EXTENSIBLE CONTRACTS, not a finished tutoring policy: the
 * repository specifies no tutoring behaviour (Phase 0 lists a "general-purpose
 * AI chatbot" and a "voice tutor" as OUT of scope). Each intent's disclosure
 * rules live in `policy.ts` and are labelled provisional.
 */
export const TUTOR_INTENTS = ["explain_question", "explain_concept", "give_hint", "guide_with_question", "explain_mistake", "clarify_solution"] as const;
export type TutorIntent = (typeof TUTOR_INTENTS)[number];

/**
 * PRESENTATION (Phase 8 Unit 4, D-095): how an answer is worded, never what may be disclosed. It is
 * set from a student's EXPLICIT preference (see `@ipmat/personalization`) and nothing else; this package
 * does not know where it came from. It never reaches the answer-key, ownership, exam-scope or context
 * rules, and the default reproduces the pre-Unit-4 behaviour byte for byte.
 */
export const TUTOR_LANGUAGES = ["english", "hindi", "hinglish"] as const;
export type TutorLanguage = (typeof TUTOR_LANGUAGES)[number];
export const TUTOR_VERBOSITIES = ["concise", "standard", "detailed"] as const;
export type TutorVerbosity = (typeof TUTOR_VERBOSITIES)[number];
export interface TutorPresentation {
  language: TutorLanguage;
  verbosity: TutorVerbosity;
}
export const DEFAULT_TUTOR_PRESENTATION: Readonly<TutorPresentation> = Object.freeze({ language: "english", verbosity: "standard" });
export const isDefaultPresentation = (p: TutorPresentation): boolean => p.language === DEFAULT_TUTOR_PRESENTATION.language && p.verbosity === DEFAULT_TUTOR_PRESENTATION.verbosity;

/**
 * TEACHING STATES (Phase 8 Unit 2) - what the tutor is DOING, each with its own
 * disclosure rule, required/forbidden content and response length contract (see
 * `policy.ts`); not merely a different prompt. There is deliberately NO ladder
 * between them: the repository specifies no hint levels or escalation order
 * (D-093), so a mode is chosen by the intent, never by an invented progression.
 */
export const TEACHING_MODES = ["hint", "guided_question", "explanation", "full_solution", "mistake_explanation", "concept_clarification"] as const;
export type TeachingMode = (typeof TEACHING_MODES)[number];

/**
 * An earlier tutor action, handed back by the CALLER as explicit context (there
 * is no hidden memory). Untrusted: it is quoted to the model as data and used
 * only for continuity and to refuse an identical repeat. It can never widen
 * what may be disclosed.
 */
export interface PriorTeachingAction {
  mode: TeachingMode;
  /** What the tutor said (the hint, the question, ...). */
  text: string;
  /** The student's reply to it, if any. */
  studentReply?: string;
}

export type TutorErrorCode =
  | "invalid_request"
  | "unknown_intent"
  | "ownership_denied"
  | "question_unavailable"
  | "concept_unavailable"
  | "attempt_ownership_violation"
  | "context_violation";

export class TutorError extends Error {
  constructor(readonly code: TutorErrorCode, message: string) {
    super(message);
    this.name = "TutorError";
  }
}

/** What a caller (a future route) hands over. Identity comes from authentication, never from the client. */
export interface TutorRequest {
  intent: TutorIntent;
  studentId: string;
  enrollmentId: string;
  /** Required by every intent except `explain_concept`. */
  questionId?: string;
  /** Required by `explain_concept`. */
  conceptName?: string;
  /** Optional short free text from the student. UNTRUSTED data, quoted to the model as data, never as instructions. */
  focus?: string;
  /** Up to `TUTOR_CONTEXT_LIMITS.MAX_PRIOR_ACTIONS` earlier actions of this interaction. Explicit - the tutor stores no conversation. */
  priorInteraction?: PriorTeachingAction[];
  /** Style only. Absent = English, standard length (the existing behaviour). */
  presentation?: TutorPresentation;
}

// ---------------------------------------------------------------------------
// Ports. The domain never reaches a database, a vendor or the network; every
// port is injected and every result is RE-VERIFIED by the context builder.
// ---------------------------------------------------------------------------

export interface TutorEnrollmentScope {
  studentId: string;
  enrollmentId: string;
  examCode: string;
}

export interface TutorOwnershipPort {
  /** Returns the enrollment ONLY when it belongs to the student; null otherwise (never says which part failed). */
  resolveEnrollment(studentId: string, enrollmentId: string): Promise<TutorEnrollmentScope | null>;
}

/** A question as read from the authoritative store. Carries the internal fields; the context builder decides what the tutor may see. */
export interface TutorQuestionRecord {
  questionId: string;
  examCode: string;
  validationState: string;
  conceptName: string;
  stem: string;
  options: string[] | null;
  /** INTERNAL - the answer key. Only ever reaches a prompt when the policy authorizes it. */
  correctAnswer: string;
  /** INTERNAL - the authored solution. Same rule as `correctAnswer`. */
  solutionSteps: string[];
  patternFamilyName: string;
  skill: string;
  difficultyTier: string;
  noveltyLevel: string;
  expectedTimeSeconds: number;
  testingModes: string[];
  /** A human-readable trap label (never the taxonomy code or id). Null if the question has no designed trap. */
  trapLabel: string | null;
  /** INTERNAL identifiers the model must never repeat (taxonomy cell id, trap code, ...). Used only by the leakage check. */
  internalTokens?: string[];
}

export interface TutorQuestionPort {
  getQuestion(examCode: string, questionId: string): Promise<TutorQuestionRecord | null>;
}

export interface TutorConceptPort {
  getConceptGraph(examCode: string): Promise<ConceptGraph>;
}

/** The student's attempt on a question (observable facts only - no confidence, emotion or inferred state). */
export interface TutorAttemptRecord {
  attemptId: string;
  studentId: string;
  questionId: string;
  status: "submitted" | "skipped" | "abandoned" | "in_progress";
  finalAnswer: string | null;
  isCorrect: boolean | null;
  hintsUsed: number;
  answerChanges: number;
  timeTakenSeconds: number | null;
  /** The student's own working, if recorded. Never reasoning inferred by the system. */
  workingSteps: string | null;
  reasoningText: string | null;
}

export interface TutorAttemptPort {
  getLatestAttempt(studentId: string, questionId: string): Promise<TutorAttemptRecord | null>;
}

/** Already-scoped facts from other intelligence (revision, curriculum, simulation, a CONFIRMED autopsy). */
export type TutorEvidenceKind = "revision_signal" | "curriculum" | "simulation" | "autopsy_confirmed";
export interface TutorEvidenceFact {
  kind: TutorEvidenceKind;
  studentId: string;
  examCode: string;
  /** A factual statement already produced by the owning package. Never a verdict/score. */
  statement: string;
}
export interface TutorEvidencePort {
  getEvidence(scope: TutorEnrollmentScope, kinds: readonly TutorEvidenceKind[]): Promise<TutorEvidenceFact[]>;
}

export interface TutorSourceItem {
  chunkId: string;
  examCode: string;
  text: string;
  location: string;
  source: { sourceKey: string; title: string; version: number };
}
export type TutorSourceResult = { status: "ok"; items: TutorSourceItem[] } | { status: "denied" };
export interface TutorSourcePort {
  retrieve(query: { examCode: string; text: string; limit: number }): Promise<TutorSourceResult>;
}

/**
 * The student's own autopsy outcome for THIS attempt, already reduced to
 * STUDENT-FACING wording by the owning side (the same wording the autopsy
 * confirmation screen shows). It has no internal rationale, evidence list,
 * model confidence or taxonomy code field - those never cross this port.
 */
export interface TutorDiagnosisRecord {
  studentId: string;
  attemptId: string;
  status: "awaiting_confirmation" | "confirmed" | "rejected" | "corrected";
  /** Student-facing label of the proposed category. */
  label: string | null;
  /** The hypothesis as worded to the student. */
  hypothesisText: string | null;
  /** The student's own correction, as typed. */
  correctionText: string | null;
  /** Student-facing label of a CONFIRMED, active repair target. Re-checked: ignored unless status is "confirmed". */
  repairTargetLabel: string | null;
  /** Internal codes the model must never repeat (e.g. an error-taxonomy code). Leak-check only. */
  internalTokens?: string[];
}
export interface TutorDiagnosisPort {
  getDiagnosis(studentId: string, attemptId: string): Promise<TutorDiagnosisRecord | null>;
}

export type TutorOutcome = "answered" | "insufficient_context" | "rejected_ungrounded" | "provider_failure";
export type TutorFailureKind = "timeout" | "malformed_output" | "provider_error";

export interface TutorAuditEntry {
  at: string;
  requestId: string;
  intent: TutorIntent;
  teachingMode: TeachingMode;
  studentId: string;
  enrollmentId: string;
  examCode: string | null;
  questionId: string | null;
  conceptName: string | null;
  outcome: TutorOutcome;
  /** A digest of what the context contained - never its text. */
  contextDigest: string | null;
  includedSections: string[];
  withheldSections: string[];
  violationCodes: string[];
  generationAttempts: number;
  model: Pick<AiResultMetadata, "provider" | "model" | "promptVersion" | "latencyMs" | "tokenUsage" | "estimatedCostUsd" | "attempts"> | null;
  failure: TutorFailureKind | null;
}
/** Receives metadata ONLY: no prompt, no response text, no student free text. */
export interface TutorAuditSink {
  record(entry: TutorAuditEntry): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ContextRef {
  /** Stable id a response may cite (`question`, `concept:<name>`, `edge:<from>|<type>|<to>`, `attempt`, `answer_key`, `source:<n>`, `dna`, `evidence:<kind>:<n>`; opaque - never a database id). */
  ref: string;
  epistemic: EpistemicClass;
  label: string;
}

export interface TutorGraphEdge {
  ref: string;
  from: string;
  to: string;
  type: RelationType;
  rationale: string;
  certainty: Certainty;
}

export interface TutorContext {
  intent: TutorIntent;
  exam: { examCode: string };
  student: { studentId: string; enrollmentId: string };
  question: { ref: string; stem: string; options: string[] | null } | null;
  concept: { ref: string; name: string; description: string } | null;
  graph: { edges: TutorGraphEdge[]; truncated: boolean } | null;
  dna: { ref: string; patternFamilyName: string; skill: string; difficultyTier: string; noveltyLevel: string; expectedTimeSeconds: number; testingModes: string[] | null; trapLabel: string | null } | null;
  attempt: { ref: string; submittedAnswer: string | null; isCorrect: boolean | null; hintsUsed: number; answerChanges: number; timeTakenSeconds: number | null; workingSteps: string | null; reasoningText: string | null } | null;
  /** Non-null ONLY when the intent's policy authorizes it for this moment. */
  answerKey: { ref: string; correctAnswer: string; solutionSteps: string[] } | null;
  evidence: Array<{ ref: string; kind: TutorEvidenceKind; statement: string }>;
  sources: Array<{ ref: string; chunkId: string; text: string; location: string; title: string; sourceKey: string; version: number }>;
  sourceAccess: "not_requested" | "ok" | "denied";
  /** The student's autopsy outcome (explain_mistake only), by status. A rejected/corrected one never carries the rejected wording - that is held by the validator. */
  diagnosis:
    | { ref: string; status: "awaiting_confirmation"; hypothesisText: string }
    | { ref: string; status: "confirmed"; label: string; hypothesisText: string | null; repairTargetLabel: string | null }
    | { ref: string; status: "rejected" }
    | { ref: string; status: "corrected"; correctionText: string }
    | null;
  prior: PriorTeachingAction[];
  presentation: TutorPresentation;
  focus: string | null;
  /** Everything citable, with its epistemic class. */
  refs: ContextRef[];
  includedSections: string[];
  withheldSections: string[];
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type GroundingViolationCode =
  | "unknown_reference"
  | "missing_citation"
  | "answer_key_leakage"
  | "solution_leakage"
  | "internal_identifier_leakage"
  | "cross_exam_content"
  | "psychological_claim"
  | "unsupported_mastery_readiness_claim"
  | "invented_exam_rule"
  | "unsupported_relation"
  | "unverifiable_quote"
  | "misreported_attempt"
  | "unhedged_hypothesis"
  | "hypothesis_not_permitted"
  | "disallowed_response_type"
  | "missing_explanation_part"
  | "parts_not_permitted"
  | "contradicts_key"
  | "socratic_step_invalid"
  | "response_too_long"
  | "repeated_teaching_action"
  | "unconfirmed_diagnosis_as_fact"
  | "unconfirmed_diagnosis_not_queried"
  | "rejected_diagnosis_reused"
  | "verbosity_violation";

export interface GroundingViolation {
  code: GroundingViolationCode;
  detail: string;
}

/**
 * The localized text is an ADD-ON to the fully validated English `text`: when it fails its own checks it is
 * dropped and the English is shown. It is never a reason to show anything the English check did not clear.
 */
export interface LocalizationReport {
  requested: TutorLanguage;
  status: "not_requested" | "validated" | "rejected" | "missing";
  codes: string[];
}

export interface GroundingReport {
  /** Which checks ran. */
  checksRun: string[];
  localization: LocalizationReport;
  violations: GroundingViolation[];
  passed: boolean;
}

export interface TutorSourceReference {
  ref: string;
  chunkId: string;
  title: string;
  location: string;
  version: number;
  epistemic: "SOURCE_CONTENT";
}

export interface TutorEvidenceReference {
  ref: string;
  label: string;
  epistemic: EpistemicClass;
}

export interface TutorHypothesis {
  epistemic: "AI_HYPOTHESIS";
  text: string;
  evidenceRefs: string[];
}

/** What the tutor DID - the teaching action, never the model's private reasoning. */
export interface TeachingAction {
  mode: TeachingMode;
  /** Whether the answer key/solution was authorized in the context for this response. */
  answerDisclosure: "withheld" | "authorized";
  socraticStep: { checks: string; question: string; conceptRef: string; evidenceRefs: string[]; learnsFromReply: string } | null;
}

export interface TutorResponse {
  outcome: TutorOutcome;
  teachingAction: TeachingAction;
  parts: TutorResponseAiOutput["parts"] | null;
  responseType: TutorResponseAiOutput["responseType"] | null;
  /** The explanation (AI_EXPLANATION). Null whenever nothing groundable may be shown. */
  text: string | null;
  /** The same message in the requested language, ONLY when it passed its own validation; otherwise null (the English `text` is shown). */
  localizedText: string | null;
  presentation: TutorPresentation;
  /** Fixed, model-free text for non-answered outcomes. */
  fallbackMessage: string | null;
  sourceReferences: TutorSourceReference[];
  evidenceReferences: TutorEvidenceReference[];
  hypotheses: TutorHypothesis[];
  uncertainty: { insufficientContext: boolean; missing: string[] };
  grounding: GroundingReport;
  audit: TutorAuditEntry;
}
