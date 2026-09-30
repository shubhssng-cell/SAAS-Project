import { describe, expect, it } from "vitest";
import type { FetchLike } from "../../src/http.js";
import { createApiTrainingAdapter, isSessionExpiredError } from "../../src/adapter/apiTrainingAdapter.js";

interface Call {
  url: string;
  init?: RequestInit;
}

/** Routes each call to a queued response by matching a substring of the request path, in call order per matching URL -- lets a single fake exercise multi-request adapter methods (e.g. submitAnswer -> submit, then autopsy). */
function routedFetch(routes: Record<string, { ok: boolean; status: number; body: unknown }>): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const response = key ? routes[key]! : { ok: false, status: 500, body: { error: { code: "infrastructure_failure", message: "boom" } } };
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  return { calls, fetchImpl };
}

function throwingFetch(): FetchLike {
  return async () => {
    throw new TypeError("Failed to fetch");
  };
}

const RECOMMENDATION_BODY = { questionId: "q-1", headline: "Keep building your coverage", explanation: "...", modeLabel: "Coverage" };
const QUESTION_BODY = { questionId: "q-1", chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "multiple_choice", options: ["A", "B"], expectedTimeSeconds: 60 };
const ANSWER_KEY = "SECRET-ANSWER-9042";

describe("createApiTrainingAdapter -- getDashboard / getNextRecommendation", () => {
  it("POSTs to /v1/recommendation with credentials included and maps the response", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/recommendation": { ok: true, status: 200, body: RECOMMENDATION_BODY } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.getNextRecommendation();
    expect(result).toEqual({ questionId: "q-1", headline: "Keep building your coverage", explanation: "...", modeLabel: "Coverage" });
    expect(calls[0]?.url).toMatch(/\/v1\/recommendation$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  it("getDashboard never sends its own studentId -- the request carries no body at all", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/recommendation": { ok: true, status: 200, body: RECOMMENDATION_BODY } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.getDashboard();
    expect(calls[0]?.init?.body).toBe("{}");
    expect(calls[0]?.init?.body ?? "").not.toMatch(/studentId/);
  });

  it("getDashboard reports questionsPracticedSoFar: 0 before any attempt this session", async () => {
    const { fetchImpl } = routedFetch({ "/v1/recommendation": { ok: true, status: 200, body: RECOMMENDATION_BODY } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const dashboard = await adapter.getDashboard();
    expect(dashboard.questionsPracticedSoFar).toBe(0);
  });

  it("maps a genuine 'nothing to recommend' response (questionId: null) faithfully, never inventing a fallback id", async () => {
    const { fetchImpl } = routedFetch({ "/v1/recommendation": { ok: true, status: 200, body: { questionId: null, headline: "You're all caught up", explanation: "...", modeLabel: "Up to date" } } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.getNextRecommendation();
    expect(result.questionId).toBeNull();
  });

  it("throws a safe, mapped error on a non-2xx response -- never a raw error or JSON", async () => {
    const { fetchImpl } = routedFetch({ "/v1/recommendation": { ok: false, status: 409, body: { error: { code: "invalid_state", message: "You need to complete enrollment before practicing." } } } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await expect(adapter.getNextRecommendation()).rejects.toThrow();
  });

  it("throws on a network failure, never silently resolving", async () => {
    const adapter = createApiTrainingAdapter(throwingFetch());
    await expect(adapter.getNextRecommendation()).rejects.toThrow();
  });
});

describe("createApiTrainingAdapter -- loadQuestion / submitAnswer", () => {
  it("loadQuestion POSTs { questionId } to /v1/attempts and maps the student-safe question view", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/attempts": { ok: true, status: 200, body: { attemptId: "attempt-1", question: QUESTION_BODY } } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.loadQuestion("q-1");
    expect(result).toEqual({
      questionId: "q-1",
      chapterName: "Percentages",
      conceptName: "Percentages",
      prompt: "Find the base.",
      answerFormat: "multiple_choice",
      options: ["A", "B"],
      expectedTimeSeconds: 60,
      elapsedSeconds: 0
    });
    expect(calls[0]?.url).toMatch(/\/v1\/attempts$/);
    const sentBody = JSON.parse(String(calls[0]?.init?.body ?? "{}"));
    expect(sentBody).toEqual({ questionId: "q-1" });
  });

  it("loadQuestion never leaks an answer key or provider metadata -- the response shape has none to leak, but assert the mapper never invents one", async () => {
    const { fetchImpl } = routedFetch({ "/v1/attempts": { ok: true, status: 200, body: { attemptId: "attempt-1", question: { ...QUESTION_BODY, correctAnswer: ANSWER_KEY } } } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.loadQuestion("q-1");
    expect(JSON.stringify(result)).not.toContain(ANSWER_KEY);
  });

  it("submitAnswer POSTs to the attemptId this session's own loadQuestion() resolved, never a client-invented id", async () => {
    const { calls, fetchImpl } = routedFetch({
      "/v1/attempts/attempt-1/submit": { ok: true, status: 200, body: { attemptId: "attempt-1", questionId: "q-1", status: "submitted", isCorrect: true, chosenAnswer: "A", correctAnswer: "A", timeSpentSeconds: 12, expectedTimeSeconds: 60 } },
      "/v1/attempts/attempt-1/autopsy": { ok: true, status: 200, body: { attemptId: "attempt-1", pending: false, hypothesis: null } },
      "/v1/attempts": { ok: true, status: 200, body: { attemptId: "attempt-1", question: QUESTION_BODY } }
    });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const result = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 12 });
    expect(result).toMatchObject({ attemptId: "attempt-1", isCorrect: true, correctAnswer: "A", hasAutopsy: false });
    const submitCall = calls.find((c) => c.url.includes("/submit"));
    expect(submitCall?.url).toMatch(/\/v1\/attempts\/attempt-1\/submit$/);
  });

  it("submitAnswer without a prior loadQuestion() for that questionId is rejected -- never sends a guessed attemptId", async () => {
    const { fetchImpl } = routedFetch({});
    const adapter = createApiTrainingAdapter(fetchImpl);
    await expect(adapter.submitAnswer({ questionId: "never-loaded", chosenAnswer: "A", timeTakenSeconds: 1 })).rejects.toThrow();
  });

  it("submitAnswer reflects a real pending autopsy hypothesis when getAutopsyForConfirmation reports one, never fabricating it", async () => {
    const { fetchImpl } = routedFetch({
      "/v1/attempts/attempt-1/submit": { ok: true, status: 200, body: { attemptId: "attempt-1", questionId: "q-1", status: "submitted", isCorrect: false, chosenAnswer: "B", correctAnswer: "A", timeSpentSeconds: 12, expectedTimeSeconds: 60 } },
      "/v1/attempts/attempt-1/autopsy": { ok: true, status: 200, body: { attemptId: "attempt-1", pending: true, hypothesis: { summary: "You may have misapplied the base.", supportingEvidence: ["Answered faster than expected"] } } },
      "/v1/attempts": { ok: true, status: 200, body: { attemptId: "attempt-1", question: QUESTION_BODY } }
    });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const result = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "B", timeTakenSeconds: 12 });
    expect(result.hasAutopsy).toBe(true);
  });
});

describe("createApiTrainingAdapter -- getAutopsy / respondToAutopsy", () => {
  it("getAutopsy GETs /v1/attempts/:id/autopsy and maps a pending hypothesis, never exposing modelConfidence or raw diagnostics", async () => {
    const { calls, fetchImpl } = routedFetch({
      "/v1/attempts/attempt-1/autopsy": { ok: true, status: 200, body: { attemptId: "attempt-1", pending: true, hypothesis: { summary: "You may have misapplied the base.", supportingEvidence: ["evidence-1"] } } }
    });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.getAutopsy("attempt-1");
    expect(result).toEqual({ attemptId: "attempt-1", observed: [], hypothesis: { summary: "You may have misapplied the base.", supportingEvidence: ["evidence-1"] } });
    expect(calls[0]?.url).toMatch(/\/v1\/attempts\/attempt-1\/autopsy$/);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(JSON.stringify(result)).not.toMatch(/modelConfidence/i);
  });

  it("getAutopsy maps 'nothing pending' to a null hypothesis, never a fabricated one", async () => {
    const { fetchImpl } = routedFetch({ "/v1/attempts/attempt-1/autopsy": { ok: true, status: 200, body: { attemptId: "attempt-1", pending: false, hypothesis: null } } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.getAutopsy("attempt-1");
    expect(result.hypothesis).toBeNull();
  });

  it("respondToAutopsy re-resolves the next recommendation through the existing endpoint -- no separate confirm/reject endpoint exists yet", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/recommendation": { ok: true, status: 200, body: RECOMMENDATION_BODY } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const result = await adapter.respondToAutopsy({ attemptId: "attempt-1", response: "confirmed" });
    expect(result.questionId).toBe("q-1");
    expect(calls[0]?.url).toMatch(/\/v1\/recommendation$/);
  });
});

describe("createApiTrainingAdapter -- getAttemptEvidence (Phase 4 Unit 1)", () => {
  const BODY = { attemptId: "attempt-1", questionId: "q-1", status: "submitted", observations: ["Your selected answer was B.", "You took 86 seconds."], notRecorded: ["Changes to your answer before submitting are not recorded in this practice flow."], facts: {}, context: null, history: null };

  it("GETs /v1/attempts/:id/evidence with credentials and maps only the student-facing sentences", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/attempts/attempt-1/evidence": { ok: true, status: 200, body: BODY } });
    const result = await createApiTrainingAdapter(fetchImpl).getAttemptEvidence("attempt-1");
    expect(result).toEqual({ attemptId: "attempt-1", observations: BODY.observations, notRecorded: BODY.notRecorded });
    expect(calls[0]?.url).toMatch(/\/v1\/attempts\/attempt-1\/evidence$/);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  it("rejects (never guesses) on a malformed body and on a refusal such as 'not finalized yet'", async () => {
    const malformed = routedFetch({ "/evidence": { ok: true, status: 200, body: { attemptId: "attempt-1", observations: "nope", notRecorded: [] } } });
    await expect(createApiTrainingAdapter(malformed.fetchImpl).getAttemptEvidence("attempt-1")).rejects.toBeDefined();
    const early = routedFetch({ "/evidence": { ok: false, status: 409, body: { error: { code: "invalid_state", message: "This attempt has not been finalized yet." } } } });
    await expect(createApiTrainingAdapter(early.fetchImpl).getAttemptEvidence("attempt-1")).rejects.toBeDefined();
  });
});

describe("createApiTrainingAdapter -- identity and transport discipline", () => {
  it("never sends a studentId/enrollmentId in any request body -- identity is cookie-derived server-side only", async () => {
    const { calls, fetchImpl } = routedFetch({
      "/v1/recommendation": { ok: true, status: 200, body: RECOMMENDATION_BODY },
      "/v1/attempts": { ok: true, status: 200, body: { attemptId: "attempt-1", question: QUESTION_BODY } }
    });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.getNextRecommendation();
    await adapter.loadQuestion("q-1");
    for (const call of calls) {
      expect(String(call.init?.body ?? "")).not.toMatch(/studentId|enrollmentId/);
    }
  });

  it("every request includes credentials: \"include\" -- never a manually-attached Authorization/Cookie header", async () => {
    const { calls, fetchImpl } = routedFetch({ "/v1/recommendation": { ok: true, status: 200, body: RECOMMENDATION_BODY } });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.getNextRecommendation();
    for (const call of calls) {
      expect(call.init?.credentials).toBe("include");
      expect(Object.keys(call.init?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain("authorization");
    }
  });
});

describe("isSessionExpiredError (Product Phase 1 Unit 11)", () => {
  async function failureOf(fetchImpl: FetchLike): Promise<unknown> {
    try {
      await createApiTrainingAdapter(fetchImpl).getNextRecommendation();
    } catch (error) {
      return error;
    }
    throw new Error("expected the adapter call to reject");
  }

  it("is true for a real 401 (not_authenticated) from a practice call", async () => {
    const { fetchImpl } = routedFetch({ "/v1/recommendation": { ok: false, status: 401, body: { error: { code: "not_authenticated", message: "no session" } } } });
    expect(isSessionExpiredError(await failureOf(fetchImpl))).toBe(true);
  });

  it("is false for a server error, a network failure, and for things that are not adapter errors at all", async () => {
    const { fetchImpl } = routedFetch({ "/v1/recommendation": { ok: false, status: 500, body: { error: { code: "infrastructure_failure", message: "boom" } } } });
    expect(isSessionExpiredError(await failureOf(fetchImpl))).toBe(false);
    expect(isSessionExpiredError(await failureOf(throwingFetch()))).toBe(false);
    expect(isSessionExpiredError(new Error("not_authenticated"))).toBe(false);
    expect(isSessionExpiredError(undefined)).toBe(false);
  });
});
