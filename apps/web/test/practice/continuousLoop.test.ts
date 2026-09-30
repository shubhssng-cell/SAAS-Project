import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createApiTrainingAdapter, isSessionExpiredError } from "../../src/adapter/apiTrainingAdapter.js";
import type { AttemptResultViewModel } from "../../src/adapter/index.js";
import { ResultScreen } from "../../src/components/ResultScreen.js";
import type { FetchLike } from "../../src/http.js";
import { decidePracticeEntryOutcome } from "../../src/practice/practiceEntry.js";

/**
 * Product Phase 2 Unit 4 -- the continuous loop: result -> Continue ->
 * /practice/next -> NEW recommendation (via POST /v1/recommendation) -> new
 * question/attempt -> ... The adapter runs against a fake API that plays the
 * SERVER's part (which question comes next is entirely its decision -- the
 * frontend contains no selection logic, which the last describe() checks).
 */

const srcRoot = join(__dirname, "..", "..", "src");
const src = (file: string) => readFileSync(join(srcRoot, file), "utf-8");
/** Source with comments removed, so prose in doc comments cannot trip a code-pattern check. */
const code = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function question(id: string) {
  return { questionId: id, chapterName: "Percentages", conceptName: "Percentages", prompt: `Prompt for ${id}`, answerFormat: "multiple_choice", options: ["A", "B"], expectedTimeSeconds: 60 };
}

/** A fake server that recommends the given ids in order, starts numbered attempts, and grades nothing itself beyond echoing a fixed verdict. */
function fakeServer(recommendations: Array<string | null>) {
  const calls: string[] = [];
  let recIndex = 0;
  let attemptCounter = 0;
  const attemptQuestion = new Map<string, string>();
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url, "http://x").pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (path === "/v1/recommendation") {
      const id = recommendations[Math.min(recIndex++, recommendations.length - 1)];
      return ok({ questionId: id, headline: "Keep building your coverage", explanation: "x", modeLabel: "Coverage" });
    }
    if (path === "/v1/attempts") {
      const { questionId } = JSON.parse(init?.body as string) as { questionId: string };
      const attemptId = `attempt-${++attemptCounter}`;
      attemptQuestion.set(attemptId, questionId);
      return ok({ attemptId, question: question(questionId) });
    }
    if (path.endsWith("/submit")) {
      const attemptId = path.split("/")[3]!;
      return ok({ attemptId, questionId: attemptQuestion.get(attemptId), status: "submitted", isCorrect: true, chosenAnswer: "A", correctAnswer: "A", timeSpentSeconds: 5, expectedTimeSeconds: 60, solutionSteps: [], question: null });
    }
    return ok({ pending: false });
  };
  return { calls, fetchImpl };
}

const count = (calls: string[], call: string) => calls.filter((c) => c === call).length;

describe("next-question resolution goes through the existing recommendation API", () => {
  it("each Continue asks the server again: POST /v1/recommendation, and uses whatever question id the server names", async () => {
    const { calls, fetchImpl } = fakeServer(["q-a", "q-b"]);
    const adapter = createApiTrainingAdapter(fetchImpl);
    const first = await adapter.getNextRecommendation();
    const second = await adapter.getNextRecommendation();
    expect(first.questionId).toBe("q-a");
    expect(second.questionId).toBe("q-b");
    expect(count(calls, "POST /v1/recommendation")).toBe(2);
  });

  it("concurrent resolutions (StrictMode double mount / double activation) share ONE request", async () => {
    const { calls, fetchImpl } = fakeServer(["q-a", "q-b"]);
    const adapter = createApiTrainingAdapter(fetchImpl);
    const [a, b] = await Promise.all([adapter.getNextRecommendation(), adapter.getNextRecommendation()]);
    expect(a).toEqual(b);
    expect(count(calls, "POST /v1/recommendation")).toBe(1);
  });

  it("the server may legitimately recommend the SAME question again; the frontend does not filter or second-guess it", async () => {
    const { fetchImpl } = fakeServer(["q-a", "q-a"]);
    const adapter = createApiTrainingAdapter(fetchImpl);
    expect((await adapter.getNextRecommendation()).questionId).toBe("q-a");
    expect((await adapter.getNextRecommendation()).questionId).toBe("q-a");
  });
});

describe("a full multi-question loop creates independent attempts and results", () => {
  it("question 1 -> submit -> next -> question 2 -> submit: two attempts, each submitted to its OWN attempt id", async () => {
    const { calls, fetchImpl } = fakeServer(["q-a", "q-b"]);
    const adapter = createApiTrainingAdapter(fetchImpl);

    const r1 = await adapter.getNextRecommendation();
    const q1 = await adapter.loadQuestion(r1.questionId!);
    const res1 = await adapter.submitAnswer({ questionId: r1.questionId!, chosenAnswer: "A", timeTakenSeconds: 5 });

    const r2 = await adapter.getNextRecommendation();
    const q2 = await adapter.loadQuestion(r2.questionId!);
    const res2 = await adapter.submitAnswer({ questionId: r2.questionId!, chosenAnswer: "A", timeTakenSeconds: 5 });

    expect([q1.questionId, q2.questionId]).toEqual(["q-a", "q-b"]);
    expect(q1.prompt).not.toBe(q2.prompt);
    expect(count(calls, "POST /v1/attempts")).toBe(2);
    expect([res1.attemptId, res2.attemptId]).toEqual(["attempt-1", "attempt-2"]);
    expect(res2.questionId).toBe("q-b");
    expect(calls).toContain("POST /v1/attempts/attempt-1/submit");
    expect(calls).toContain("POST /v1/attempts/attempt-2/submit");
    expect(count(calls, "POST /v1/attempts/attempt-1/submit")).toBe(1);
  });

  it("if the same question comes back, it is a NEW attempt (never the finished one reused)", async () => {
    const { calls, fetchImpl } = fakeServer(["q-a", "q-a"]);
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-a");
    const first = await adapter.submitAnswer({ questionId: "q-a", chosenAnswer: "A", timeTakenSeconds: 1 });
    await adapter.loadQuestion("q-a");
    const second = await adapter.submitAnswer({ questionId: "q-a", chosenAnswer: "A", timeTakenSeconds: 1 });
    expect(first.attemptId).not.toBe(second.attemptId);
    expect(count(calls, "POST /v1/attempts")).toBe(2);
  });
});

describe("empty / failure / malformed handling of the next-question step", () => {
  it("'nothing to recommend' (questionId: null) is the unavailable outcome, not an error", async () => {
    const { fetchImpl } = fakeServer([null]);
    const recommendation = await createApiTrainingAdapter(fetchImpl).getNextRecommendation();
    expect(recommendation.questionId).toBeNull();
    expect(decidePracticeEntryOutcome(recommendation)).toEqual({ kind: "unavailable" });
  });

  it.each([
    ["a non-object body", "oops"],
    ["a null body", null],
    ["no questionId", { headline: "h" }],
    ["a numeric questionId", { questionId: 7 }],
    ["an empty questionId", { questionId: "" }]
  ])("%s is a malformed response: it rejects instead of reading as 'nothing available'", async (_label, body) => {
    const adapter = createApiTrainingAdapter(async () => ({ ok: true, status: 200, json: async () => body }));
    await expect(adapter.getNextRecommendation()).rejects.toThrow();
  });

  it("a server failure rejects (retryable) and is not an expired session; a retry runs a new request", async () => {
    let calls = 0;
    const adapter = createApiTrainingAdapter(async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 500, json: async () => ({ error: { code: "infrastructure_failure", message: "boom" } }) }
        : { ok: true, status: 200, json: async () => ({ questionId: "q-a", headline: "h", explanation: "e", modeLabel: "m" }) };
    });
    const error = await adapter.getNextRecommendation().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isSessionExpiredError(error)).toBe(false);
    expect((await adapter.getNextRecommendation()).questionId).toBe("q-a");
    expect(calls).toBe(2);
  });

  it("a 401 is recognized as an expired session", async () => {
    const adapter = createApiTrainingAdapter(async () => ({ ok: false, status: 401, json: async () => ({ error: { code: "not_authenticated", message: "x" } }) }));
    expect(isSessionExpiredError(await adapter.getNextRecommendation().catch((e: unknown) => e))).toBe(true);
  });

  it("a network failure rejects", async () => {
    const adapter = createApiTrainingAdapter(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(adapter.getNextRecommendation()).rejects.toThrow();
  });
});

describe("Continue in the UI", () => {
  const result: AttemptResultViewModel = {
    status: "submitted",
    attemptId: "attempt-1",
    questionId: "q-a",
    isCorrect: true,
    chosenAnswer: "A",
    correctAnswer: "A",
    timeTakenSeconds: 5,
    expectedTimeSeconds: 60,
    solutionSteps: [],
    question: null,
    hasAutopsy: false
  };

  it("the result screen offers a clear 'Continue to next question' action", () => {
    const html = renderToStaticMarkup(createElement(ResultScreen, { result, onSeeWhatHappened: () => {}, onContinue: () => {} }));
    expect(html).toContain("Continue to next question");
  });

  it("Continue from the result hands off to /practice/next, once per view (a second activation is ignored)", () => {
    const route = src("routes/PracticeResultRoute.tsx");
    expect(route).toContain('navigate("/practice/next")');
    expect(route).toMatch(/if \(continued\.current\) return;\s+continued\.current = true;/);
    expect(route).toContain("onContinue={handleContinue}");
  });

  it("Continue from /practice/next enters the recommended question once; the guard re-arms on each fresh recommendation", () => {
    const route = src("routes/PracticeNextRoute.tsx");
    expect(route).toMatch(/if \(continued\.current\) return;\s+continued\.current = true;\s+navigate\(`\/practice\/\$\{outcome\.questionId\}`\)/);
    expect(route).toMatch(/setState\(\{ status: "loading" \}\);\s+continued\.current = false;/);
  });

  it("/practice/next has loading, unavailable (with Back to dashboard), retryable error, and expired-session states", () => {
    const route = src("routes/PracticeNextRoute.tsx");
    expect(route).toContain("LoadingState");
    expect(route).toContain("PRACTICE_UNAVAILABLE_COPY");
    expect(route).toContain("Back to dashboard");
    expect(route).toContain("onRetry");
    expect(route).toContain("isSessionExpiredError");
  });
});

describe("state reset between questions", () => {
  it("the player resets selection, elapsed time and the timer together whenever the question changes", () => {
    const player = src("components/QuestionPlayer.tsx");
    expect(player).toMatch(/setSelected\(null\);[\s\S]*?setElapsedSeconds\(seed\);\s+elapsedRef\.current = seed;/);
    expect(player).toMatch(/\[question\.questionId\]\)/);
    expect(player).toMatch(/return \(\) => window\.clearInterval\(interval\)/);
  });

  it("a result is only shown for the exact attempt the URL names, so an earlier result cannot bleed into a later question", () => {
    const route = src("routes/PracticeResultRoute.tsx");
    expect(route).toMatch(/attemptId !== null && remembered\.attemptId === attemptId/);
  });

  it("the question route still resets submit state and reloads (a new attempt) per question", () => {
    const route = src("routes/PracticeQuestionRoute.tsx");
    expect(route).toMatch(/submitInFlight\.current = false/);
    expect(route).toContain("adapter\n      .loadQuestion(questionId)");
  });
});

describe("no frontend selection logic, no hardcoded ids, real adapter only", () => {
  const files = ["routes", "practice", "components", "adapter/apiTrainingAdapter.ts"].flatMap((entry) => {
    const full = join(srcRoot, entry);
    return entry.endsWith(".ts") ? [entry] : readdirSync(full).filter((f) => /\.tsx?$/.test(f)).map((f) => `${entry}/${f}`);
  });

  it("no source in the practice path hardcodes a question id", () => {
    for (const file of files) {
      expect(src(file), file).not.toMatch(/["'`](q-[a-z]|dev-|question-\d)/);
    }
  });

  it("no source in the practice path selects, ranks, randomizes, or imports selection/mastery/autopsy logic", () => {
    for (const file of files) {
      const text = code(file);
      expect(text, file).not.toMatch(/Math\.random|adaptive|orchestrat|computeMasteryState|selectNext/i);
      expect(text, file).not.toMatch(/from "@ipmat\//);
    }
  });

  it("the routes navigate to the id the recommendation returned, never one they pick", () => {
    expect(src("routes/PracticeNextRoute.tsx")).toContain("outcome.questionId");
  });

  it("the production runtime adapter is still createApiTrainingAdapter() with no fixture fallback", () => {
    const app = src("App.tsx");
    expect(app).toContain("createApiTrainingAdapter()");
    expect(app).not.toMatch(/=> createFixtureTrainingAdapter\(\)/);
  });
});
