import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";
import { ANSWER_KEY, trainingTestSeed, type TrainingTestSeed } from "./trainingSeed.js";

/**
 * Phase 5 Unit 1 -- the Training Session routes over the REAL HTTP transport on the in-memory wiring (no mocks of the server).
 * Status convention: 401 no session, 403 someone else's session, 404 unknown, 409 wrong state, 400 malformed input.
 */

let seed: TrainingTestSeed;
let deps: ReturnType<typeof createInMemoryDependencies>;
let base: string;
let close: () => Promise<void>;

async function call(method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json, raw };
}

let counter = 0;
async function student(): Promise<string> {
  counter += 1;
  const res = await fetch(`${base}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `p5u1-${counter}@example.com`, password: "correct-horse" }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await fetch(`${base}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
  await fetch(`${base}/v1/enrollment`, { method: "POST", headers: { cookie } });
  return cookie;
}

/** Ordinary practice on the 9 history questions, through the ordinary routes: afterwards Novelty Training applies. */
async function seedHistory(cookie: string): Promise<void> {
  for (const questionId of seed.historyIds) {
    const started = await call("POST", "/v1/attempts", { questionId }, cookie);
    await call("POST", `/v1/attempts/${started.json.attemptId as string}/submit`, { questionId, chosenAnswer: ANSWER_KEY }, cookie);
  }
}

const FIVE = { completion: { kind: "fixed_question_count", questionCount: 5 } };
const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };

beforeAll(async () => {
  seed = trainingTestSeed();
  deps = createInMemoryDependencies(seed);
  const server = createServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});
afterAll(async () => {
  await close();
});

describe("authentication", () => {
  it("every training route answers 401 without a session", async () => {
    for (const [method, path, body] of [
      ["GET", "/v1/training/systems", undefined],
      ["POST", "/v1/training/sessions", { systemId: "novelty-training", config: FIVE }],
      ["GET", "/v1/training/sessions/abc", undefined],
      ["POST", "/v1/training/sessions/abc/next", {}],
      ["POST", "/v1/training/sessions/abc/finish", {}]
    ] as const) {
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("the entry point and starting", () => {
  it("a student with no evidence sees all seven systems, none startable, and cannot start one", async () => {
    const cookie = await student();
    const hub = await call("GET", "/v1/training/systems", undefined, cookie);
    expect(hub.status).toBe(200);
    const systems = hub.json.systems as Array<{ systemId: string; availability: string }>;
    expect(systems).toHaveLength(7);
    expect(systems.every((s) => s.availability !== "available")).toBe(true);
    expect((await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: FIVE }, cookie)).status).toBe(409);
    expect((await call("POST", "/v1/training/sessions", { systemId: "revision", config: FIVE }, cookie)).status).toBe(409);
    expect((await call("POST", "/v1/training/sessions", { systemId: "no-such-system", config: FIVE }, cookie)).status).toBe(404);
  });

  it("rejects malformed bodies with 400 and creates nothing", async () => {
    const cookie = await student();
    await seedHistory(cookie);
    for (const body of [{}, { systemId: "novelty-training" }, { systemId: "novelty-training", config: {} }, { systemId: "novelty-training", config: { completion: { kind: "fixed_question_count", questionCount: 999 } } }, { systemId: "", config: FIVE }]) {
      expect((await call("POST", "/v1/training/sessions", body, cookie)).status, JSON.stringify(body)).toBe(400);
    }
    expect(((await call("GET", "/v1/training/systems", undefined, cookie)).json as { activeSession: unknown }).activeSession).toBeNull();
  });

  it("the full lifecycle: start -> question -> answer through the ordinary attempt routes -> complete", async () => {
    const cookie = await student();
    await seedHistory(cookie);
    const hub = await call("GET", "/v1/training/systems", undefined, cookie);
    expect((hub.json.systems as Array<{ systemId: string; availability: string }>).find((s) => s.systemId === "novelty-training")?.availability).toBe("available");

    const started = await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: TWO }, cookie);
    expect(started.status).toBe(200);
    const session = started.json.session as { sessionId: string; objective: { statement: string }; status: string };
    expect(session.status).toBe("active");

    for (let i = 0; i < 2; i += 1) {
      const next = await call("POST", `/v1/training/sessions/${session.sessionId}/next`, {}, cookie);
      expect(next.status).toBe(200);
      expect(next.json.status).toBe("question");
      const question = next.json.question as { questionId: string };
      expect(seed.novelIds).toContain(question.questionId);
      expect(next.raw).not.toContain(ANSWER_KEY);
      const submitted = await call("POST", `/v1/attempts/${next.json.attemptId as string}/submit`, { questionId: question.questionId, chosenAnswer: ANSWER_KEY }, cookie);
      expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true });
    }
    const done = await call("POST", `/v1/training/sessions/${session.sessionId}/next`, {}, cookie);
    expect(done.json).toMatchObject({ status: "completed", session: { status: "completed" } });
    const reread = await call("GET", `/v1/training/sessions/${session.sessionId}`, undefined, cookie);
    expect(reread.json).toMatchObject({ status: "completed", progress: { completedQuestionCount: 2 } });
    expect(((await call("GET", "/v1/training/systems", undefined, cookie)).json as { activeSession: unknown }).activeSession).toBeNull();
  });
});

describe("ownership and trust", () => {
  it("another student gets 403 on every session route, and never sees the session in their hub", async () => {
    const owner = await student();
    const other = await student();
    await seedHistory(owner);
    const { session } = (await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: FIVE }, owner)).json as { session: { sessionId: string } };
    for (const [method, path] of [["GET", ""], ["POST", "/next"], ["POST", "/finish"]] as const) {
      expect((await call(method, `/v1/training/sessions/${session.sessionId}${path}`, method === "POST" ? {} : undefined, other)).status, `${method}${path}`).toBe(403);
    }
    expect(((await call("GET", "/v1/training/systems", undefined, other)).json as { activeSession: unknown }).activeSession).toBeNull();
    expect((await call("GET", "/v1/training/sessions/no-such-session", undefined, owner)).status).toBe(404);
  });

  it("identity, clock and block are never read from the request: smuggled fields change nothing", async () => {
    const cookie = await student();
    await seedHistory(cookie);
    const started = await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: FIVE, studentId: "someone-else", enrollmentId: "enrollment-x", now: "2020-01-01T00:00:00.000Z", practiceBlockId: "b" }, cookie);
    expect(started.status).toBe(200);
    expect(new Date(((started.json.session as { startedAt: string }).startedAt)).getFullYear()).toBeGreaterThan(2024);
  });

  it("a client cannot place an ordinary attempt into a training block by naming it", async () => {
    const cookie = await student();
    await seedHistory(cookie);
    const { session } = (await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: FIVE }, cookie)).json as { session: { sessionId: string } };
    const stored = (await deps.trainingSessionRepository.findById(session.sessionId))!;
    const started = await call("POST", "/v1/attempts", { questionId: seed.novelIds[3], practiceBlockId: stored.block.id }, cookie);
    expect(started.status).toBe(200);
    expect(await deps.attemptHistoryReader.findByPracticeBlockId(stored.block.id)).toHaveLength(0); // the field is not read
  });

  it("only one active session: a second start for another system is 409; ending the first frees the student", async () => {
    const cookie = await student();
    await seedHistory(cookie);
    const first = (await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: FIVE }, cookie)).json as { session: { sessionId: string } };
    expect((await call("POST", "/v1/training/sessions", { systemId: "speed-lab", config: FIVE }, cookie)).status).toBe(409);
    const ended = await call("POST", `/v1/training/sessions/${first.session.sessionId}/finish`, {}, cookie);
    expect(ended.json).toMatchObject({ status: "completed" });
    expect((await call("POST", "/v1/training/sessions", { systemId: "novelty-training", config: TWO }, cookie)).status).toBe(200);
  });
});
