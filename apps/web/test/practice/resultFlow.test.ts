import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createApiTrainingAdapter, isSessionExpiredError } from "../../src/adapter/apiTrainingAdapter.js";
import type { AttemptResultViewModel } from "../../src/adapter/index.js";
import { ResultScreen } from "../../src/components/ResultScreen.js";
import type { FetchLike } from "../../src/http.js";
import { readAttemptParam, resultPath } from "../../src/practice/resultLocation.js";

/**
 * Product Phase 2 Unit 3 -- submit -> result -> explanation. `ResultScreen` is
 * rendered for real (react-dom/server); the adapter runs against a fake fetch
 * returning the server's result shape. Correctness is never computed here --
 * every verdict below comes FROM the (fake) server response.
 */

const src = (file: string) => readFileSync(join(__dirname, "..", "..", "src", file), "utf-8");

function view(overrides: Partial<AttemptResultViewModel> = {}): AttemptResultViewModel {
  return {
    status: "submitted",
    attemptId: "attempt-1",
    questionId: "q-1",
    isCorrect: false,
    chosenAnswer: "5.5",
    correctAnswer: "5",
    timeTakenSeconds: 12,
    expectedTimeSeconds: 45,
    solutionSteps: ["Original discount rate = 30%.", "New discount rate = 25%."],
    question: { prompt: "By how many percentage points did the discount decrease?", chapterName: "Percentages", conceptName: "Percentages" },
    hasAutopsy: false,
    ...overrides
  };
}

const render = (result: AttemptResultViewModel) => renderToStaticMarkup(createElement(ResultScreen, { result, onSeeWhatHappened: () => {}, onContinue: () => {} }));

describe("ResultScreen rendering", () => {
  it("incorrect: says so, shows the student's answer AND the correct answer, and the question context", () => {
    const html = render(view());
    expect(html).toContain("Not quite.");
    expect(html).toContain("Your answer");
    expect(html).toContain("5.5");
    expect(html).toContain("Correct answer");
    expect(html).toMatch(/Correct answer<\/span><span class="fact-value">5</);
    expect(html).toContain("By how many percentage points did the discount decrease?");
    expect(html).toContain("Percentages");
  });

  it("correct: says so and shows the student's answer without a redundant correct-answer row", () => {
    const html = render(view({ isCorrect: true, chosenAnswer: "5" }));
    expect(html).toContain("Correct.");
    expect(html).not.toContain("Not quite.");
    expect(html).not.toContain("Correct answer");
  });

  it("offers 'View solution' (collapsed, aria-expanded=false) when the server supplied steps", () => {
    const html = render(view());
    expect(html).toContain("View solution");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Original discount rate"); // hidden until asked for
  });

  it("offers NO solution control when there are no steps -- nothing is invented", () => {
    const html = render(view({ solutionSteps: [] }));
    expect(html).not.toContain("View solution");
    expect(html).not.toContain("solution");
  });

  it("omits the question block when the server did not supply the question", () => {
    expect(render(view({ question: null }))).not.toContain("result-question");
  });

  it("shows time taken vs expected, and never any id or raw structure", () => {
    const html = render(view());
    expect(html).toContain("12s");
    expect(html).toContain("expected 45s");
    expect(html).not.toMatch(/attempt-1|q-1|attemptId|questionId|\{"/);
  });
});

describe("result location", () => {
  it("builds the result URL with the attempt id and reads it back", () => {
    const path = resultPath("q-1", "a b/1");
    expect(path.startsWith("/practice/q-1/result?attempt=")).toBe(true);
    expect(readAttemptParam(path.slice(path.indexOf("?")))).toBe("a b/1");
  });

  it("reads null for a missing or blank attempt param", () => {
    expect(readAttemptParam("")).toBeNull();
    expect(readAttemptParam("?attempt=")).toBeNull();
    expect(readAttemptParam("?attempt=%20")).toBeNull();
    expect(readAttemptParam("?other=1")).toBeNull();
  });
});

const SERVER_RESULT = {
  attemptId: "attempt-1",
  questionId: "q-1",
  status: "submitted",
  isCorrect: false,
  chosenAnswer: "5.5",
  correctAnswer: "5",
  timeSpentSeconds: 12,
  expectedTimeSeconds: 45,
  solutionSteps: ["s1", "s2", 7],
  question: { prompt: "P", chapterName: "Percentages", conceptName: "Percentages" }
};

function fetchReturning(status: number, body: unknown): { urls: string[]; fetchImpl: FetchLike } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    if (url.endsWith("/autopsy")) return { ok: true, status: 200, json: async () => ({ pending: false }) };
    return { ok: status < 400, status, json: async () => body };
  };
  return { urls, fetchImpl };
}

describe("adapter -- getAttemptResult (refresh recovery)", () => {
  it("re-reads the result by attempt id from the server and maps solution + question", async () => {
    const { urls, fetchImpl } = fetchReturning(200, SERVER_RESULT);
    const result = await createApiTrainingAdapter(fetchImpl).getAttemptResult("attempt-1");
    expect(urls[0]).toMatch(/\/v1\/attempts\/attempt-1\/result$/);
    expect(result).toMatchObject({ isCorrect: false, chosenAnswer: "5.5", correctAnswer: "5", timeTakenSeconds: 12, expectedTimeSeconds: 45 });
    expect(result.solutionSteps).toEqual(["s1", "s2"]); // non-strings dropped
    expect(result.question).toEqual({ prompt: "P", chapterName: "Percentages", conceptName: "Percentages" });
  });

  it("a result with no solution/question maps to [] / null", async () => {
    const bare: Record<string, unknown> = { ...SERVER_RESULT };
    delete bare.solutionSteps;
    delete bare.question;
    const result = await createApiTrainingAdapter(fetchReturning(200, bare).fetchImpl).getAttemptResult("attempt-1");
    expect(result.solutionSteps).toEqual([]);
    expect(result.question).toBeNull();
  });

  it.each([
    ["null body", null],
    ["no verdict", { ...SERVER_RESULT, isCorrect: undefined }],
    ["a non-object", "oops"]
  ])("a malformed/unrenderable response (%s) rejects instead of rendering a guess", async (_label, body) => {
    await expect(createApiTrainingAdapter(fetchReturning(200, body).fetchImpl).getAttemptResult("attempt-1")).rejects.toThrow();
  });

  it("an unavailable result (server 4xx/5xx) rejects and is not an expired-session error", async () => {
    const error = await createApiTrainingAdapter(fetchReturning(404, { error: { code: "not_found", message: "x" } }).fetchImpl).getAttemptResult("a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it("a 401 is recognized as an expired session", async () => {
    const error = await createApiTrainingAdapter(fetchReturning(401, { error: { code: "not_authenticated", message: "x" } }).fetchImpl).getAttemptResult("a").catch((e: unknown) => e);
    expect(isSessionExpiredError(error)).toBe(true);
  });

  it("a network failure rejects", async () => {
    const adapter = createApiTrainingAdapter(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(adapter.getAttemptResult("a")).rejects.toThrow();
  });

  it("the submit path maps solution + question from the submit response too", async () => {
    const fetchImpl: FetchLike = async (url) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/v1/attempts") ? { attemptId: "attempt-1", question: { questionId: "q-1", prompt: "P", options: ["5", "5.5"] } } : url.endsWith("/autopsy") ? { pending: false } : SERVER_RESULT)
    });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const result = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "5.5", timeTakenSeconds: 1 });
    expect(result.solutionSteps).toEqual(["s1", "s2"]);
    expect(result.question?.prompt).toBe("P");
  });
});

describe("result route / question route -- boundaries", () => {
  const route = src("routes/PracticeResultRoute.tsx");

  it("submit navigates to a result URL carrying the attempt id", () => {
    expect(src("routes/PracticeQuestionRoute.tsx")).toContain("resultPath(questionId, result.attemptId)");
  });

  it("the result route has loading, error/retry, and expired-session handling, and refuses a result for another question", () => {
    expect(route).toContain("LoadingState");
    expect(route).toContain("FailureScreen");
    expect(route).toContain("isSessionExpiredError");
    expect(route).toContain("onRetry");
    expect(route).toMatch(/result\.questionId !== questionId/);
  });

  it("a remembered result is only reused when it is the attempt the URL names", () => {
    expect(route).toMatch(/remembered\.attemptId === attemptId/);
  });

  it("no grading anywhere in the result path, and no domain/db imports", () => {
    for (const file of [route, src("components/ResultScreen.tsx"), src("practice/resultLocation.ts")]) {
      expect(file).not.toMatch(/from "@ipmat\//);
      expect(file).not.toMatch(/===\s*result\.correctAnswer|chosenAnswer\s*===|correctAnswer\s*===/);
    }
  });

  it("the production runtime adapter is still createApiTrainingAdapter() with no fixture fallback", () => {
    const app = src("App.tsx");
    expect(app).toContain("createApiTrainingAdapter()");
    expect(app).not.toMatch(/=> createFixtureTrainingAdapter\(\)/);
  });
});
