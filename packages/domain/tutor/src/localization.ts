import type { TutorResponseAiOutput } from "@ipmat/ai";
import type { ProtectedKey } from "./context.js";
import { TUTOR_INTENT_POLICIES } from "./policy.js";
import type { LocalizationReport, TutorContext } from "./types.js";

/**
 * Localization validation (Phase 8 Unit 4, D-095).
 *
 * The English `text` is the canonical message and is validated by the full Unit 1-2 grounding
 * validator. A localized message is an ADD-ON that is shown only if it passes ITS OWN checks;
 * otherwise it is dropped and the English is shown. It can therefore never widen what the
 * English validation cleared - but it is checked less deeply than English, and this module is
 * honest about that:
 *
 *  - LANGUAGE-INDEPENDENT (strict, deterministic): script matches the request; the withheld key is
 *    never present as a whole token (STRICTER than English - no verdict word is needed, because the
 *    English verdict lexicon does not exist in Hindi); authored solution steps are not reproduced; no
 *    identifier, internal token or other-exam name; and every NUMBER in the localized text already
 *    occurs in the English answer or the supplied context (a translation may not add figures).
 *  - LEXICON BACKSTOP (best effort, NOT semantic, NOT complete): the English psychological /
 *    mastery-readiness / exam-rule lexicons applied to the localized text (Hinglish uses English
 *    loanwords), plus the small Hindi/Hinglish lists below. Hindi and especially romanized
 *    Hindi have no standard spelling, so recall is genuinely lower than English; a claim phrased in
 *    words these lists miss is NOT detected. That is why the English text is what was cleared and
 *    the localized text is a labelled, droppable presentation.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export const HINDI_PSYCHOLOGICAL_BACKSTOP: readonly RegExp[] = [
  /आत्म[- ]?विश्वास/,
  /घबरा|चिंत(?:ित|ा)|तनाव/,
  /कमज़?ोर(?!ी\s+से)|कमजोरी|आलसी|लापरवाह|बुद्धिमान|प्रतिभा/,
  /आप\s+हमेशा|आप\s+कभी\s+नहीं|आपकी\s+समस्या/,
  /आपको\s+(?:समझ|पता)\s+नहीं/,
  // Hinglish (romanized): common spellings only.
  /\bghabra\w*|\bkamz?or\w*|\bkamjor\w*|\baalsi\b|\blapar?w?aah?\b|\blaparvah\b|\bbuddhi\w*|\bdimag\b/i,
  /\baap\s+hamesha\b|\baap\s+kabhi\s+nahi\b|\baapki\s+samasya\b|\baapko\s+(?:samajh|pata)\s+nahi\b/i,
  /\btension\b|\bchinta\b/i
];

export const HINDI_MASTERY_READINESS_BACKSTOP: readonly RegExp[] = [
  /परीक्षा\s+के\s+लिए\s+तैयार|तैयार\s+हैं[^।.]{0,30}परीक्षा/,
  /पास\s+हो(?:ंगे|गे)|चयन\s+हो|कमजोर\s+पक्ष|मजबूत\s+पक्ष|ताकत|कमज़ोरी/,
  /\bexam\s+ke\s+liye\s+tayy?a{1,2}r\b|\btayy?a{1,2}r\b[^.]{0,30}\bexam\b/i,
  /\bpass\s+ho\s*(?:ge|jaoge|jayenge)\b|\bselect\s+ho\b|\btaqat\b|\bkamzori\b/i
];

export const HINDI_EXAM_RULE_BACKSTOP: readonly RegExp[] = [/नेगेटिव\s+मार्किंग|कट[- ]?ऑफ|कुल\s+प्रश्न|परीक्षा\s+की\s+अवधि/, /\bnegative\s+marking\b|\bcut-?off\b|\bpariksha\s+ki\s+avadhi\b/i];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeToken = (haystack: string, token: string): boolean => token.trim().length > 0 && new RegExp(`(?<![\\p{L}\\p{N}.,])${escapeRe(token.trim())}(?![\\p{L}\\p{N}])`, "iu").test(haystack);

const asciiDigits = (s: string): string => s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
const numbersIn = (s: string): string[] => (asciiDigits(s).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));

/** Everything the localized text may legitimately draw its numbers from: the validated English answer and the supplied context. */
function allowedNumbers(context: TutorContext, output: TutorResponseAiOutput): Set<string> {
  const parts = output.parts ?? {};
  const step = output.socraticStep;
  const sources: string[] = [
    output.text,
    ...output.hypotheses.map((h) => h.text),
    ...[parts.asked, parts.concept, parts.whyCorrect, parts.whyIncorrectPathFails, parts.takeaway, parts.tryNext].filter((x): x is string => typeof x === "string"),
    ...(parts.steps ?? []),
    ...(step ? [step.checks, step.question, step.learnsFromReply] : []),
    context.question?.stem ?? "",
    ...(context.question?.options ?? []),
    context.attempt?.submittedAnswer ?? "",
    context.attempt?.workingSteps ?? "",
    context.attempt?.reasoningText ?? "",
    context.focus ?? "",
    ...context.prior.flatMap((a) => [a.text, a.studentReply ?? ""]),
    ...context.sources.map((s) => s.text),
    context.answerKey?.correctAnswer ?? "",
    ...(context.answerKey?.solutionSteps ?? []),
    context.concept?.description ?? ""
  ];
  return new Set(sources.flatMap(numbersIn));
}

export interface LocalizationOptions {
  protectedKey: ProtectedKey | null;
  internalTokens?: readonly string[];
  foreignExamTerms?: readonly string[];
  /** The English validators' lexicons, applied to the localized text as well (Hinglish uses English loanwords). */
  englishLexicons: { psychological: readonly RegExp[]; masteryReadiness: readonly RegExp[]; examRules: readonly RegExp[] };
}

export function validateLocalization(context: TutorContext, output: TutorResponseAiOutput, options: LocalizationOptions): LocalizationReport {
  const requested = context.presentation.language;
  if (requested === "english") return { requested, status: "not_requested", codes: [] };
  const localized = output.localizedText;
  if (!localized) return { requested, status: "missing", codes: output.responseType === "insufficient_context" ? [] : ["localized_text_missing"] };

  const codes: string[] = [];
  const add = (c: string) => {
    if (!codes.includes(c)) codes.push(c);
  };

  const hasDevanagari = DEVANAGARI.test(localized);
  if (requested === "hindi" && !hasDevanagari) add("wrong_script");
  if (requested === "hinglish" && hasDevanagari) add("wrong_script");

  const key = options.protectedKey;
  if (key) {
    const k = key.correctAnswer.trim();
    const inStem = k.length > 0 && wholeToken(key.questionStem, k); // the same documented gap as the English check
    const letter = /^[A-Da-d]$/.test(k);
    if (letter) {
      const L = k.toUpperCase();
      if (new RegExp(`\\b(?:option|choice|answer|vikalp|vikalpa)\\s*(?:is|=|:|hai)?\\s*\\(?${L}\\)?(?![A-Za-z])|\\(${L}\\)`).test(localized)) add("localized_key_token");
    } else if (!inStem && wholeToken(asciiDigits(localized), asciiDigits(k))) add("localized_key_token");
    if (key.solutionSteps.some((s) => norm(s).length >= 15 && norm(localized).includes(norm(s)))) add("localized_solution_leak");
  }

  if (UUID.test(localized)) add("localized_identifier");
  for (const t of options.internalTokens ?? []) if (localized.toLowerCase().includes(t.toLowerCase())) add("localized_identifier");
  for (const term of options.foreignExamTerms ?? []) if (term.trim().length > 0 && wholeToken(localized, term)) add("localized_cross_exam");

  const allowed = allowedNumbers(context, output);
  if (numbersIn(localized).some((n) => !allowed.has(n))) add("localized_number_not_in_context");

  if ([...options.englishLexicons.psychological, ...HINDI_PSYCHOLOGICAL_BACKSTOP].some((p) => p.test(localized))) add("localized_psychological_claim");
  if ([...options.englishLexicons.masteryReadiness, ...HINDI_MASTERY_READINESS_BACKSTOP].some((p) => p.test(localized))) add("localized_mastery_readiness_claim");
  const sourceText = context.sources.map((s) => s.text).join("\n");
  if ([...options.englishLexicons.examRules, ...HINDI_EXAM_RULE_BACKSTOP].some((p) => p.test(localized) && !p.test(sourceText))) add("localized_exam_rule");

  return { requested, status: codes.length === 0 ? "validated" : "rejected", codes };
}

/**
 * Concise = ONLY the parts the mode's own contract requires; the optional parts are not offered.
 * Deterministic and checkable. "Detailed" and "standard" add no check (they only ask the model for
 * more or the usual amount, within the same facts and the same caps).
 */
export function conciseViolations(context: TutorContext, output: TutorResponseAiOutput): string[] {
  if (context.presentation.verbosity !== "concise" || output.responseType === "insufficient_context") return [];
  const policy = TUTOR_INTENT_POLICIES[context.intent];
  const required = new Set<string>([...policy.requiredParts, ...(context.answerKey ? policy.requiredPartsWhenKeyAuthorized : [])]);
  const parts = (output.parts ?? {}) as Record<string, unknown>;
  return Object.keys(parts).filter((name) => (Array.isArray(parts[name]) ? (parts[name] as unknown[]).length > 0 : parts[name] !== undefined) && !required.has(name));
}
