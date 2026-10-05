import type { EpistemicClass, TutorOutcome, TutorResponse } from "./types.js";

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
    message: response.text ?? response.fallbackMessage ?? "",
    hypotheses: response.hypotheses.map((h) => ({ label: "AI hypothesis" as const, text: h.text })),
    basedOn: response.evidenceReferences.map((e) => ({ label: e.label, kind: e.epistemic })),
    sources: response.sourceReferences.map((s) => ({ title: s.title, location: s.location })),
    missing: [...response.uncertainty.missing]
  };
}
