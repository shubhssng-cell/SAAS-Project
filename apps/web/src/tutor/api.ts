import type { AuthFailure } from "../auth/failureMapping.js";
import { jsonRequest, type FetchLike } from "../http.js";

/**
 * The ONLY place `apps/web` talks to the tutor and preference endpoints (Phase 9 Unit 2, D-098). The browser sends one named
 * operation plus the question/concept it is about; it never sends - and the server would refuse - a student id, an enrollment id,
 * an exam code, a capability, a workflow, a role or a presentation. Responses are read field by field into the closed shapes below,
 * so anything unexpected the server might add is dropped here rather than rendered.
 */
export const TUTOR_OPERATIONS = ["explain_question", "give_hint", "guide_with_question", "explain_mistake", "clarify_solution"] as const;
export type TutorOperation = (typeof TUTOR_OPERATIONS)[number];

export interface TutorAnswer {
  status: "answered" | "not_answered";
  mode: string;
  message: string;
  question: string | null;
  parts: Array<{ label: string; text: string }>;
  hypotheses: string[];
  basedOn: string[];
  preferenceNotes: string[];
  failureMessage: string | null;
}

export type TutorResult = { ok: true; answer: TutorAnswer } | { ok: false; failure: AuthFailure };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function readTutorAnswer(body: unknown): TutorAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.status !== "answered" && b.status !== "not_answered") return null;
  const tutor = typeof b.tutor === "object" && b.tutor !== null ? (b.tutor as Record<string, unknown>) : null;
  const failure = typeof b.failure === "object" && b.failure !== null ? (b.failure as Record<string, unknown>) : null;
  const parts = Array.isArray(tutor?.parts) ? (tutor!.parts as unknown[]).flatMap((p) => (typeof p === "object" && p !== null && typeof (p as Record<string, unknown>).label === "string" && typeof (p as Record<string, unknown>).text === "string" ? [{ label: (p as { label: string }).label, text: (p as { text: string }).text }] : [])) : [];
  const hypotheses = Array.isArray(tutor?.hypotheses) ? (tutor!.hypotheses as unknown[]).flatMap((h) => (typeof h === "object" && h !== null && typeof (h as Record<string, unknown>).text === "string" ? [(h as { text: string }).text] : [])) : [];
  const basedOn = Array.isArray(tutor?.basedOn) ? (tutor!.basedOn as unknown[]).flatMap((s) => (typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).label === "string" ? [(s as { label: string }).label] : [])) : [];
  const message = typeof tutor?.message === "string" && tutor.message !== "" ? tutor.message : typeof failure?.message === "string" ? failure.message : "";
  return {
    status: b.status,
    mode: typeof tutor?.mode === "string" ? tutor.mode : "",
    message,
    question: typeof tutor?.question === "string" ? tutor.question : null,
    parts,
    hypotheses,
    basedOn,
    preferenceNotes: strings(b.preferenceNotes),
    failureMessage: typeof failure?.message === "string" ? failure.message : null
  };
}

export async function apiAskTutor(operation: TutorOperation, questionId: string, fetchImpl: FetchLike = fetch): Promise<TutorResult> {
  const result = await jsonRequest(fetchImpl, "POST", "/v1/tutor/ask", { operation, questionId });
  if (!result.ok) return result;
  const answer = readTutorAnswer(result.body);
  return answer ? { ok: true, answer } : { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
}

export const TUTOR_LANGUAGES = ["english", "hindi", "hinglish"] as const;
export const TUTOR_VERBOSITIES = ["concise", "standard", "detailed"] as const;
export interface Preferences {
  language: string | null;
  verbosity: string | null;
  preferredHelp: string | null;
}
export type PreferencesResult = { ok: true; preferences: Preferences } | { ok: false; failure: AuthFailure };

function readPreferences(body: unknown): Preferences | null {
  const p = typeof body === "object" && body !== null ? (body as { preferences?: unknown }).preferences : null;
  if (typeof p !== "object" || p === null) return null;
  const r = p as Record<string, unknown>;
  const f = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return { language: f(r.language), verbosity: f(r.verbosity), preferredHelp: f(r.preferredHelp) };
}

export async function apiGetPreferences(fetchImpl: FetchLike = fetch): Promise<PreferencesResult> {
  const result = await jsonRequest(fetchImpl, "GET", "/v1/preferences");
  if (!result.ok) return result;
  const preferences = readPreferences(result.body);
  return preferences ? { ok: true, preferences } : { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
}

export async function apiUpdatePreferences(patch: Partial<Preferences>, fetchImpl: FetchLike = fetch): Promise<PreferencesResult> {
  const result = await jsonRequest(fetchImpl, "PUT", "/v1/preferences", patch);
  if (!result.ok) return result;
  const preferences = readPreferences(result.body);
  return preferences ? { ok: true, preferences } : { ok: false, failure: { kind: "unexpected", message: "Something went wrong. Please try again." } };
}
