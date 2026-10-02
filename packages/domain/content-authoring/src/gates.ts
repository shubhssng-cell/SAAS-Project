import { validateDnaClassification, type HistoricalDnaClassification, type HistoricalIssue } from "@ipmat/examiner-intelligence";
import {
  decidePublication,
  PublicationDecisionError,
  requiresHumanReview,
  type ExamRelevance,
  type ProvenanceSourceType
} from "@ipmat/question-engine";
import {
  checkDuplicateRisk,
  compareReverification,
  validateNoAnswerLeakageInStem,
  validateNoCompletenessClaims,
  validateSingleCorrectAnswer,
  verifyComputation,
  type ValidationIssue
} from "@ipmat/validation";
import { computeContentFingerprint } from "./fingerprint.js";
import { GATE_NAMES, type AuthoredQuestion, type GateContext, type GateName, type GateReason, type GateReport, type GateResult } from "./types.js";

/**
 * Layered validation gates (docs/DECISIONS.md D-084). Each gate establishes
 * ONE narrow thing and reports it with stable machine-readable reason codes;
 * there is no giant boolean. Passing every gate establishes only that no
 * known check blocks publication - it does NOT establish that the question is
 * exam-faithful or pedagogically good, and is never presented as such.
 *
 * Pure and deterministic: no clock, no I/O, no model call. `evaluateGates`
 * never throws on a malformed question - it reports.
 */

const RELEVANCE: Record<ExamRelevance, true> = { core: true, peripheral: true, stretch: true };
const SOURCE_TYPES: Record<ProvenanceSourceType, true> = { original: true, licensed: true, public_domain: true, open_license: true, official: true, user_authorized: true };
const MIN_BODY_LENGTH = 20;

/**
 * A narrow guard, NOT a rights determination: it refuses a source reference
 * that names a well-known unauthorized-distribution channel. It cannot tell
 * you a source IS authorized; the rights gate's real requirement is an
 * explicit license reference for anything not original/public-domain.
 */
const UNAUTHORIZED_SOURCE_MARKER = /(t\.me\/|telegram|torrent|libgen|z-?library|sci-?hub|pirat)/i;

const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";

/** Which gate each Prompt-2 DNA issue code belongs to. */
const DNA_ISSUE_GATE: Record<string, GateName> = {
  exam_mismatch: "dna",
  contradictory_metadata: "dna",
  duplicate_entries: "dna",
  invalid_testing_modes: "dna",
  unknown_trap: "dna",
  unknown_section: "concept",
  unknown_chapter: "concept",
  unknown_concept: "concept",
  concept_not_in_chapter: "concept",
  unknown_pattern_family: "pattern",
  invalid_difficulty: "difficulty_novelty",
  invalid_novelty: "difficulty_novelty",
  invalid_expected_time: "expected_time",
  missing_metadata: "metadata"
};

const reason = (code: string, field: string, message: string): GateReason => ({ code, field, message });
const fromValidation = (issues: ValidationIssue[]): GateReason[] => issues.map((i) => reason(i.code, i.field, i.message));
const result = (gate: GateName, reasons: GateReason[], settledByHuman = false): GateResult => ({
  gate,
  status: reasons.length === 0 ? "passed" : settledByHuman ? "requires_human" : "failed",
  reasons
});

type CandidateLike = Parameters<typeof validateSingleCorrectAnswer>[0];
const asCandidate = (q: AuthoredQuestion): CandidateLike =>
  ({
    blueprintId: q.id,
    stem: q.content.body,
    answerFormat: q.content.answerFormat,
    options: q.content.options.length > 0 ? q.content.options : null,
    correctAnswer: q.content.correctAnswer,
    explanation: "",
    solutionSteps: q.content.solutionSteps,
    reasoning: "",
    groundTruthDerivation: q.content.groundTruthDerivation ?? { computation: "0", expectedAnswer: 0 },
    questionDna: q.dna
  }) as unknown as CandidateLike;

/** Coerces the list-valued fields a malformed question might get wrong, so evaluation reports instead of throwing. */
function sanitize(q: AuthoredQuestion): AuthoredQuestion {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  return {
    ...q,
    dna: { ...q.dna, subconcepts: arr(q.dna?.subconcepts), prerequisites: arr(q.dna?.prerequisites), combinesWithConcepts: arr(q.dna?.combinesWithConcepts) } as AuthoredQuestion["dna"],
    content: { ...q.content, options: arr(q.content?.options), solutionSteps: arr(q.content?.solutionSteps), body: typeof q.content?.body === "string" ? q.content.body : "", correctAnswer: typeof q.content?.correctAnswer === "string" ? q.content.correctAnswer : "" },
    source: q.source ?? ({ sourceType: undefined } as never)
  };
}

export function evaluateGates(input: AuthoredQuestion, ctx: GateContext): GateReport {
  const q = sanitize(input);
  let dnaIssues: HistoricalIssue[];
  try {
    dnaIssues = validateDnaClassification(q.dna as unknown as HistoricalDnaClassification, {
      pack: ctx.pack,
      patternFamilies: ctx.patternFamilies,
      errorTaxonomyCodes: ctx.errorTaxonomyCodes
    });
  } catch {
    dnaIssues = [{ code: "contradictory_metadata", field: "dna", message: "the DNA is malformed and could not be evaluated" }];
  }
  const dnaReasons = (gate: GateName): GateReason[] =>
    dnaIssues.filter((i) => (DNA_ISSUE_GATE[i.code] ?? "dna") === gate).map((i) => reason(i.code, i.field, i.message));

  // 1. structure - the content is a well-formed question
  const structure: GateReason[] = [];
  const { content } = q;
  if (blank(content.body) || content.body.trim().length < MIN_BODY_LENGTH) structure.push(reason("body_too_short", "content.body", `the question body must be at least ${MIN_BODY_LENGTH} characters`));
  if (content.answerFormat !== "multiple_choice" && content.answerFormat !== "numeric_entry") structure.push(reason("invalid_answer_format", "content.answerFormat", "answerFormat must be multiple_choice or numeric_entry"));
  if (blank(content.correctAnswer)) structure.push(reason("missing_correct_answer", "content.correctAnswer", "a correct answer is required"));
  if (!Array.isArray(content.solutionSteps) || content.solutionSteps.length === 0 || content.solutionSteps.some(blank)) structure.push(reason("missing_solution_steps", "content.solutionSteps", "at least one non-blank solution step is required"));
  if (content.answerFormat === "multiple_choice") {
    structure.push(...fromValidation(validateSingleCorrectAnswer(asCandidate(q)).issues));
  } else if (content.answerFormat === "numeric_entry" && content.options.length > 0) {
    structure.push(reason("numeric_entry_has_options", "content.options", "a numeric_entry question must not carry options"));
  }
  if (!blank(content.body) && !blank(content.correctAnswer)) {
    structure.push(...fromValidation(validateNoAnswerLeakageInStem(asCandidate(q)).issues));
    structure.push(...fromValidation(validateNoCompletenessClaims(asCandidate(q)).issues));
  }

  // 2. metadata - required fields are present and known
  const metadata: GateReason[] = [...dnaReasons("metadata")];
  if (blank(q.id)) metadata.push(reason("missing_id", "id", "a question needs a stable id"));
  if (!RELEVANCE[q.dna.examRelevance]) metadata.push(reason("unknown_exam_relevance", "dna.examRelevance", `unknown exam relevance "${String(q.dna.examRelevance)}" (an editorial label only)`));
  if (q.origin !== "human_authored" && q.origin !== "ai_generated" && q.origin !== "unknown") metadata.push(reason("unknown_origin", "origin", "origin must be human_authored, ai_generated or unknown"));

  // 8. answer - correctness is established independently of the generator
  const answer = answerGate(q);

  // 9. identity - one logical question, one identity
  const identity = identityGate(q, ctx);

  // 10. provenance and rights
  const provenance = provenanceGate(q);

  // 11. review
  const review = reviewGate(q);

  const byGate: Record<GateName, GateResult> = {
    structure: result("structure", structure),
    metadata: result("metadata", metadata),
    dna: result("dna", dnaReasons("dna")),
    concept: result("concept", dnaReasons("concept")),
    pattern: result("pattern", dnaReasons("pattern")),
    difficulty_novelty: result("difficulty_novelty", dnaReasons("difficulty_novelty")),
    expected_time: result("expected_time", dnaReasons("expected_time")),
    answer,
    identity,
    provenance,
    review
  };
  const gates = GATE_NAMES.map((name) => byGate[name]);
  const failed = gates.filter((g) => g.status === "failed").map((g) => g.gate);
  const requiresHuman = gates.filter((g) => g.status === "requires_human").map((g) => g.gate);

  let lifecycleAllows = false;
  try {
    decidePublication("publish", { currentValidationState: q.validationState, difficultyTier: q.dna.difficultyTier, hasProvenance: provenance.status === "passed" });
    lifecycleAllows = true;
  } catch (error) {
    if (!(error instanceof PublicationDecisionError)) throw error;
  }
  return { questionId: q.id, gates, failed, requiresHuman, publishable: failed.length === 0 && requiresHuman.length === 0 && lifecycleAllows };
}

function answerGate(q: AuthoredQuestion): GateResult {
  const { groundTruthDerivation: derivation, correctAnswer } = q.content;
  const verifiedByReviewer = q.review?.answerVerifiedByReviewer === true && !blank(q.review.reviewedBy);

  if (derivation !== null) {
    if (typeof derivation.expectedAnswer !== "number" || !Number.isFinite(derivation.expectedAnswer) || blank(derivation.computation)) {
      return result("answer", [reason("malformed_derivation", "content.groundTruthDerivation", "a derivation needs a computation and a finite expected answer")]);
    }
    const computed = verifyComputation({ computation: derivation.computation, expectedAnswer: derivation.expectedAnswer, correctAnswer });
    // A failed deterministic recomputation is final: no reviewer can override arithmetic that does not match.
    if (!computed.valid) return result("answer", fromValidation(computed.issues));
    if (q.origin !== "human_authored" && !verifiedByReviewer) {
      if (q.independentReverification === null) {
        return result("answer", [reason("ai_answer_needs_independent_check", "independentReverification", "an AI-generated answer is never trusted on the generator's word: it needs an independent re-derivation or a reviewer's verification")], true);
      }
      const compared = compareReverification({ candidateAnswer: correctAnswer, reDerivedAnswer: q.independentReverification.derivedAnswer });
      if (!compared.valid) return result("answer", fromValidation(compared.issues));
    }
    return result("answer", []);
  }
  if (verifiedByReviewer) return result("answer", []);
  return result("answer", [reason("no_deterministic_derivation", "content.groundTruthDerivation", "the answer cannot be recomputed deterministically; a named reviewer must verify it")], true);
}

function identityGate(q: AuthoredQuestion, ctx: GateContext): GateResult {
  const others = ctx.existing.filter((e) => e.id !== q.id && e.validationState !== "rejected");
  const fingerprint = computeContentFingerprint(q.dna.examCode, q.content.body, q.content.options);
  const exact = others.find((e) => e.fingerprint === fingerprint);
  if (exact) return result("identity", [reason("exact_duplicate", "content.body", `identical to existing question ${exact.id} (same wording and options) - one logical question must have one identity`)]);
  const near = checkDuplicateRisk(q.content.body, others.map((e) => e.body));
  if (!near.valid) {
    if (q.review?.reviewedAsDistinct === true && !blank(q.review.reviewedBy)) return result("identity", []);
    return result("identity", [reason("near_duplicate", "content.body", near.issues[0]!.message + " - never merged automatically; a reviewer must confirm it is genuinely distinct")], true);
  }
  return result("identity", []);
}

function provenanceGate(q: AuthoredQuestion): GateResult {
  const { source } = q;
  const reasons: GateReason[] = [];
  if (!SOURCE_TYPES[source.sourceType]) {
    reasons.push(reason("unknown_source_type", "source.sourceType", `unknown source type "${String(source.sourceType)}"`));
    return result("provenance", reasons);
  }
  if (source.sourceType !== "original") {
    if (blank(source.sourceRef)) reasons.push(reason("source_ref_required", "source.sourceRef", "a non-original source must be traceable: a source reference is required"));
    if (source.sourceType !== "public_domain" && blank(source.licenseRef)) reasons.push(reason("license_ref_required", "source.licenseRef", "a rights basis (license reference) is required unless the source is public domain - free-to-access is not free-to-copy"));
  }
  if (q.origin === "ai_generated" && blank(source.sourceRef)) reasons.push(reason("ai_generation_reference_required", "source.sourceRef", "AI-generated content must reference its generation record"));
  for (const [field, value] of [["source.sourceRef", source.sourceRef], ["source.licenseRef", source.licenseRef], ["source.attributedTo", source.attributedTo]] as const) {
    if (typeof value === "string" && UNAUTHORIZED_SOURCE_MARKER.test(value)) reasons.push(reason("unauthorized_source_marker", field, "the reference names a known unauthorized-distribution channel; such content must not be ingested"));
  }
  return result("provenance", reasons);
}

function reviewGate(q: AuthoredQuestion): GateResult {
  const reasons: GateReason[] = [];
  if (q.validationState === "human_reviewed" && q.review === null) {
    return result("review", [reason("review_record_missing", "review", "human_reviewed requires a review record")]);
  }
  if (q.review !== null && (blank(q.review.reviewedBy) || typeof q.review.reviewedAt !== "string" || Number.isNaN(Date.parse(q.review.reviewedAt)))) {
    return result("review", [reason("review_record_invalid", "review", "a review record needs a named reviewer and an ISO date")]);
  }
  if (requiresHumanReview(q.dna.difficultyTier) && q.validationState !== "human_reviewed" && q.validationState !== "published") {
    return result("review", [reason("human_review_required", "validationState", `difficulty tier "${q.dna.difficultyTier}" requires human review before publication`)], true);
  }
  if (requiresHumanReview(q.dna.difficultyTier) && q.validationState === "published" && q.review === null) {
    return result("review", [reason("review_record_missing", "review", `a "${q.dna.difficultyTier}" question must carry its review record`)]);
  }
  return { gate: "review", status: requiresHumanReview(q.dna.difficultyTier) ? "passed" : "not_applicable", reasons };
}
