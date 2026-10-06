/**
 * Every personalized decision is explainable as INPUT -> RULE -> OUTPUT (Phase 8 Unit 4, D-095), and the
 * INPUT is always an explicit preference, an explicit request, or nothing - never an inferred attribute
 * and never a hidden rationale. A decision records what changed, or that nothing did and why.
 */
export type PersonalizationDimension = "language" | "verbosity" | "help_mode" | "curriculum" | "revision" | "simulation";

export type RuleId = "LANG-1" | "VERB-1" | "PRES-0" | "HELP-0" | "HELP-1" | "HELP-2" | "CURR-0" | "REV-0" | "SIM-0" | "DEFAULT-0";

export type DecisionInput =
  | { kind: "explicit_preference"; field: string; value: string }
  /** The student's request itself (e.g. they named a tutor intent) - an explicit instruction for THIS moment. */
  | { kind: "explicit_request"; field: string; value: string }
  | { kind: "none" };

export interface PersonalizationDecision {
  dimension: PersonalizationDimension;
  rule: RuleId;
  input: DecisionInput;
  /** `applied`: the preference changed something. `not_applied`: nothing changed (and `output` says why). `limited`: it applied, but a fixed policy bounded it (`limitedBy`). */
  effect: "applied" | "not_applied" | "limited";
  limitedBy: "answer_key_policy" | "grounding_policy" | null;
  output: string;
}

/** The deterministic rules, in one place. There is no weighting, ranking or score among them. */
export const PERSONALIZATION_RULES: Readonly<Record<RuleId, string>> = {
  "LANG-1": "An explicit language preference other than English asks the tutor for the same message in that language. The English answer stays canonical and fully validated; the localized one is shown only if it passes its own checks, else the English is shown.",
  "VERB-1": "An explicit length preference sets the tutor's length request. 'concise' means only the parts the mode requires (checked); 'detailed' allows the optional 'tryNext' part within the same caps; 'standard' is the existing behaviour. Required parts are never omitted.",
  "PRES-0": "A presentation the caller states on the request itself overrides a stored preference for that request.",
  "HELP-0": "An explicit tutor intent in the request always overrides a stored help preference.",
  "HELP-1": "With no explicit intent, the stored help preference maps to the existing intents: hint -> give_hint, guided_question -> guide_with_question, explanation -> explain_question. With no preference, the caller must choose; none is assumed.",
  "HELP-2": "The mapped intent's own policy still governs what may be disclosed. An explanation preference before a submitted attempt is limited by the answer-key policy (no solution is given).",
  "CURR-0": "No preference constrains question selection (none is defined, and training candidates carry no field one could act on), so the curriculum recommendation is passed through unchanged.",
  "REV-0": "No preference constrains revision selection or invents a revision priority, so revision intelligence is passed through unchanged.",
  "SIM-0": "An official exam simulation is never personalized: timing, sections, question counts, marking and navigation come only from the exam configuration.",
  "DEFAULT-0": "No applicable preference: behaviour is exactly the pre-existing behaviour."
};

export interface ConflictRule {
  id: string;
  conflict: string;
  status: "resolved" | "unresolved";
  /** The rule that decides it, or why none exists. */
  resolution: string;
}

/** Every conflict is either decided by a named deterministic rule or recorded as unresolved - never settled by a score. */
export const PERSONALIZATION_CONFLICT_RULES: readonly ConflictRule[] = [
  { id: "C1", conflict: "preference for concise answers vs a mode that requires several parts", status: "resolved", resolution: "VERB-1: the required parts are always present; concise only drops the optional ones." },
  { id: "C2", conflict: "preferred help (e.g. explanation) vs the answer-key policy", status: "resolved", resolution: "HELP-2: the tutor policy wins; the decision is recorded as 'limited' by 'answer_key_policy'." },
  { id: "C3", conflict: "stored preference vs an explicit request on this occasion", status: "resolved", resolution: "HELP-0 / PRES-0: the explicit request wins for that request." },
  { id: "C4", conflict: "any preference vs official exam mechanics (timing, sections, counts, marking, navigation)", status: "resolved", resolution: "SIM-0: simulations are never personalized." },
  { id: "C5", conflict: "language preference vs a localized text that fails validation", status: "resolved", resolution: "LANG-1: the validated English is shown; safety and grounding always win over a language preference." },
  { id: "C6", conflict: "language preference vs source terminology (concept names, exam terms)", status: "unresolved", resolution: "The model is asked to keep concept names and numbers verbatim, and numbers are checked; names are not mechanically checked. No terminology-translation rule is specified." },
  { id: "C7", conflict: "a preference for easier questions vs existing training evidence calling for harder exposure", status: "unresolved", resolution: "No difficulty preference is offered because no rule exists to reconcile it with adaptive evidence; inventing a priority would be an opaque score." },
  { id: "C8", conflict: "accommodations (extra time, pausing) vs official simulation timing", status: "unresolved", resolution: "Accommodations are a separate product/legal policy that is not specified (D-090)." }
];

/** One plain sentence per decision, built only from the decision's own fields. */
export function explainDecision(d: PersonalizationDecision): string {
  const input = d.input.kind === "none" ? "no preference" : `${d.input.field}=${d.input.value}`;
  return `${input} -> ${d.rule}: ${d.output}${d.limitedBy ? ` (limited by ${d.limitedBy})` : ""}`;
}

export const noPreferenceDecision = (dimension: PersonalizationDimension, output: string): PersonalizationDecision => ({ dimension, rule: "DEFAULT-0", input: { kind: "none" }, effect: "not_applied", limitedBy: null, output });
