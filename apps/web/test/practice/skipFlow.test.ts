import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createApiTrainingAdapter, isSessionExpiredError } from "../../src/adapter/apiTrainingAdapter.js";
import type { AttemptResultViewModel, QuestionViewModel } from "../../src/adapter/index.js";
import { QuestionPlayer } from "../../src/components/QuestionPlayer.js";
import { ResultScreen } from "../../src/components/ResultScreen.js";
import type { FetchLike } from "../../src/http.js";

/**
 * Product Phase 2 Unit 6 -- Skip. The SERVER owns what a skip is (a terminal `skipped`
 * attempt); the frontend only asks for it and renders the outcome. The adapter runs
 * against a fake that plays the server's part faithfully: a skipped attempt is closed,
 * a later start makes a NEW attempt, and submitting a closed attempt is refused.
 */

const srcRoot = join(__dirname, "..", "..", "src");
const src = (file: string) => readFileSync(join(srcRoot, file), "utf-8");
const code = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const QUESTION = { questionId: "q-1", chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "multiple_choice", options: ["A", "B"], expectedTimeSeconds: 60 };

function fakeServer(opts: { skipStatus?: number; skipBody?: unknown; delayMs?: number } = {}) {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const state = new Map<string, "in_progress" | "skipped" | "submitted">();
  let counter = 0;
  let openId: string | null = null;
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url, "http://x").pathname;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push({ method: init?.method ?? "GET", path, body });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const respond = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b });
    if (path === "/v1/attempts") {
      if (!openId) {
        openId = `attempt-${++counter}`;
        state.set(openId, "in_progress");
      }
      return respond(200, { attemptId: openId, question: QUESTION, elapsedSeconds: 0 });
    }
    if (path.endsWith("/skip")) {
      const id = path.split("/")[3]!;
      if (opts.skipStatus && opts.skipStatus >= 400) return respond(opts.skipStatus, { error: { code: opts.skipStatus === 401 ? "not_authenticated" : "infrastructure_failure", message: "internal detail" } });
      if (opts.skipBody !== undefined) return respond(200, opts.skipBody);
      if (state.get(id) !== "in_progress") return respond(409, { error: { code: "invalid_state", message: "already finalized" } });
      state.set(id, "skipped");
      openId = null;
      return respond(200, { attemptId: id, questionId: "q-1", status: "skipped", isCorrect: null, chosenAnswer: null, correctAnswer: null, timeSpentSeconds: 9, expectedTimeSeconds: 60, solutionSteps: [], question: null });
    }
    if (path.endsWith("/submit")) {
      const id = path.split("/")[3]!;
      if (state.get(id) !== "in_progress") return respond(409, { error: { code: "invalid_state", message: "already finalized" } });
      state.set(id, "submitted");
      openId = null;
      return respond(200, { attemptId: id, questionId: "q-1", status: "submitted", isCorrect: true, chosenAnswer: "A", correctAnswer: "A", timeSpentSeconds: 3, expectedTimeSeconds: 60, solutionSteps: [], question: null });
    }
    if (path.endsWith("/result")) {
      const id = path.split("/")[3]!;
      return respond(200, { attemptId: id, questionId: "q-1", status: state.get(id) === "skipped" ? "skipped" : "submitted", isCorrect: state.get(id) === "skipped" ? null : true, chosenAnswer: state.get(id) === "skipped" ? null : "A", correctAnswer: state.get(id) === "skipped" ? null : "A", timeSpentSeconds: 9, expectedTimeSeconds: 60, solutionSteps: [], question: null });
    }
    return respond(200, { pending: false });
  };
  return { calls, fetchImpl };
}
const count = (calls: Array<{ path: string }>, suffix: string) => calls.filter((c) => c.path.endsWith(suffix)).length;

describe("adapter -- skipQuestion goes through the real API", () => {
  it("POSTs /v1/attempts/<attempt>/skip with only the question id (no timing, no state, no student) and maps a skipped outcome", async () => {
    const { calls, fetchImpl } = fakeServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const result = await adapter.skipQuestion({ questionId: "q-1" });
    const skip = calls.find((c) => c.path.endsWith("/skip"))!;
    expect(skip.method).toBe("POST");
    expect(skip.path).toBe("/v1/attempts/attempt-1/skip");
    expect(skip.body).toEqual({ questionId: "q-1" });
    expect(result).toMatchObject({ status: "skipped", attemptId: "attempt-1", questionId: "q-1", timeTakenSeconds: 9, expectedTimeSeconds: 60, solutionSteps: [], question: null, hasAutopsy: false });
  });

  it("a skipped outcome is NOT dressed up as an answer: no verdict, no answers", async () => {
    const { fetchImpl } = fakeServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const result = await adapter.skipQuestion({ questionId: "q-1" });
    expect(result.status).toBe("skipped");
    expect(result.chosenAnswer).toBe("");
    expect(result.correctAnswer).toBe("");
  });

  it("two concurrent skips send exactly ONE skip request", async () => {
    const { calls, fetchImpl } = fakeServer({ delayMs: 5 });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const [a, b] = await Promise.all([adapter.skipQuestion({ questionId: "q-1" }), adapter.skipQuestion({ questionId: "q-1" })]);
    expect(count(calls, "/skip")).toBe(1);
    expect(a).toEqual(b);
  });

  it("after a skip the attempt is closed on the client too: a later submit never reaches the server", async () => {
    const { calls, fetchImpl } = fakeServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    await adapter.skipQuestion({ questionId: "q-1" });
    await expect(adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 })).rejects.toThrow();
    expect(count(calls, "/submit")).toBe(0);
  });

  it("the server also refuses submitting a skipped attempt (409), even if a client tried", async () => {
    const { fetchImpl } = fakeServer();
    const res = await fetchImpl("/v1/attempts", { method: "POST", body: JSON.stringify({ questionId: "q-1" }) });
    const { attemptId } = (await res.json()) as { attemptId: string };
    await fetchImpl(`/v1/attempts/${attemptId}/skip`, { method: "POST", body: JSON.stringify({ questionId: "q-1" }) });
    const submit = await fetchImpl(`/v1/attempts/${attemptId}/submit`, { method: "POST", body: JSON.stringify({ questionId: "q-1", chosenAnswer: "A" }) });
    expect(submit.status).toBe(409);
  });

  it("skipping with no started attempt rejects without any request", async () => {
    const { calls, fetchImpl } = fakeServer();
    await expect(createApiTrainingAdapter(fetchImpl).skipQuestion({ questionId: "q-1" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("reload after a skip does NOT resume it: a fresh adapter starts a NEW attempt, and a later submit does not touch the skipped one", async () => {
    const { calls, fetchImpl } = fakeServer();
    const before = createApiTrainingAdapter(fetchImpl);
    await before.loadQuestion("q-1");
    const skipped = await before.skipQuestion({ questionId: "q-1" });
    const afterReload = createApiTrainingAdapter(fetchImpl);
    await afterReload.loadQuestion("q-1");
    const submitted = await afterReload.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 });
    expect(submitted.attemptId).not.toBe(skipped.attemptId);
    expect(calls.filter((c) => c.path === "/v1/attempts")).toHaveLength(2);
    expect(calls.find((c) => c.path.endsWith("/submit"))!.path).toBe("/v1/attempts/attempt-2/submit");
    // the skipped attempt is still a skipped attempt when re-read
    expect((await afterReload.getAttemptResult(skipped.attemptId)).status).toBe("skipped");
  });

  it("re-reading a skipped attempt (refresh on its result URL) yields the skipped outcome and never asks about an autopsy", async () => {
    const { calls, fetchImpl } = fakeServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const skipped = await adapter.skipQuestion({ questionId: "q-1" });
    const again = await createApiTrainingAdapter(fetchImpl).getAttemptResult(skipped.attemptId);
    expect(again).toMatchObject({ status: "skipped", hasAutopsy: false });
    expect(calls.some((c) => c.path.endsWith("/autopsy"))).toBe(false);
  });

  it("a submitted attempt re-read is still 'submitted' (the two outcomes stay distinct)", async () => {
    const { fetchImpl } = fakeServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const submitted = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 });
    expect(submitted.status).toBe("submitted");
    expect((await adapter.getAttemptResult(submitted.attemptId)).status).toBe("submitted");
  });

  it.each([
    ["a non-object body", "oops"],
    ["a submitted-shaped body (wrong outcome for a skip)", { attemptId: "a", questionId: "q-1", status: "submitted", isCorrect: true, chosenAnswer: "A", correctAnswer: "A" }],
    ["no attempt id", { questionId: "q-1", status: "skipped" }]
  ])("%s is a malformed skip response and rejects", async (_label, skipBody) => {
    const { fetchImpl } = fakeServer({ skipBody });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    await expect(adapter.skipQuestion({ questionId: "q-1" })).rejects.toThrow();
  });

  it("a server failure rejects (not an expired session) and leaks none of the server's message", async () => {
    const { fetchImpl } = fakeServer({ skipStatus: 500 });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const error = await adapter.skipQuestion({ questionId: "q-1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isSessionExpiredError(error)).toBe(false);
    expect((error as Error).message).not.toMatch(/internal detail/);
  });

  it("a failed skip can be retried (the attempt is still open on the client)", async () => {
    let failOnce = true;
    const inner = fakeServer();
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith("/skip") && failOnce) {
        failOnce = false;
        return { ok: false, status: 500, json: async () => ({ error: { code: "infrastructure_failure", message: "x" } }) };
      }
      return inner.fetchImpl(url, init);
    };
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    await expect(adapter.skipQuestion({ questionId: "q-1" })).rejects.toThrow();
    expect((await adapter.skipQuestion({ questionId: "q-1" })).status).toBe("skipped");
  });

  it("a 401 is recognized as an expired session; a network failure rejects", async () => {
    const expired = fakeServer({ skipStatus: 401 });
    const a = createApiTrainingAdapter(expired.fetchImpl);
    await a.loadQuestion("q-1");
    expect(isSessionExpiredError(await a.skipQuestion({ questionId: "q-1" }).catch((e: unknown) => e))).toBe(true);

    const server = fakeServer();
    let offline = false;
    const b = createApiTrainingAdapter(async (url, init) => {
      if (offline) throw new TypeError("Failed to fetch");
      return server.fetchImpl(url, init);
    });
    await b.loadQuestion("q-1");
    offline = true;
    await expect(b.skipQuestion({ questionId: "q-1" })).rejects.toThrow();
  });
});

describe("Skip in the UI", () => {
  const question: QuestionViewModel = { ...(QUESTION as Omit<QuestionViewModel, "elapsedSeconds" | "answerFormat">), answerFormat: "multiple_choice", elapsedSeconds: 0 };
  const render = (props: { submitting?: boolean; skipping?: boolean }) => renderToStaticMarkup(createElement(QuestionPlayer, { question, onSubmit: () => {}, onSkip: () => {}, ...props }));

  it("an unanswered question offers an enabled 'Skip question' button that is secondary to Submit, while Submit is disabled", () => {
    const html = render({});
    expect(html).toMatch(/<button[^>]*class="btn btn-secondary[^"]*skip-button[^"]*"[^>]*>Skip question<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Skip question/);
    expect(html).toMatch(/<button[^>]*btn-primary[^>]*disabled[^>]*>Submit answer<\/button>/);
  });

  it("while a request is in flight EVERY control is disabled (no second skip, no submit, no changing the answer)", () => {
    const html = render({ submitting: true, skipping: true });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Skipping…<\/button>/);
    expect(html).not.toMatch(/<button[^>]*btn-secondary skip-button[^>]*>(?!Skipping)/);
    expect(html.match(/disabled/g)!.length).toBeGreaterThanOrEqual(4); // 2 options + submit + skip
  });

  it("while a SUBMIT is in flight the skip button is disabled and keeps its own label", () => {
    const html = render({ submitting: true, skipping: false });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Submitting…<\/button>/);
    expect(html).toMatch(/<button[^>]*skip-button[^>]*disabled[^>]*>Skip question<\/button>/);
  });

  it("the skipped result screen says 'Skipped.', is not an 'incorrect' result, shows no answers/solution, and offers Continue to next question", () => {
    const skipped: AttemptResultViewModel = { status: "skipped", attemptId: "a1", questionId: "q-1", isCorrect: false, chosenAnswer: "", correctAnswer: "", timeTakenSeconds: 9, expectedTimeSeconds: 60, solutionSteps: [], question: null, hasAutopsy: false };
    const html = renderToStaticMarkup(createElement(ResultScreen, { result: skipped, onSeeWhatHappened: () => {}, onContinue: () => {} }));
    expect(html).toContain("Skipped.");
    expect(html).toContain("no answer was submitted");
    expect(html).toContain("9s");
    expect(html).toContain("Continue to next question");
    expect(html).not.toMatch(/Not quite|Correct\.|Your answer|Correct answer|solution|result-icon incorrect|a1|q-1/);
  });

  it("an incorrect SUBMITTED result is still rendered as 'Not quite.' (skip did not change that path)", () => {
    const wrong: AttemptResultViewModel = { status: "submitted", attemptId: "a1", questionId: "q-1", isCorrect: false, chosenAnswer: "B", correctAnswer: "A", timeTakenSeconds: 3, expectedTimeSeconds: 60, solutionSteps: [], question: null, hasAutopsy: false };
    const html = renderToStaticMarkup(createElement(ResultScreen, { result: wrong, onSeeWhatHappened: () => {}, onContinue: () => {} }));
    expect(html).toContain("Not quite.");
    expect(html).not.toContain("Skipped.");
  });
});

describe("route / player boundaries", () => {
  const route = code("routes/PracticeQuestionRoute.tsx");
  const player = code("components/QuestionPlayer.tsx");

  it("skip shares the submit in-flight guard, so skip+skip and skip+submit cannot overlap", () => {
    expect(route).toMatch(/async function handleSkip\(\) \{\s+if \(submitting \|\| submitInFlight\.current\) return;\s+submitInFlight\.current = true;/);
    expect(route).toMatch(/if \(submitting \|\| submitInFlight\.current\) return/);
  });

  it("skip goes through adapter.skipQuestion and then to the result route by attempt id; failure shows fixed student-safe copy", () => {
    expect(route).toContain("adapter.skipQuestion({ questionId })");
    expect(route).toContain("resultPath(questionId, result.attemptId)");
    expect(route).toContain("We couldn't skip this question. Please try again.");
    expect(route).toMatch(/isSessionExpiredError\(error\)/);
    expect(route).not.toMatch(/error\.message|JSON\.stringify|console\./);
  });

  it("the player's timer is untouched by skip: still one interval, cleared on unmount", () => {
    expect((player.match(/setInterval/g) ?? []).length).toBe(1);
    expect(player).toMatch(/return \(\) => window\.clearInterval\(interval\)/);
    expect(player).toMatch(/disabled=\{submitting\} onClick=\{onSkip\}/);
  });

  it("the frontend holds no attempt-state authority: no status decisions, grading, or attempt-id storage in the question/skip path", () => {
    for (const file of [route, player, code("adapter/apiTrainingAdapter.ts")]) {
      expect(file).not.toMatch(/localStorage|sessionStorage|randomUUID/);
      expect(file).not.toMatch(/status\s*=\s*["']skipped["']\s*;/);
    }
    expect(route + player).not.toMatch(/isCorrect|correctAnswer/);
  });

  it("no domain/db imports on the practice path, and the production adapter is still createApiTrainingAdapter()", () => {
    expect(route + player).not.toMatch(/from "@ipmat\//);
    expect(code("App.tsx")).toContain("createApiTrainingAdapter()");
    expect(code("App.tsx")).not.toMatch(/=> createFixtureTrainingAdapter\(\)/);
  });

  it("Continue from the skipped result reuses the existing /practice/next handoff", () => {
    expect(code("routes/PracticeResultRoute.tsx")).toContain('navigate("/practice/next")');
  });
});
