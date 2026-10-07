import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../../src/http.js";
import { apiAskTutor, apiGetPreferences, apiUpdatePreferences, readTutorAnswer } from "../../src/tutor/api.js";
import { TutorPanelView, type TutorPanelState } from "../../src/tutor/TutorPanel.js";

/**
 * Phase 9 Unit 2 (D-098) -- the web side of the tutor. The client sends one named operation and a question; it narrows every
 * response to a closed set of student-safe fields (so anything extra a server might send is dropped, not rendered); the panel
 * renders loading / answered / not-answered / error states and labels AI text as AI text.
 */
type Recorded = { url: string; init?: RequestInit };
function fakeFetch(status: number, body: unknown, seen: Recorded[] = []): FetchLike {
  return async (url, init) => {
    seen.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

const SERVER_ANSWER = {
  status: "answered",
  tutor: {
    outcome: "answered",
    mode: "explanation",
    question: null,
    parts: [{ label: "Key takeaway", text: "Convert the percentage into a multiplier first." }],
    message: "A short, neutral teaching response.",
    language: "english",
    hypotheses: [{ label: "AI hypothesis", text: "You may have treated the percentage as a flat amount." }],
    basedOn: [{ label: "Your submitted attempt", kind: "OBSERVED_DATA" }],
    sources: [],
    missing: [],
    // fields a buggy or hostile server might add - none may survive
    internalNote: "INTERNAL-SENTINEL",
    studentId: "STUDENT-SENTINEL"
  },
  preferenceNotes: ["Answering in a concise style, as you asked."],
  failure: null,
  audit: { requestId: "REQ-SENTINEL" }
};

describe("apiAskTutor", () => {
  it("POSTs exactly the operation and question id, with credentials, and nothing that names an identity, exam, capability or workflow", async () => {
    const seen: Recorded[] = [];
    await apiAskTutor("explain_mistake", "q-1", fakeFetch(200, SERVER_ANSWER, seen));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toMatch(/\/v1\/tutor\/ask$/);
    expect(seen[0]!.init?.method).toBe("POST");
    expect(seen[0]!.init?.credentials).toBe("include");
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ operation: "explain_mistake", questionId: "q-1" });
  });

  it("keeps only the student-safe fields of a response: extra server fields never reach the UI", async () => {
    const result = await apiAskTutor("explain_question", "q-1", fakeFetch(200, SERVER_ANSWER));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/INTERNAL-SENTINEL|STUDENT-SENTINEL|REQ-SENTINEL|audit|requestId/);
    if (result.ok) {
      expect(result.answer).toEqual({
        status: "answered",
        mode: "explanation",
        message: "A short, neutral teaching response.",
        question: null,
        parts: [{ label: "Key takeaway", text: "Convert the percentage into a multiplier first." }],
        hypotheses: ["You may have treated the percentage as a flat amount."],
        basedOn: ["Your submitted attempt"],
        preferenceNotes: ["Answering in a concise style, as you asked."],
        failureMessage: null
      });
    }
  });

  it("treats a malformed 200 as an unexpected failure, never a half-trusted answer", async () => {
    for (const body of [null, {}, { status: "weird" }, "text"]) expect(await apiAskTutor("give_hint", "q", fakeFetch(200, body))).toMatchObject({ ok: false });
    expect(readTutorAnswer({ status: "answered" })).toMatchObject({ status: "answered", parts: [], hypotheses: [] });
  });

  it("maps HTTP failures to a closed failure kind (401 -> not_authenticated; 503 and others -> a generic one) without echoing server text", async () => {
    expect(await apiAskTutor("give_hint", "q", fakeFetch(401, { error: { code: "not_authenticated", message: "x" } }))).toEqual({ ok: false, failure: { kind: "not_authenticated" } });
    const r = await apiAskTutor("give_hint", "q", fakeFetch(503, { error: { code: "not_available", message: "STACK TRACE SENTINEL" } }));
    expect(JSON.stringify(r)).not.toContain("SENTINEL");
    expect(r.ok).toBe(false);
  });

  it("a request that never settles becomes a network failure (the shared timeout)", async () => {
    const hang: FetchLike = () => new Promise(() => undefined);
    const { jsonRequest } = await import("../../src/http.js");
    expect(await jsonRequest(hang, "POST", "/v1/tutor/ask", {}, 20)).toEqual({ ok: false, failure: { kind: "network_error" } });
  });
});

describe("preference calls", () => {
  it("GET reads only the three explicit choices; PUT sends only the patch", async () => {
    const seen: Recorded[] = [];
    const got = await apiGetPreferences(fakeFetch(200, { preferences: { language: "hindi", verbosity: null, preferredHelp: null, intelligence: 140 } }, seen));
    expect(got).toEqual({ ok: true, preferences: { language: "hindi", verbosity: null, preferredHelp: null } });
    await apiUpdatePreferences({ verbosity: "concise" }, fakeFetch(200, { preferences: { language: null, verbosity: "concise", preferredHelp: null } }, seen));
    expect(seen[1]!.init?.method).toBe("PUT");
    expect(JSON.parse(String(seen[1]!.init?.body))).toEqual({ verbosity: "concise" });
  });
});

describe("TutorPanelView states", () => {
  const render = (state: TutorPanelState, preferences: { language: string | null; verbosity: string | null; preferredHelp: string | null } | null = null, message: string | null = null) =>
    renderToStaticMarkup(createElement(TutorPanelView, { state, preferences, preferenceMessage: message, onAsk: () => undefined, onPreference: () => undefined }));

  const answered = readTutorAnswer(SERVER_ANSWER)!;

  it("idle: offers the operations and shows no answer", () => {
    const html = render({ status: "idle" });
    expect(html).toContain("Ask the tutor");
    expect(html).toContain("Explain what went wrong");
    expect(html).not.toContain("tutor-answer");
  });

  it("loading: announces progress and disables the buttons", () => {
    const html = render({ status: "loading", operation: "give_hint" });
    expect(html).toContain("The tutor is working on it");
    expect(html).toContain("disabled");
  });

  it("answered: shows the message, labels the hypothesis as AI's, says it is AI-written, and shows no internal data", () => {
    const html = render({ status: "shown", answer: answered });
    expect(html).toContain("A short, neutral teaching response.");
    expect(html).toContain("AI hypothesis:");
    expect(html).toContain("written by AI");
    expect(html).toContain("Based on: Your submitted attempt");
    expect(html).not.toMatch(/INTERNAL-SENTINEL|STUDENT-SENTINEL|REQ-SENTINEL|OBSERVED_DATA|requestId/);
  });

  it("not answered: shows only the fixed safe message, no 'written by AI' claim", () => {
    const html = render({ status: "shown", answer: { ...answered, status: "not_answered", message: "", failureMessage: "The tutor couldn't produce an answer it could verify.", hypotheses: [], parts: [], basedOn: [], preferenceNotes: [] } });
    expect(html).toContain("couldn&#x27;t produce an answer it could verify");
    expect(html).not.toContain("written by AI");
  });

  it("error: renders an alert with student-safe copy", () => {
    const html = render({ status: "error", message: "The tutor isn't available right now. Please try again later." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("isn&#x27;t available right now");
  });

  it("preferences: shows the explicit choices and a saved message, nothing else about the student", () => {
    const html = render({ status: "idle" }, { language: "hindi", verbosity: null, preferredHelp: null }, "Saved.");
    expect(html).toContain("Language");
    expect(html).toContain("Length");
    expect(html).toContain("Saved.");
    expect(html).not.toMatch(/confidence|level|score|style of learning/i);
  });
});
