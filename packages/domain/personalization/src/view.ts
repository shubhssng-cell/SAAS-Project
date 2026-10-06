import { PERSONALIZATION_CONFLICT_RULES, explainDecision, type ConflictRule, type PersonalizationDecision } from "./decisions.js";
import { PREFERENCE_FIELDS, type StudentPreferences } from "./preferences.js";

/**
 * The read-only personalization view for ONE student in ONE exam (Phase 8 Unit 4). It lists the student's
 * explicit preferences (and says which are defaults), every decision with its input and rule, and the
 * fixed conflict rules. It is deliberately NOT a profile: there is no score, no type, no category and no
 * summary of the student, it contains no training evidence (no personalization rule reads any - evidence
 * drives the EXISTING adaptive engines, not this layer), and it carries no student id, enrollment id or
 * internal field. It is derived on every call and stored nowhere.
 */
export interface PersonalizationView {
  examCode: string;
  preferences: Array<{ field: string; value: string | null; source: "explicit" | "default" }>;
  decisions: Array<PersonalizationDecision & { explanation: string }>;
  conflictRules: readonly ConflictRule[];
  /** Always empty: no personalization rule consumes training evidence. Stated, not omitted. */
  evidenceUsed: [];
  evidenceNote: string;
}

export function buildPersonalizationView(input: { examCode: string; preferences: StudentPreferences; decisions: readonly PersonalizationDecision[] }): PersonalizationView {
  return {
    examCode: input.examCode,
    preferences: PREFERENCE_FIELDS.map((field) => ({ field, value: input.preferences[field], source: input.preferences[field] === null ? ("default" as const) : ("explicit" as const) })),
    decisions: input.decisions.map((d) => ({ ...d, explanation: explainDecision(d) })),
    conflictRules: PERSONALIZATION_CONFLICT_RULES,
    evidenceUsed: [],
    evidenceNote: "No personalization rule reads training evidence. What your practice history changes is decided by the existing training engines, separately from your preferences."
  };
}
