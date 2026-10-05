import { createHash } from "node:crypto";
import { getAllRelationsFor, normalizeConceptNameKey, type ConceptGraph, type ConceptNode } from "@ipmat/concept-graph";
import { TUTOR_INTENT_POLICIES } from "./policy.js";
import {
  TUTOR_INTENTS,
  TutorError,
  type ContextRef,
  type TutorAttemptPort,
  type TutorAttemptRecord,
  type TutorConceptPort,
  type TutorContext,
  type TutorEnrollmentScope,
  type TutorEvidenceFact,
  type TutorEvidencePort,
  type TutorIntent,
  type TutorOwnershipPort,
  type TutorQuestionPort,
  type TutorQuestionRecord,
  type TutorRequest,
  type TutorSourceItem,
  type TutorSourcePort
} from "./types.js";

export const TUTOR_CONTEXT_LIMITS = {
  /** 1-hop concept-graph edges placed in a context. */
  MAX_GRAPH_EDGES: 12,
  MAX_SOURCE_CHUNKS: 3,
  MAX_FOCUS_CHARS: 500,
  MAX_ID_CHARS: 200,
  /** Internal tokens shorter than this are not leak-checked (too many false positives). */
  MIN_INTERNAL_TOKEN_CHARS: 6
} as const;

export interface TutorContextDeps {
  ownership: TutorOwnershipPort;
  questions: TutorQuestionPort;
  concepts: TutorConceptPort;
  attempts: TutorAttemptPort;
  evidence?: TutorEvidencePort;
  sources?: TutorSourcePort;
}

/**
 * The key a response must NOT reveal. It exists only so the deterministic
 * validator can detect leakage; it is never placed in a prompt, and is null
 * when the policy authorized disclosure.
 */
export interface ProtectedKey {
  correctAnswer: string;
  solutionSteps: string[];
  questionStem: string;
}

export type ContextBuildResult =
  | { kind: "context"; context: TutorContext; scope: TutorEnrollmentScope; protectedKey: ProtectedKey | null; internalTokens: string[] }
  | { kind: "insufficient"; missing: string[]; scope: TutorEnrollmentScope; includedSections: string[]; withheldSections: string[] };

const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= TUTOR_CONTEXT_LIMITS.MAX_ID_CHARS;

/** Validates the shape of a request. Throws `TutorError` - never guesses a missing field. */
export function validateTutorRequest(request: TutorRequest): { focus: string | null } {
  if (!request || typeof request !== "object") throw new TutorError("invalid_request", "a request object is required");
  if (!(TUTOR_INTENTS as readonly string[]).includes(request.intent)) throw new TutorError("unknown_intent", `unknown tutor intent`);
  if (!isNonEmpty(request.studentId) || !isNonEmpty(request.enrollmentId)) throw new TutorError("invalid_request", "studentId and enrollmentId are required");
  const policy = TUTOR_INTENT_POLICIES[request.intent];
  if (policy.needsQuestion && !isNonEmpty(request.questionId)) throw new TutorError("invalid_request", `intent "${request.intent}" requires questionId`);
  if (policy.needsConcept && !isNonEmpty(request.conceptName)) throw new TutorError("invalid_request", `intent "${request.intent}" requires conceptName`);
  let focus: string | null = null;
  if (request.focus !== undefined) {
    if (typeof request.focus !== "string") throw new TutorError("invalid_request", "focus must be a string");
    // eslint-disable-next-line no-control-regex -- stripping control characters from untrusted free text is the point
    const cleaned = request.focus.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    if (cleaned.length > TUTOR_CONTEXT_LIMITS.MAX_FOCUS_CHARS) throw new TutorError("invalid_request", `focus is limited to ${TUTOR_CONTEXT_LIMITS.MAX_FOCUS_CHARS} characters`);
    focus = cleaned.length > 0 ? cleaned : null;
  }
  return { focus };
}

function resolveConcept(graph: ConceptGraph, name: string): ConceptNode | undefined {
  const key = normalizeConceptNameKey(name);
  return graph.concepts.find((c) => normalizeConceptNameKey(c.name) === key);
}

/**
 * THE CONTEXT FIREWALL. Everything the model will ever see is assembled here,
 * and every result a port returns is re-verified rather than trusted:
 *
 *  - the enrollment must belong to the student (one answer for "missing" and "someone else's": no enumeration);
 *  - the exam is the ENROLLMENT's exam, never a request field;
 *  - a question must be published and belong to that exam;
 *  - an attempt must belong to that student and that question;
 *  - evidence/sources of another student or exam are dropped, not passed through;
 *  - the answer key enters the context only when the intent's policy authorizes it.
 *
 * Only what the intent's policy requires is included - there is no
 * "whole student profile".
 */
export async function buildTutorContext(deps: TutorContextDeps, request: TutorRequest): Promise<ContextBuildResult> {
  const { focus } = validateTutorRequest(request);
  const intent: TutorIntent = request.intent;
  const policy = TUTOR_INTENT_POLICIES[intent];

  const scope = await deps.ownership.resolveEnrollment(request.studentId, request.enrollmentId);
  if (!scope || scope.studentId !== request.studentId || scope.enrollmentId !== request.enrollmentId || !isNonEmpty(scope.examCode)) {
    throw new TutorError("ownership_denied", "this enrollment is not available to this student");
  }

  const included: string[] = [];
  const withheld: string[] = [];
  const refs: ContextRef[] = [];
  const missing: string[] = [];
  const internalTokens = new Set<string>([request.studentId, request.enrollmentId]);

  // --- question -----------------------------------------------------------
  let record: TutorQuestionRecord | null = null;
  if (policy.needsQuestion) {
    const found = await deps.questions.getQuestion(scope.examCode, request.questionId as string);
    if (!found || found.examCode !== scope.examCode || found.questionId !== request.questionId || found.validationState !== "published") {
      // One answer for: missing, another exam's, unpublished, and mismatched-id - a student can learn nothing from the difference.
      throw new TutorError("question_unavailable", "this question is not available in this enrollment's exam");
    }
    record = found;
    internalTokens.add(found.questionId);
    for (const t of found.internalTokens ?? []) internalTokens.add(t);
  }

  // --- attempt (observable facts only) -------------------------------------
  let attempt: TutorAttemptRecord | null = null;
  if (record && (policy.includeAttempt || policy.answerKey !== "never" || policy.needsFinalizedAttempt)) {
    attempt = await deps.attempts.getLatestAttempt(request.studentId, record.questionId);
    if (attempt && (attempt.studentId !== request.studentId || attempt.questionId !== record.questionId)) {
      throw new TutorError("attempt_ownership_violation", "an attempt that does not belong to this student and question was returned");
    }
    if (attempt) internalTokens.add(attempt.attemptId);
  }
  const finalized = attempt !== null && attempt.status !== "in_progress";

  if (policy.needsFinalizedAttempt && !finalized) missing.push("finalized_attempt");
  if (intent === "explain_mistake" && finalized && !(attempt!.status === "submitted" && attempt!.finalAnswer !== null && attempt!.isCorrect === false)) {
    missing.push("incorrect_submitted_answer");
  }
  if (policy.needsSolutionSteps && record && record.solutionSteps.length === 0) missing.push("authored_solution_steps");

  // --- concept + graph -----------------------------------------------------
  let concept: TutorContext["concept"] = null;
  let graphBlock: TutorContext["graph"] = null;
  const conceptName = policy.needsConcept ? (request.conceptName as string) : record?.conceptName ?? null;
  if (conceptName !== null && (policy.needsConcept || policy.includeGraph)) {
    const graph = await deps.concepts.getConceptGraph(scope.examCode);
    const node = resolveConcept(graph, conceptName);
    if (!node) {
      if (policy.needsConcept) throw new TutorError("concept_unavailable", "this concept is not in the exam's concept universe");
      withheld.push("concept_graph(concept not in graph)");
    } else {
      concept = { ref: `concept:${node.name}`, name: node.name, description: node.description };
      refs.push({ ref: concept.ref, epistemic: "SOURCE_CONTENT", label: `Concept: ${node.name}` });
      included.push("concept");
      if (policy.includeGraph) {
        // Speculative edges are never shown: a tutor must not present a guess about the structure of the subject as structure.
        const all = getAllRelationsFor(graph, node.name).filter((e) => e.certainty !== "speculative");
        const sorted = [...all].sort((a, b) => (a.type + a.from + a.to < b.type + b.from + b.to ? -1 : 1));
        const edges = sorted.slice(0, TUTOR_CONTEXT_LIMITS.MAX_GRAPH_EDGES).map((e) => ({
          ref: `edge:${e.from}|${e.type}|${e.to}`,
          from: e.from,
          to: e.to,
          type: e.type,
          rationale: e.rationale,
          certainty: e.certainty
        }));
        graphBlock = { edges, truncated: sorted.length > edges.length };
        included.push("concept_graph(1-hop, non-speculative)");
        for (const e of edges) refs.push({ ref: e.ref, epistemic: "DERIVED_EVIDENCE", label: `${e.from} -[${e.type}]-> ${e.to}` });
      }
    }
  }

  // --- the key: ONLY when the policy authorizes it for this moment ---------
  const keyAuthorized = record !== null && policy.answerKey === "after_finalized_attempt" && finalized;
  let answerKey: TutorContext["answerKey"] = null;
  if (record && keyAuthorized) {
    answerKey = { ref: "answer_key", correctAnswer: record.correctAnswer, solutionSteps: [...record.solutionSteps] };
    refs.push({ ref: answerKey.ref, epistemic: "SOURCE_CONTENT", label: "Authored answer key and solution" });
    included.push("answer_key");
  } else if (record) {
    withheld.push("answer_key(not authorized for this intent/moment)");
  }

  // --- question + DNA (student-safe subset) --------------------------------
  let question: TutorContext["question"] = null;
  let dna: TutorContext["dna"] = null;
  if (record) {
    question = { ref: "question", stem: record.stem, options: record.options ? [...record.options] : null };
    refs.push({ ref: question.ref, epistemic: "SOURCE_CONTENT", label: "The question as shown to the student" });
    included.push("question");
    const approach = policy.includeApproachDna && finalized;
    dna = {
      ref: "dna",
      patternFamilyName: record.patternFamilyName,
      skill: record.skill,
      difficultyTier: record.difficultyTier,
      noveltyLevel: record.noveltyLevel,
      expectedTimeSeconds: record.expectedTimeSeconds,
      testingModes: approach ? [...record.testingModes] : null,
      trapLabel: approach ? record.trapLabel : null
    };
    refs.push({ ref: dna.ref, epistemic: "DERIVED_EVIDENCE", label: "Question DNA (student-safe subset)" });
    included.push(approach ? "dna(with approach fields)" : "dna(without testing modes / trap)");
    if (!approach) withheld.push("dna.testingModes+trapLabel(approach-revealing before a finalized attempt)");
  }

  let attemptBlock: TutorContext["attempt"] = null;
  if (attempt && policy.includeAttempt && finalized && !missing.includes("incorrect_submitted_answer")) {
    attemptBlock = {
      ref: "attempt",
      submittedAnswer: attempt.finalAnswer,
      isCorrect: attempt.isCorrect,
      hintsUsed: attempt.hintsUsed,
      answerChanges: attempt.answerChanges,
      timeTakenSeconds: attempt.timeTakenSeconds,
      workingSteps: attempt.workingSteps,
      reasoningText: attempt.reasoningText
    };
    refs.push({ ref: attemptBlock.ref, epistemic: "OBSERVED_DATA", label: "The student's recorded attempt" });
    included.push("attempt");
  }

  // --- already-scoped evidence (none allowed in Unit 1; the gate exists) ----
  const evidence: TutorContext["evidence"] = [];
  if (policy.allowedEvidenceKinds.length > 0 && deps.evidence) {
    const facts: TutorEvidenceFact[] = await deps.evidence.getEvidence(scope, policy.allowedEvidenceKinds);
    let i = 0;
    for (const f of facts) {
      if (f.studentId !== request.studentId || f.examCode !== scope.examCode || !policy.allowedEvidenceKinds.includes(f.kind)) {
        withheld.push("evidence(item of another student/exam/kind dropped)");
        continue;
      }
      const ref = `evidence:${f.kind}:${i++}`;
      evidence.push({ ref, kind: f.kind, statement: f.statement });
      refs.push({ ref, epistemic: "DERIVED_EVIDENCE", label: `Evidence (${f.kind})` });
    }
    if (evidence.length > 0) included.push("evidence");
  }

  // --- source (optional, rights-gated by the injected port) ----------------
  let sourceAccess: TutorContext["sourceAccess"] = "not_requested";
  const sources: TutorContext["sources"] = [];
  if (policy.sourceRetrieval === "optional" && deps.sources && conceptName !== null) {
    const text = `${conceptName} ${focus ?? ""}`.trim().slice(0, 300);
    const result = await deps.sources.retrieve({ examCode: scope.examCode, text, limit: TUTOR_CONTEXT_LIMITS.MAX_SOURCE_CHUNKS });
    if (result.status === "denied") {
      sourceAccess = "denied";
      withheld.push("sources(access denied by the source-rights boundary)");
    } else {
      sourceAccess = "ok";
      const items: TutorSourceItem[] = result.items.slice(0, TUTOR_CONTEXT_LIMITS.MAX_SOURCE_CHUNKS);
      for (const it of items) {
        if (it.examCode !== scope.examCode) {
          withheld.push("sources(item of another exam dropped)");
          continue;
        }
        const ref = `source:${sources.length + 1}`; // opaque: a chunk id is an internal identifier
        sources.push({ ref, chunkId: it.chunkId, text: it.text, location: it.location, title: it.source.title, sourceKey: it.source.sourceKey, version: it.source.version });
        refs.push({ ref, epistemic: "SOURCE_CONTENT", label: `Source: ${it.source.title} (${it.location})` });
      }
      if (sources.length > 0) included.push("sources");
    }
  }

  if (missing.length > 0) {
    return { kind: "insufficient", missing, scope, includedSections: included, withheldSections: withheld };
  }

  const context: TutorContext = {
    intent,
    exam: { examCode: scope.examCode },
    student: { studentId: scope.studentId, enrollmentId: scope.enrollmentId },
    question,
    concept,
    graph: graphBlock,
    dna,
    attempt: attemptBlock,
    answerKey,
    evidence,
    sources,
    sourceAccess,
    focus,
    refs,
    includedSections: included,
    withheldSections: withheld
  };
  const protectedKey: ProtectedKey | null = record && !keyAuthorized ? { correctAnswer: record.correctAnswer, solutionSteps: [...record.solutionSteps], questionStem: record.stem } : null;
  // Never part of the context (so never serializable into a prompt or log by accident): only the validator reads these.
  const leakCheckTokens = [...internalTokens].filter((t) => t.length >= TUTOR_CONTEXT_LIMITS.MIN_INTERNAL_TOKEN_CHARS);
  return { kind: "context", context, scope, protectedKey, internalTokens: leakCheckTokens };
}

/** A stable digest of what a context contained - for audit, never for reconstruction. */
export function digestTutorContext(context: TutorContext): string {
  return createHash("sha256").update(JSON.stringify(context), "utf8").digest("hex");
}
