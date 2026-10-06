import type { TutorResponseAiOutput } from "@ipmat/ai";
import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import type { ProtectedKey } from "./context.js";
import { TUTOR_INTENT_POLICIES } from "./policy.js";
import type { GroundingReport, GroundingViolation, TutorContext } from "./types.js";

/**
 * The deterministic grounding validator (docs/DECISIONS.md D-092).
 *
 * A model's output is UNTRUSTED. This function decides - with no model and no
 * network - whether it may reach a student. It is deliberately NARROW and
 * NON-SEMANTIC, in the same spirit as D-029's answer-leak check: it verifies
 * what can be verified mechanically (references exist, claimed relations are
 * in the supplied graph, quotes are verbatim, the key is not asserted, no
 * identifier or foreign-exam name appears, no psychological/mastery/readiness
 * claim is made, an exam rule is only stated if retrieved source text states
 * it) and says plainly what it cannot. It does NOT understand paraphrase: a
 * model that conveys the key in a way none of these patterns catches would
 * pass. That is why the key is withheld from the prompt in the first place -
 * validation is the second line of defence, never the first.
 *
 * The lexicons are FAIL-CLOSED backstops: they over-reject (a legitimate
 * mention of e.g. a "confidence interval" would be refused) rather than let a
 * claim the system cannot support reach a student.
 */
export interface GroundingOptions {
  /** Codes/names of the exams OTHER than this enrollment's. A mention of any is cross-exam content. */
  foreignExamTerms?: readonly string[];
  /** The key the policy withheld (so leakage can be detected). Null when disclosure was authorized. */
  protectedKey: ProtectedKey | null;
  /** Own ids and internal tokens that must never appear in a response. */
  internalTokens?: readonly string[];
  /** Wording the student REJECTED or corrected: it must not be proposed again. */
  rejectedTerms?: readonly string[];
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export const PSYCHOLOGICAL_PATTERNS: readonly RegExp[] = [
  /\byou(?:'re|\s+are|\s+seem|\s+appear)?\s+(?:weak|bad|poor|terrible|slow|lazy|careless|anxious|nervous|stressed|scared|afraid|unconfident|overconfident|underconfident)\b/i,
  /\bpanick?(?:ed|ing|s)?\b|\banxi(?:ous|ety)\b|\bnervous(?:ness)?\b|\bstress(?:ed|ful)?\b|\bconfiden(?:ce|t)\b|\bmotivat(?:ed|ion)\b|\blazy\b|\bcareless(?:ness)?\b|\bintelligen(?:ce|t)\b|\btalent(?:ed)?\b|\bfear(?:ful)?\b|\bworr(?:y|ied)\b|\bfrustrat(?:ed|ion)\b/i,
  /\black(?:s|ing)?\s+(?:of\s+)?(?:confidence|focus|discipline|ability|aptitude|talent|understanding)\b/i,
  /\b(?:you|your)\s+(?:always|never|tend to|usually|typically|keep on)\b/i,
  /\b(?:weak|bad|poor)\s+(?:at|in|with)\b/i,
  /\byou\s+(?:don'?t|do not|didn'?t|did not)\s+(?:really\s+)?(?:understand|know|get)\b/i,
  /\byou\s+struggle\b|\bstruggl(?:e|es|ing)\s+with\b/i,
  /\byour\s+(?:problem|issue|weakness|nature|personality|mindset|attitude)\b/i
];

export const MASTERY_READINESS_PATTERNS: readonly RegExp[] = [
  /\bmaster(?:y|ed)\b/i,
  /\breadiness\b|\b(?:exam|test)[- ]ready\b|\bready (?:for|to take) (?:the |your )?(?:exam|test|ipmat)\b/i,
  /\b(?:you(?:'re|\s+are)|are you)\s+(?:not\s+)?(?:ready|on track|prepared)\b/i,
  /\bon track\b/i,
  /\b(?:likely|probable|probability|chances?|odds)\b[^.]{0,60}\b(?:score|selected|selection|admission|pass|clear|rank|cut-?off)\b/i,
  /\byou(?:'ll|\s+will)\s+(?:score|pass|clear|crack|get selected|get in)\b/i,
  /\b(?:strength|strengths|weakness|weaknesses)\b/i,
  /\b\d{1,3}\s?%\s+(?:mastery|ready|readiness|prepared)\b/i
];

export const EXAM_RULE_PATTERNS: readonly RegExp[] = [
  /\bnegative marking\b|\bmarks?\s+(?:per|for each)\s+(?:question|correct|wrong|incorrect)\b|\b[+-]?\d+\s*marks?\s+(?:for|per|each)\b/i,
  /\btime limit\b|\bduration of the (?:exam|paper|test|section)\b|\b(?:exam|paper|test|section)\s+duration\b|\b\d+\s*(?:minutes|mins|hours?)\s+(?:for|per|to (?:complete|attempt))\s+(?:the\s+|each\s+)?(?:section|paper|exam|test)\b/i,
  /\b(?:the\s+)?(?:ipmat|exam|paper|test)\s+(?:has|contains|consists of|includes|comprises|is divided into)\b/i,
  /\bcut-?offs?\b|\bsyllabus\s+(?:includes|covers|contains)\b|\bnumber of (?:questions|sections)\b|\bsectional\b/i
];

/** A causal claim about WHY the student erred, which is only the student's to confirm (D-006). */
const CAUSAL_CLAIM = /\b(?:the|your|this)\s+(?:reason|cause)\b[^.?]{0,60}\b(?:is|was)\b|\b(?:this|it)\s+(?:happened|went wrong)\s+because\s+you\b|\byou\s+(?:got|answered)\s+(?:this|it)\s+wrong\s+because\b/i;
const CONFIRMATION_CLAIM = /\byou(?:'ve|\s+have)?\s+(?:confirmed|told us|agreed)\b|\bconfirmed\s+(?:that|diagnosis)\b/i;

const HEDGE = /\b(?:may|might|could|possibly|perhaps|looks like|seems|appears|one possibility|is it that)\b|\?/i;
const VERDICT_CUE = /\b(?:answer|correct|right|solution|result|equals?|therefore|thus|final|key|gives?|get|choose|select|pick|option)\b|=/i;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sentences = (text: string): string[] => text.split(/(?<=[.!?\n])\s+/).filter((s) => s.trim().length > 0);

/** A whole-token match: not embedded in a longer alphanumeric/decimal token. */
function hasWholeToken(haystack: string, token: string): boolean {
  if (token.trim().length === 0) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}.,])${escapeRe(token.trim())}(?![\\p{L}\\p{N}])`, "iu").test(haystack);
}

function keyAsserted(text: string, key: ProtectedKey): boolean {
  const k = key.correctAnswer.trim();
  if (k.length === 0) return false;
  // A value that the stem itself already contains cannot be told apart from a restatement of the stem: skipped (documented gap).
  const inStem = hasWholeToken(key.questionStem, k);
  const letterKey = /^[A-Da-d]$/.test(k);
  for (const sentence of sentences(text)) {
    if (letterKey) {
      const L = k.toUpperCase();
      if (new RegExp(`\\b(?:option|choice|answer|alternative)\\s*(?:is|=|:)?\\s*\\(?${L}\\)?(?![A-Za-z])|\\(${L}\\)`, "").test(sentence)) return true;
    } else if (!inStem && hasWholeToken(sentence, k) && VERDICT_CUE.test(sentence)) {
      return true;
    }
  }
  return false;
}

function solutionLeaked(text: string, key: ProtectedKey): boolean {
  const t = norm(text);
  return key.solutionSteps.some((step) => {
    const s = norm(step);
    return s.length >= 15 && t.includes(s);
  });
}

const trimToken = (t: string): string => t.replace(/[.,;:!?)"”]+$/g, "");

/** The authored key is the one ground truth in a keyed response: a stated correct answer must be it, and another option may not be called correct. */
function contradictsKey(text: string, context: TutorContext): boolean {
  const key = context.answerKey?.correctAnswer;
  if (!key) return false;
  const nk = norm(key);
  const stated = /(?<!\byour\s)(?<!\bsubmitted\s)(?<!\bchosen\s)\b(?:(?:correct|right|keyed)\s+(?:answer|option|choice)|answer)\s*(?:is|=|:)\s*["“(]?([^\s"”;]+)/gi;
  for (const m of text.matchAll(stated)) {
    const token = norm(trimToken(m[1] ?? ""));
    if (token.length > 0 && !nk.startsWith(token)) return true;
  }
  for (const option of context.question?.options ?? []) {
    if (norm(option) === nk) continue;
    if (new RegExp(`(?<![\\p{L}\\p{N}.,])${escapeRe(option.trim())}(?![\\p{L}\\p{N}])\\s+(?:is|would be)\\s+(?:the\\s+)?(?:correct|right)\\b`, "iu").test(text)) return true;
  }
  return false;
}

export function validateTutorGrounding(context: TutorContext, output: TutorResponseAiOutput, options: GroundingOptions): GroundingReport {
  const policy = TUTOR_INTENT_POLICIES[context.intent];
  const violations: GroundingViolation[] = [];
  const checksRun: string[] = [];
  const add = (code: GroundingViolation["code"], detail: string) => violations.push({ code, detail });
  const refSet = new Set(context.refs.map((r) => r.ref));
  const insufficient = output.responseType === "insufficient_context";

  const parts = output.parts ?? {};
  const step = output.socraticStep;
  const keyAuthorized = context.answerKey !== null;
  const allText = [
    output.text,
    ...output.hypotheses.map((h) => h.text),
    ...[parts.asked, parts.concept, parts.whyCorrect, parts.whyIncorrectPathFails, parts.takeaway, parts.tryNext].filter((x): x is string => typeof x === "string"),
    ...(parts.steps ?? []),
    ...(step ? [step.checks, step.question, step.learnsFromReply] : [])
  ].join("\n");

  checksRun.push("response_type_allowed");
  if (!policy.allowedResponseTypes.includes(output.responseType)) add("disallowed_response_type", `responseType "${output.responseType}" is not permitted for intent "${context.intent}"`);

  checksRun.push("references_exist");
  for (const c of output.citations) if (!refSet.has(c)) add("unknown_reference", `cited reference is not in the supplied context: ${c.slice(0, 60)}`);
  for (const h of output.hypotheses) for (const r of h.evidenceRefs) if (!refSet.has(r)) add("unknown_reference", `hypothesis evidence reference is not in the supplied context: ${r.slice(0, 60)}`);

  if (step) {
    for (const r of step.evidenceRefs) if (!refSet.has(r)) add("unknown_reference", `Socratic evidence reference is not in the supplied context: ${r.slice(0, 60)}`);
  }

  if (!insufficient) {
    checksRun.push("citation_required");
    if (output.citations.length === 0) add("missing_citation", "an answered response must cite at least one supplied reference");
  }

  checksRun.push("hypotheses");
  if (output.hypotheses.length > 0 && !policy.allowHypotheses) add("hypothesis_not_permitted", `intent "${context.intent}" does not permit hypotheses`);
  for (const h of output.hypotheses) {
    if (!HEDGE.test(h.text)) add("unhedged_hypothesis", "a hypothesis must be phrased as a possibility or a question");
    if (!h.evidenceRefs.some((r) => r === "attempt" || r === "diagnosis" || r.startsWith("evidence:"))) add("unknown_reference", "a hypothesis must rest on the student's recorded attempt, their autopsy outcome or supplied evidence");
  }

  checksRun.push("relation_claims");
  const edgeKey = (from: string, to: string, type: string) => `${normalizeConceptNameKey(from)}|${type}|${normalizeConceptNameKey(to)}`;
  const edges = new Set((context.graph?.edges ?? []).map((e) => edgeKey(e.from, e.to, e.type)));
  for (const c of output.relationClaims) if (!edges.has(edgeKey(c.from, c.to, c.type))) add("unsupported_relation", `the relationship "${c.from} ${c.type} ${c.to}" is not in the supplied concept graph`);

  checksRun.push("verbatim_quotes");
  const quotable = norm(
    [
      context.question?.stem ?? "",
      ...(context.question?.options ?? []),
      context.attempt?.workingSteps ?? "",
      context.attempt?.reasoningText ?? "",
      context.diagnosis?.status === "awaiting_confirmation" ? context.diagnosis.hypothesisText : "",
      context.diagnosis?.status === "corrected" ? context.diagnosis.correctionText : "",
      ...context.prior.flatMap((a) => [a.text, a.studentReply ?? ""]),
      context.focus ?? "",
      ...context.sources.map((s) => s.text),
      ...(context.answerKey?.solutionSteps ?? [])
    ].join("\n")
  );
  for (const q of output.questionQuotes) if (!quotable.includes(norm(q))) add("unverifiable_quote", "a quotation does not appear verbatim in the supplied context");

  checksRun.push("answer_key_leakage");
  if (options.protectedKey) {
    if (keyAsserted(allText, options.protectedKey)) add("answer_key_leakage", "the response asserts the keyed answer while disclosure is not authorized");
    if (solutionLeaked(allText, options.protectedKey)) add("solution_leakage", "the response reproduces authored solution steps while disclosure is not authorized");
  }

  checksRun.push("internal_identifier_leakage");
  if (UUID.test(allText)) add("internal_identifier_leakage", "the response contains an internal identifier");
  for (const token of options.internalTokens ?? []) if (allText.toLowerCase().includes(token.toLowerCase())) add("internal_identifier_leakage", "the response contains an internal identifier");

  // Only listed as run when the caller supplied the other exams' names - an absent list is NOT a pass.
  if (options.foreignExamTerms !== undefined) {
    checksRun.push("cross_exam_content");
    for (const term of options.foreignExamTerms) if (term.trim().length > 0 && hasWholeToken(allText, term)) add("cross_exam_content", "the response mentions another exam");
  }

  checksRun.push("psychological_claims");
  if (PSYCHOLOGICAL_PATTERNS.some((p) => p.test(allText))) add("psychological_claim", "the response makes a claim about the student's traits, feelings or mental state");

  checksRun.push("mastery_readiness_claims");
  if (MASTERY_READINESS_PATTERNS.some((p) => p.test(allText))) add("unsupported_mastery_readiness_claim", "the response makes a mastery, readiness, strength/weakness or outcome claim no supplied context supports");

  checksRun.push("exam_rules_need_source");
  const sourceText = context.sources.map((s) => s.text).join("\n");
  for (const p of EXAM_RULE_PATTERNS) if (p.test(allText) && !p.test(sourceText)) add("invented_exam_rule", "the response states an exam rule that no retrieved source text states");

  checksRun.push("attempt_facts");
  if (context.attempt) {
    const a = context.attempt;
    const submitted = a.submittedAnswer?.trim() ?? "";
    if (submitted.length > 0 && !/\s/.test(submitted)) {
      const m = /\byou(?:r)?\s+(?:submitted|chose|selected|picked|answered|marked)(?:\s+(?:answer|option|choice))?(?:\s+(?:was|is|as))?\s*[:-]?\s*["“(]?([^\s"”).,;]+)/i.exec(allText);
      if (m && m[1] && norm(m[1]) !== norm(submitted)) add("misreported_attempt", "the response misstates the answer the student submitted");
    }
    if (a.isCorrect === false && /\byour (?:answer|response)\s+(?:was|is)\s+(?:correct|right)\b/i.test(allText)) add("misreported_attempt", "the response calls an incorrect submission correct");
    if (a.isCorrect === true && /\byour (?:answer|response)\s+(?:was|is)\s+(?:incorrect|wrong)\b/i.test(allText)) add("misreported_attempt", "the response calls a correct submission incorrect");
  }

  checksRun.push("teaching_mode_contract");
  if (!insufficient) {
    const present = (name: string): boolean => {
      const v = (parts as Record<string, unknown>)[name];
      return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.length > 0;
    };
    const anyPart = Object.values(parts).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined));
    if (!policy.partsPermitted && anyPart) add("parts_not_permitted", `a ${policy.teachingMode} carries no worked or structured explanation parts`);
    for (const name of [...policy.requiredParts, ...(keyAuthorized ? policy.requiredPartsWhenKeyAuthorized : [])]) if (!present(name)) add("missing_explanation_part", `the ${policy.teachingMode} contract requires "${name}"`);
    if (!keyAuthorized && policy.partsPermitted) for (const name of policy.forbiddenPartsWhenKeyWithheld) if (present(name)) add("parts_not_permitted", `"${name}" would solve the question while the answer key is withheld`);
    if (policy.requiresSocraticStep) {
      if (!step) add("socratic_step_invalid", "a guided question needs a socraticStep");
      else {
        if (!step.conceptRef.startsWith("concept:") || !refSet.has(step.conceptRef)) add("socratic_step_invalid", "the Socratic step must name a concept from the supplied context");
        const qMarks = (step.question.match(/\?/g) ?? []).length;
        if (qMarks === 0) add("socratic_step_invalid", "the Socratic step's question must be a question");
        if (qMarks > 2) add("socratic_step_invalid", "a Socratic step asks one thing at a time");
        if (!norm(output.text).includes(norm(step.question))) add("socratic_step_invalid", "the shown text must contain the step's question");
      }
    } else if (step) add("socratic_step_invalid", `a ${policy.teachingMode} carries no Socratic step`);
    if (policy.maxTextChars !== null && (output.text.length > policy.maxTextChars || (step?.question.length ?? 0) > policy.maxTextChars)) add("response_too_long", `a ${policy.teachingMode} is limited to ${policy.maxTextChars} characters`);
    const shown = [norm(output.text), ...(step ? [norm(step.question)] : [])];
    if (context.prior.some((a) => shown.includes(norm(a.text)))) add("repeated_teaching_action", "this repeats an earlier action of the interaction");
  }

  checksRun.push("key_consistency");
  if (contradictsKey(allText, context)) add("contradicts_key", "the response states an answer that differs from the authored key");

  checksRun.push("diagnosis_status");
  const d = context.diagnosis;
  if ((!d || d.status !== "confirmed") && CAUSAL_CLAIM.test(allText)) add("unconfirmed_diagnosis_as_fact", "a cause for the student's error is stated without the student having confirmed one");
  if (d?.status === "awaiting_confirmation") {
    if (CONFIRMATION_CLAIM.test(allText)) add("unconfirmed_diagnosis_as_fact", "the response treats an unconfirmed hypothesis as confirmed");
    if (!insufficient && context.intent === "explain_mistake" && output.hypotheses.length === 0) add("unconfirmed_diagnosis_not_queried", "an unconfirmed diagnosis must be put to the student as a hypothesis they can confirm or correct");
  }
  const lowered = norm(allText);
  for (const term of options.rejectedTerms ?? []) if (norm(term).length >= 6 && lowered.includes(norm(term))) add("rejected_diagnosis_reused", "the response repeats wording the student rejected or corrected");

  return { checksRun, violations, passed: violations.length === 0 };
}
