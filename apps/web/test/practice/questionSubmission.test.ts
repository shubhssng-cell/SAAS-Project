import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiTrainingAdapter, isSessionExpiredError } from "../../src/adapter/apiTrainingAdapter.js";
import type { FetchLike } from "../../src/http.js";
import { elapsedSecondsBetween } from "../../src/practice/elapsed.js";
import { createSingleFlight } from "../../src/practice/singleFlight.js";

/**
 * Product Phase 2 Unit 2 -- question -> timer -> answer -> submit. The adapter
 * is exercised against a fake fetch (the real HTTP contract is proven by
 * apps/api's own server tests and the browser run); component behavior is
 * pinned with source-structure checks, this repo's existing convention (no
 * DOM test library is installed).
 */

const webSrc = join(__dirname, "..", "..", "src");
const src = (file: string) => readFileSync(join(webSrc, file), "utf-8");

const QUESTION_BODY = { attemptId: "attempt-1", question: { questionId: "q-1", chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "multiple_choice", options: ["A", "B"], expectedTimeSeconds: 60 } };
const RESULT_BODY = { attemptId: "attempt-1", questionId: "q-1", isCorrect: true, chosenAnswer: "A", correctAnswer: "A", timeSpentSeconds: 12, expectedTimeSeconds: 60 };

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function fakeApi(options: { submitStatus?: number; delayMs?: number } = {}): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown> });
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    const respond = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (url.endsWith("/v1/attempts")) return respond(200, QUESTION_BODY);
    if (url.endsWith("/submit")) {
      const failing = options.submitStatus !== undefined && options.submitStatus >= 400;
      return respond(options.submitStatus ?? 200, failing ? { error: { code: options.submitStatus === 401 ? "not_authenticated" : "infrastructure_failure", message: "y" } } : RESULT_BODY);
    }
    return respond(200, { pending: false });
  };
  return { calls, fetchImpl };
}

describe("createSingleFlight", () => {
  it("shares one operation between concurrent calls with the same key, and frees the key once settled", async () => {
    const flight = createSingleFlight<number>();
    let runs = 0;
    const op = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 5));
      return runs;
    };
    const [a, b] = await Promise.all([flight.run("k", op), flight.run("k", op)]);
    expect(runs).toBe(1);
    expect(a).toBe(b);
    await flight.run("k", op);
    expect(runs).toBe(2);
  });

  it("does not coalesce different keys, and a failure frees the key so a retry runs again", async () => {
    const flight = createSingleFlight<string>();
    let runs = 0;
    await Promise.all([
      flight.run("a", async () => {
        runs += 1;
        return "a";
      }),
      flight.run("b", async () => {
        runs += 1;
        return "b";
      })
    ]);
    expect(runs).toBe(2);
    await expect(flight.run("a", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(flight.run("a", async () => "ok")).resolves.toBe("ok");
  });
});

describe("timer -- elapsed time", () => {
  it("derives whole elapsed seconds from wall-clock readings (immune to throttled ticks) and never goes negative", () => {
    expect(elapsedSecondsBetween(1_000, 1_000)).toBe(0);
    expect(elapsedSecondsBetween(1_000, 8_999)).toBe(7);
    expect(elapsedSecondsBetween(1_000, 61_000)).toBe(60);
    expect(elapsedSecondsBetween(5_000, 1_000)).toBe(0);
  });

  it("QuestionPlayer starts one interval when a question is presented, keys it on the question, and clears it on unmount/change", () => {
    const player = src("components/QuestionPlayer.tsx");
    expect((player.match(/setInterval/g) ?? []).length).toBe(1);
    expect(player).toMatch(/return \(\) => window\.clearInterval\(interval\)/);
    expect(player).toMatch(/\[question\.questionId\]\)/);
    expect(player).toContain("<Timer");
  });
});

describe("question presentation + submission via the API adapter", () => {
  it("loadQuestion starts exactly ONE attempt even when called twice concurrently (StrictMode double mount)", async () => {
    const { calls, fetchImpl } = fakeApi({ delayMs: 5 });
    const adapter = createApiTrainingAdapter(fetchImpl);
    const [a, b] = await Promise.all([adapter.loadQuestion("q-1"), adapter.loadQuestion("q-1")]);
    expect(calls.filter((c) => c.url.endsWith("/v1/attempts"))).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a.options).toEqual(["A", "B"]);
    expect(a).not.toHaveProperty("correctAnswer");
  });

  it("submitAnswer sends ONLY the student's answer (+ the question id) -- no correctness, no timing, no student id", async () => {
    const { calls, fetchImpl } = fakeApi();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 999 });
    const submit = calls.find((c) => c.url.endsWith("/submit"))!;
    expect(submit.url).toMatch(/\/v1\/attempts\/attempt-1\/submit$/);
    expect(submit.body).toEqual({ questionId: "q-1", chosenAnswer: "A" });
  });

  it("a typed answer is sent verbatim and correctness comes back from the server", async () => {
    const { calls, fetchImpl } = fakeApi();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const result = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "20000", timeTakenSeconds: 3 });
    expect(calls.find((c) => c.url.endsWith("/submit"))!.body.chosenAnswer).toBe("20000");
    expect(result.isCorrect).toBe(true); // taken from the server response, not computed here
  });

  it("two concurrent submits produce exactly ONE submit request", async () => {
    const { calls, fetchImpl } = fakeApi({ delayMs: 5 });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const input = { questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 4 };
    await Promise.all([adapter.submitAnswer(input), adapter.submitAnswer(input)]);
    expect(calls.filter((c) => c.url.endsWith("/submit"))).toHaveLength(1);
  });

  it("a failed submit rejects with an error that is not an expired-session error", async () => {
    const { fetchImpl } = fakeApi({ submitStatus: 500 });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const error = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isSessionExpiredError(error)).toBe(false);
  });

  it("a 401 on submit is recognizable as an expired session", async () => {
    const { fetchImpl } = fakeApi({ submitStatus: 401 });
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const error = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 }).catch((e: unknown) => e);
    expect(isSessionExpiredError(error)).toBe(true);
  });
});

describe("QuestionPlayer / route -- answer handling, guards, and boundaries", () => {
  const player = src("components/QuestionPlayer.tsx");
  const route = src("routes/PracticeQuestionRoute.tsx");

  it("Submit is disabled until an answer exists (option selected or text typed) and while submitting", () => {
    expect(player).toMatch(/disabled=\{!selected \|\| submitting\}/);
    expect(player).toMatch(/if \(!selected \|\| submitting\) return/);
  });

  it("multiple choice: options are toggle buttons showing selected state; typed answers get a labelled input with Enter-to-submit", () => {
    expect(player).toMatch(/aria-pressed=\{selected === option\}/);
    expect(player).toMatch(/onClick=\{\(\) => setSelected\(option\)\}/);
    expect(player).toContain('label="Your answer"');
    expect(player).toMatch(/event\.key === "Enter"/);
  });

  it("duplicate submission is blocked synchronously by a ref (not only by React state)", () => {
    expect(route).toMatch(/submitInFlight = useRef\(false\)/);
    expect(route).toMatch(/if \(submitting \|\| submitInFlight\.current\) return/);
    expect(route).toMatch(/submitInFlight\.current = false/);
  });

  it("a failed submit shows fixed student-safe copy, never the raw error", () => {
    expect(route).toContain("We couldn't submit your answer. Please try again.");
    expect(route).not.toMatch(/error\.message|JSON\.stringify|console\./);
  });

  it("the frontend contains no grading: neither the player nor the route compares answers", () => {
    for (const file of [player, route]) {
      expect(file).not.toMatch(/correctAnswer|isCorrect/);
    }
  });

  it("the question path imports no domain/db/provider packages", () => {
    for (const file of [player, route, src("adapter/apiTrainingAdapter.ts"), src("practice/singleFlight.ts"), src("practice/elapsed.ts")]) {
      expect(file).not.toMatch(/from "@ipmat\//);
      expect(file).not.toMatch(/@prisma/);
    }
  });

  it("the production runtime adapter is still createApiTrainingAdapter(); no fixture adapter in App.tsx", () => {
    const app = src("App.tsx");
    expect(app).toMatch(/createApiTrainingAdapter\(\)/);
    expect(app).not.toMatch(/=> createFixtureTrainingAdapter\(\)/);
  });
});
