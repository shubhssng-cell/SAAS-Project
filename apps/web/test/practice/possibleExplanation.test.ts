import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createApiTrainingAdapter } from "../../src/adapter/apiTrainingAdapter.js";
import { createFixtureTrainingAdapter } from "../../src/adapter/service.js";
import type { AttemptResultViewModel } from "../../src/adapter/index.js";
import { PossibleExplanation } from "../../src/components/PossibleExplanation.js";
import { ResultScreen } from "../../src/components/ResultScreen.js";
import type { FetchLike } from "../../src/http.js";

/**
 * Phase 4 Unit 2 -- the student-facing hypothesis flow. Interactive behavior (confirm / reject / correct, failure handling) is exercised in
 * the real browser run; here: the adapter's strict mapping, what the component renders, that it is always framed as a guess, and how the
 * result screen and route use it.
 */

const src = (file: string) => readFileSync(join(__dirname, "..", "..", "src", file), "utf-8");

interface Call { url: string; init?: RequestInit }
function fetchReturning(status: number, body: unknown): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

const READY = { status: "ready", attemptId: "a-1", hypothesis: { summary: "The answer you selected may be a common wrong option.", supportingEvidence: ["Your selected answer was 5.5.", "Your answer was incorrect."] }, token: "opaque-token" };

describe("adapter: requestHypothesis", () => {
  it("POSTs to /v1/attempts/:id/hypothesis (credentials included) and maps a ready offer; nothing but the student-safe fields", async () => {
    const { calls, fetchImpl } = fetchReturning(200, { ...READY, modelConfidence: 0.9, generationMetadata: { provider: "x" } });
    const offer = await createApiTrainingAdapter(fetchImpl).requestHypothesis("a-1");
    expect(offer).toEqual({ status: "ready", summary: READY.hypothesis.summary, supportingEvidence: READY.hypothesis.supportingEvidence, token: "opaque-token" });
    expect(calls[0]?.url).toMatch(/\/v1\/attempts\/a-1\/hypothesis$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(JSON.stringify(offer)).not.toMatch(/modelConfidence|generationMetadata/);
  });

  it("maps 'unavailable' and 'not_applicable' without inventing anything", async () => {
    expect(await createApiTrainingAdapter(fetchReturning(200, { status: "unavailable", attemptId: "a-1" }).fetchImpl).requestHypothesis("a-1")).toEqual({ status: "unavailable" });
    expect(await createApiTrainingAdapter(fetchReturning(200, { status: "not_applicable", attemptId: "a-1" }).fetchImpl).requestHypothesis("a-1")).toEqual({ status: "not_applicable" });
  });

  it("rejects a malformed or refused response (never renders model-shaped junk)", async () => {
    for (const body of [{ status: "ready", hypothesis: { summary: "", supportingEvidence: [] }, token: "t" }, { status: "ready", hypothesis: { summary: "x", supportingEvidence: [1] }, token: "t" }, { status: "ready", hypothesis: { summary: "x", supportingEvidence: [] } }, { status: "weird" }, {}]) {
      await expect(createApiTrainingAdapter(fetchReturning(200, body).fetchImpl).requestHypothesis("a-1")).rejects.toBeDefined();
    }
    await expect(createApiTrainingAdapter(fetchReturning(409, { error: { code: "invalid_state", message: "not finalized" } }).fetchImpl).requestHypothesis("a-1")).rejects.toBeDefined();
  });

  it("the fixture adapter never invents an explanation", async () => {
    expect(await createFixtureTrainingAdapter().requestHypothesis("any")).toEqual({ status: "unavailable" });
  });
});

describe("adapter: respondToHypothesis", () => {
  it("sends the token and the response type; a correction is sent exactly as typed", async () => {
    const words = "  I used 120% as the base — not the original.\n✓ ";
    const { calls, fetchImpl } = fetchReturning(200, { attemptId: "a-1", status: "corrected", studentCorrectionText: words, hypothesisSummary: "x", persisted: false });
    const result = await createApiTrainingAdapter(fetchImpl).respondToHypothesis({ attemptId: "a-1", token: "opaque-token", response: { type: "corrected", correctedExplanation: words } });
    expect(result).toEqual({ status: "corrected", studentCorrectionText: words });
    expect(calls[0]?.url).toMatch(/\/v1\/attempts\/a-1\/hypothesis\/response$/);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ token: "opaque-token", response: "corrected", correctedExplanation: words });
    expect(JSON.stringify(calls[0]?.init?.body)).not.toMatch(/studentId|enrollmentId/); // identity is cookie-derived only
  });

  it("confirm and reject send no correction text, and map to the matching status", async () => {
    for (const type of ["confirmed", "rejected"] as const) {
      const { calls, fetchImpl } = fetchReturning(200, { attemptId: "a-1", status: type, studentCorrectionText: null, hypothesisSummary: "x", persisted: false });
      expect(await createApiTrainingAdapter(fetchImpl).respondToHypothesis({ attemptId: "a-1", token: "t", response: { type } })).toEqual({ status: type, studentCorrectionText: null });
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ token: "t", response: type });
    }
  });

  it("rejects an unknown status and a refusal (the screen then says it could not be recorded)", async () => {
    await expect(createApiTrainingAdapter(fetchReturning(200, { status: "proven" }).fetchImpl).respondToHypothesis({ attemptId: "a-1", token: "t", response: { type: "confirmed" } })).rejects.toBeDefined();
    await expect(createApiTrainingAdapter(fetchReturning(409, { error: { code: "invalid_state", message: "expired" } }).fetchImpl).respondToHypothesis({ attemptId: "a-1", token: "t", response: { type: "confirmed" } })).rejects.toBeDefined();
  });
});

describe("the component", () => {
  const adapter = createFixtureTrainingAdapter();
  const html = renderToStaticMarkup(createElement(PossibleExplanation, { adapter, attemptId: "a-1" }));

  it("starts in a neutral loading state (the result above and Continue below are never waiting on it)", () => {
    expect(html).toContain("A possible explanation");
    expect(html).toContain("Looking for a possible explanation…");
    expect(html).not.toMatch(/Yes, that's what happened|undefined|null|\[object/);
  });

  it("is always framed as a guess, asks a plain question, offers confirm AND reject-or-correct, and keeps the student's words untouched", () => {
    const source = src("components/PossibleExplanation.tsx");
    expect(source).toContain("This is a guess based on what was recorded — not a fact");
    expect(source).toContain("Is that what happened?");
    expect(source).toContain("Yes, that's what happened");
    expect(source).toContain("No, something else happened");
    expect(source).toContain("What happened instead? (optional)");
    expect(source).toContain("maxLength={MAX_CORRECTION_LENGTH}");
    // the student's text is sent as typed: only emptiness is judged, never rewritten
    expect(source).toMatch(/text\.trim\(\)\.length > 0 \? \{ type: "corrected", correctedExplanation: text \}/);
    expect(source).toContain("We couldn't suggest an explanation this time. You can carry on.");
  });

  it("its own wording makes no psychological, diagnostic or causal claim", () => {
    const strings = [...src("components/PossibleExplanation.tsx").matchAll(/>\s*([A-Z][^<>{}]{8,}?)\s*</g)].map((m) => m[1]).join(" ") + html;
    expect(strings).not.toMatch(/confiden|motivat|careless|unsure|understand|confus|weak|because you|diagnos|you (thought|knew|felt)/i);
  });
});

describe("the result screen and route", () => {
  const result: AttemptResultViewModel = { status: "submitted", attemptId: "a-1", questionId: "q-1", isCorrect: false, chosenAnswer: "5.5", correctAnswer: "5", timeTakenSeconds: 12, expectedTimeSeconds: 45, solutionSteps: [], question: null, hasAutopsy: false };
  const render = (explanation: unknown, r = result) => renderToStaticMarkup(createElement(ResultScreen, { result: r, explanation: explanation as never, onSeeWhatHappened: () => {}, onContinue: () => {} }));

  it("renders the explanation card after the result, and Continue stays available either way", () => {
    const withCard = render(createElement("section", null, "EXPLANATION-SLOT"));
    expect(withCard).toContain("EXPLANATION-SLOT");
    expect(withCard).toContain("Continue to next question");
    expect(render(null)).toContain("Continue to next question");
  });

  it("only an incorrect, submitted result gets the explanation card (never correct, never skipped)", () => {
    const route = src("routes/PracticeResultRoute.tsx");
    expect(route).toMatch(/state\.result\.status === "submitted" && !state\.result\.isCorrect/);
    expect(route).toContain("<PossibleExplanation adapter={adapter} attemptId={state.result.attemptId} />");
  });
});
