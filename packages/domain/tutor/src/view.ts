import type { EpistemicClass, TeachingMode, TutorOutcome, TutorResponse } from "./types.js";

/**
 * The ONLY shape a future route/UI may expose. Built field-by-field: no
 * grounding report, no audit entry (it carries student/enrollment ids and
 * model metadata), no context digest, no chunk ids, no source keys, no
 * violation codes. Unit 1 builds no route; this exists so that when one is
 * built there is exactly one safe thing to serialize (and a test that the
 * unsafe things cannot be reached through it).
 */
export interface StudentTutorView {
  outcome: TutorOutcome;
  /** What kind of help this is (hint, guiding question, ...). */
  mode: TeachingMode;
  /** The single guiding question, for the guided-question mode. The step's internal fields (what is checked, what the reply would show) are not exposed. */
  question: string | null;
  /** Named explanation parts, as written for the student. */
  parts: Array<{ label: string; text: string }>;
  /** Explanation text (AI-generated) or the fixed fallback message. */
  message: string;
  /** Separately labelled, hedged suggestions about the student's own attempt. */
  hypotheses: Array<{ label: "AI hypothesis"; text: string }>;
  /** What the answer drew on, by human label only. */
  basedOn: Array<{ label: string; kind: EpistemicClass }>;
  sources: Array<{ title: string; location: string }>;
  missing: string[];
}

export function toStudentTutorView(response: TutorResponse): StudentTutorView {
  return {
    outcome: response.outcome,
    mode: response.teachingAction.mode,
    question: response.teachingAction.socraticStep?.question ?? null,
    parts: orderedParts(response),
    message: response.text ?? response.fallbackMessage ?? "",
    hypotheses: response.hypotheses.map((h) => ({ label: "AI hypothesis" as const, text: h.text })),
    basedOn: response.evidenceReferences.map((e) => ({ label: e.label, kind: e.epistemic })),
    sources: response.sourceReferences.map((s) => ({ title: s.title, location: s.location })),
    missing: [...response.uncertainty.missing]
  };
}

const PART_LABELS: Array<[keyof NonNullable<TutorResponse["parts"]>, string]> = [
  ["asked", "What the question asks"],
  ["concept", "The idea behind it"],
  ["steps", "Steps"],
  ["whyCorrect", "Why this answer is correct"],
  ["whyIncorrectPathFails", "Why the other path fails"],
  ["takeaway", "Key takeaway"],
  ["tryNext", "Try next"]
];

function orderedParts(response: TutorResponse): Array<{ label: string; text: string }> {
  const parts = response.parts;
  if (!parts) return [];
  return PART_LABELS.flatMap(([key, label]) => {
    const v = parts[key];
    if (Array.isArray(v)) return v.map((text, i) => ({ label: `${label} ${i + 1}`, text }));
    return typeof v === "string" ? [{ label, text: v }] : [];
  });
}
