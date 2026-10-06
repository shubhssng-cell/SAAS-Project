import { DEFAULT_TUTOR_PRESENTATION, TutorError, type TutorIntent, type TutorOwnershipPort, type TutorPresentation, type TutorRequest } from "@ipmat/tutor";
import { noPreferenceDecision, type PersonalizationDecision } from "./decisions.js";
import type { PreferenceStore, PreferredHelp, StudentPreferences } from "./preferences.js";

/**
 * Preferences -> the tutor's PRESENTATION (language, length). That is the whole interface: the tutor
 * receives a two-field style request and nothing else about the student, so a preference cannot reach
 * the answer-key rule, the context firewall, ownership, exam scope or grounding (property-tested).
 */
export function personalizeTutorRequest(request: TutorRequest, preferences: StudentPreferences): { request: TutorRequest; decisions: PersonalizationDecision[] } {
  const decisions: PersonalizationDecision[] = [];
  if (request.presentation !== undefined) {
    // PRES-0: the request itself already states a presentation; it wins and no stored preference is applied.
    decisions.push({ dimension: "language", rule: "PRES-0", input: { kind: "explicit_request", field: "presentation.language", value: request.presentation.language }, effect: "not_applied", limitedBy: null, output: "the request states its own presentation, which overrides a stored preference" });
    decisions.push({ dimension: "verbosity", rule: "PRES-0", input: { kind: "explicit_request", field: "presentation.verbosity", value: request.presentation.verbosity }, effect: "not_applied", limitedBy: null, output: "the request states its own presentation, which overrides a stored preference" });
    return { request, decisions };
  }

  const language = preferences.language;
  if (language !== null && language !== DEFAULT_TUTOR_PRESENTATION.language) {
    decisions.push({ dimension: "language", rule: "LANG-1", input: { kind: "explicit_preference", field: "language", value: language }, effect: "applied", limitedBy: null, output: `tutor language changed from english to ${language} (the validated English answer is still produced and is shown if the ${language} text fails its checks)` });
  } else {
    decisions.push(noPreferenceDecision("language", language === null ? "no language preference; the tutor answers in English" : "language preference equals the default; no change"));
  }

  const verbosity = preferences.verbosity;
  if (verbosity !== null && verbosity !== DEFAULT_TUTOR_PRESENTATION.verbosity) {
    decisions.push({ dimension: "verbosity", rule: "VERB-1", input: { kind: "explicit_preference", field: "verbosity", value: verbosity }, effect: "applied", limitedBy: null, output: verbosity === "concise" ? "tutor length changed from standard to concise (only the parts the mode requires)" : "tutor length changed from standard to detailed (the optional 'tryNext' part is allowed)" });
  } else {
    decisions.push(noPreferenceDecision("verbosity", verbosity === null ? "no length preference; standard length" : "length preference equals the default; no change"));
  }

  const presentation: TutorPresentation = { language: language ?? DEFAULT_TUTOR_PRESENTATION.language, verbosity: verbosity ?? DEFAULT_TUTOR_PRESENTATION.verbosity };
  // With nothing to apply the request is returned UNCHANGED (same object), which is how "no preference = existing behaviour" is guaranteed.
  const changed = presentation.language !== DEFAULT_TUTOR_PRESENTATION.language || presentation.verbosity !== DEFAULT_TUTOR_PRESENTATION.verbosity;
  return { request: changed ? { ...request, presentation } : request, decisions };
}

const HELP_TO_INTENT: Readonly<Record<PreferredHelp, TutorIntent>> = { hint: "give_hint", guided_question: "guide_with_question", explanation: "explain_question" };

/**
 * Chooses the tutor intent for a request that may not name one. An explicit intent ALWAYS wins (HELP-0).
 * With none, a stored help preference maps to an existing intent (HELP-1); with no preference the result
 * is `null` - the caller must choose, nothing is assumed. The mapped intent's own policy then governs
 * disclosure (HELP-2): an explanation chosen before a submitted attempt gets no solution.
 */
export function resolveHelpIntent(input: { preferences: StudentPreferences; requestedIntent?: TutorIntent | undefined; hasSubmittedAttempt: boolean }): { intent: TutorIntent | null; decision: PersonalizationDecision } {
  if (input.requestedIntent !== undefined) {
    return { intent: input.requestedIntent, decision: { dimension: "help_mode", rule: "HELP-0", input: { kind: "explicit_request", field: "intent", value: input.requestedIntent }, effect: "not_applied", limitedBy: null, output: "the request names its intent, which overrides any stored help preference" } };
  }
  const pref = input.preferences.preferredHelp;
  if (pref === null) return { intent: null, decision: noPreferenceDecision("help_mode", "no help preference and no intent named; the caller must choose") };
  const intent = HELP_TO_INTENT[pref];
  const limited = pref === "explanation" && !input.hasSubmittedAttempt;
  return {
    intent,
    decision: {
      dimension: "help_mode",
      rule: limited ? "HELP-2" : "HELP-1",
      input: { kind: "explicit_preference", field: "preferredHelp", value: pref },
      effect: limited ? "limited" : "applied",
      limitedBy: limited ? "answer_key_policy" : null,
      output: limited ? `intent set to ${intent}; the answer key stays withheld until a submitted attempt, so it explains the question without solving it` : `intent set to ${intent}`
    }
  };
}

/**
 * Loads the preferences of the student who OWNS the enrollment - never of an id the caller merely names.
 * The ownership check is the tutor's own port; a missing and a foreign enrollment are one refusal (no
 * enumeration), and the preference read is keyed by the verified student only.
 */
export async function loadPreferencesForRequest(deps: { ownership: TutorOwnershipPort; store: PreferenceStore }, request: { studentId: string; enrollmentId: string }): Promise<{ preferences: StudentPreferences; studentId: string; examCode: string }> {
  const scope = await deps.ownership.resolveEnrollment(request.studentId, request.enrollmentId);
  if (!scope || scope.studentId !== request.studentId || scope.enrollmentId !== request.enrollmentId) throw new TutorError("ownership_denied", "this enrollment is not available to this student");
  return { preferences: await deps.store.get(scope.studentId), studentId: scope.studentId, examCode: scope.examCode };
}

/** Ownership-verified load, then personalization of the request. The request's own `studentId` is what was verified. */
export async function personalizeVerifiedTutorRequest(deps: { ownership: TutorOwnershipPort; store: PreferenceStore }, request: TutorRequest): Promise<{ request: TutorRequest; decisions: PersonalizationDecision[]; preferences: StudentPreferences }> {
  const { preferences } = await loadPreferencesForRequest(deps, request);
  const out = personalizeTutorRequest(request, preferences);
  return { ...out, preferences };
}
