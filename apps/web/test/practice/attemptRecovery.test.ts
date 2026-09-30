import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiTrainingAdapter, isSessionExpiredError } from "../../src/adapter/apiTrainingAdapter.js";
import type { FetchLike } from "../../src/http.js";

/**
 * Product Phase 2 Unit 5 -- reload recovery, from the browser's side. The SERVER decides
 * whether an attempt is resumed (idempotent POST /v1/attempts); the frontend only keeps
 * no attempt identity of its own, seeds its timer from the server's elapsed time, and
 * submits to whatever attempt id the server handed back. A "reload" here is a brand-new
 * adapter instance -- exactly what a page refresh produces (all in-memory state gone).
 */

const srcRoot = join(__dirname, "..", "..", "src");
const code = (file: string) => readFileSync(join(srcRoot, file), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const QUESTION = { questionId: "q-1", chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "multiple_choice", options: ["A", "B"], expectedTimeSeconds: 60 };
const RESULT = { attemptId: "attempt-1", questionId: "q-1", status: "submitted", isCorrect: true, chosenAnswer: "A", correctAnswer: "A", timeSpentSeconds: 50, expectedTimeSeconds: 60, solutionSteps: [], question: null };

/** A server that, like the real one, hands back the SAME attempt for repeated starts until it is submitted. */
function idempotentServer() {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let open: { id: string; startedMs: number } | null = null;
  let counter = 0;
  const clock = { now: 0 };
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url, "http://x").pathname;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    calls.push({ path, body });
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
    if (path === "/v1/attempts") {
      if (!open) open = { id: `attempt-${++counter}`, startedMs: clock.now };
      return ok({ attemptId: open.id, question: QUESTION, elapsedSeconds: Math.floor((clock.now - open.startedMs) / 1000) });
    }
    if (path.endsWith("/submit")) {
      const id = path.split("/")[3]!;
      open = null;
      return ok({ ...RESULT, attemptId: id });
    }
    return ok({ pending: false });
  };
  return { calls, clock, fetchImpl };
}

const startCalls = (calls: Array<{ path: string }>) => calls.filter((c) => c.path === "/v1/attempts").length;

describe("reload recovery through the adapter", () => {
  it("first visit: one start, elapsedSeconds 0", async () => {
    const { calls, fetchImpl } = idempotentServer();
    const question = await createApiTrainingAdapter(fetchImpl).loadQuestion("q-1");
    expect(startCalls(calls)).toBe(1);
    expect(question.elapsedSeconds).toBe(0);
  });

  it("a reload (fresh adapter) resumes: same attempt, elapsed seeded from the SERVER's clock, and submit goes to the ORIGINAL attempt id", async () => {
    const { calls, clock, fetchImpl } = idempotentServer();
    await createApiTrainingAdapter(fetchImpl).loadQuestion("q-1"); // before the reload -> attempt-1
    clock.now = 42_000;
    const afterReload = createApiTrainingAdapter(fetchImpl); // all in-memory state lost
    const question = await afterReload.loadQuestion("q-1");
    expect(question.elapsedSeconds).toBe(42);
    const result = await afterReload.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 42 });
    const submit = calls.find((c) => c.path.endsWith("/submit"))!;
    expect(submit.path).toBe("/v1/attempts/attempt-1/submit");
    expect(result.attemptId).toBe("attempt-1");
    expect(calls.filter((c) => c.path.endsWith("/submit"))).toHaveLength(1);
  });

  it("the submit body still carries only the answer and question id -- no elapsed/timing value, no attempt state", async () => {
    const { calls, fetchImpl } = idempotentServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 999 });
    expect(calls.find((c) => c.path.endsWith("/submit"))!.body).toEqual({ questionId: "q-1", chosenAnswer: "A" });
  });

  it("concurrent loads (StrictMode double mount) still share ONE start request", async () => {
    const { calls, fetchImpl } = idempotentServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await Promise.all([adapter.loadQuestion("q-1"), adapter.loadQuestion("q-1")]);
    expect(startCalls(calls)).toBe(1);
  });

  it("a submitted attempt is finished: the next load asks the server again and gets a NEW attempt", async () => {
    const { fetchImpl } = idempotentServer();
    const adapter = createApiTrainingAdapter(fetchImpl);
    await adapter.loadQuestion("q-1");
    const first = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 });
    await adapter.loadQuestion("q-1");
    const second = await adapter.submitAnswer({ questionId: "q-1", chosenAnswer: "A", timeTakenSeconds: 1 });
    expect(first.attemptId).toBe("attempt-1");
    expect(second.attemptId).toBe("attempt-2");
  });

  it.each([
    ["missing", undefined],
    ["negative", -5],
    ["not a number", "12"],
    ["not finite", Number.POSITIVE_INFINITY]
  ])("an unusable elapsedSeconds (%s) is treated as 0, never displayed", async (_label, elapsed) => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ attemptId: "a1", question: QUESTION, elapsedSeconds: elapsed }) });
    expect((await createApiTrainingAdapter(fetchImpl).loadQuestion("q-1")).elapsedSeconds).toBe(0);
  });

  it("a fractional elapsedSeconds is floored", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ attemptId: "a1", question: QUESTION, elapsedSeconds: 12.9 }) });
    expect((await createApiTrainingAdapter(fetchImpl).loadQuestion("q-1")).elapsedSeconds).toBe(12);
  });
});

describe("malformed / failing recovery responses", () => {
  it.each([
    ["no attemptId", { question: QUESTION }],
    ["no question", { attemptId: "a1" }],
    ["a question with no prompt", { attemptId: "a1", question: { ...QUESTION, prompt: "" } }],
    ["a question with no id", { attemptId: "a1", question: { ...QUESTION, questionId: undefined } }],
    ["a non-object body", "oops"]
  ])("%s rejects instead of showing an empty question", async (_label, body) => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => body });
    await expect(createApiTrainingAdapter(fetchImpl).loadQuestion("q-1")).rejects.toThrow();
  });

  it("a 401 while starting/resuming is recognized as an expired session", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: "not_authenticated", message: "x" } }) });
    expect(isSessionExpiredError(await createApiTrainingAdapter(fetchImpl).loadQuestion("q-1").catch((e: unknown) => e))).toBe(true);
  });

  it("another student's / another enrollment's attempt (server 403) surfaces as a plain failure, never as content", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({ error: { code: "ownership_mismatch", message: "internal detail" } }) });
    const error = await createApiTrainingAdapter(fetchImpl).loadQuestion("q-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isSessionExpiredError(error)).toBe(false);
    expect((error as Error).message).not.toMatch(/internal detail|ownership/);
  });

  it("a network failure rejects", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(createApiTrainingAdapter(fetchImpl).loadQuestion("q-1")).rejects.toThrow();
  });
});

describe("no client-side source of truth", () => {
  const files = ["adapter/apiTrainingAdapter.ts", "components/QuestionPlayer.tsx", "routes/PracticeQuestionRoute.tsx", "practice/PracticeSessionContext.tsx", "practice/singleFlight.ts", "practice/elapsed.ts"];

  it("the client never persists or invents attempt identity or timing (no storage, no id generation, no client clock sent)", () => {
    for (const file of files) {
      const text = code(file);
      expect(text, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|randomUUID|crypto\./);
    }
    expect(code("adapter/apiTrainingAdapter.ts")).not.toMatch(/timeTakenSeconds\s*[:,]\s*[^\n]*post|startedAt/);
  });

  it("the player seeds its timer from the server's elapsedSeconds and keeps a single interval cleaned up on unmount", () => {
    const player = code("components/QuestionPlayer.tsx");
    expect(player).toContain("question.elapsedSeconds");
    expect(player).toMatch(/Date\.now\(\) - seed \* 1000/);
    expect((player.match(/setInterval/g) ?? []).length).toBe(1);
    expect(player).toMatch(/return \(\) => window\.clearInterval\(interval\)/);
  });

  it("submission after recovery keeps the duplicate-submit protections (ref guard + single-flight)", () => {
    expect(code("routes/PracticeQuestionRoute.tsx")).toMatch(/if \(submitting \|\| submitInFlight\.current\) return/);
    expect(code("adapter/apiTrainingAdapter.ts")).toContain("submitFlights.run");
  });

  it("the whole web src has no fixture-adapter runtime use and imports no domain/db packages on the practice path", () => {
    expect(code("App.tsx")).toContain("createApiTrainingAdapter()");
    for (const dir of ["practice", "routes"]) {
      for (const f of readdirSync(join(srcRoot, dir))) expect(code(`${dir}/${f}`), f).not.toMatch(/from "@ipmat\//);
    }
  });
});
