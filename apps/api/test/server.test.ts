import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * HTTP-level integration tests — proves request parsing, routing, and
 * error->status-code mapping actually work end to end, on top of
 * deterministic in-memory dependencies (H: "do not require a live
 * production database for ordinary unit tests"). The bulk of business-
 * logic coverage lives in `packages/practice-api`'s own, much larger test
 * suite — this file exists to prove the TRANSPORT (this app's only real
 * job) is wired correctly, not to re-prove every domain rule again.
 */

const STUDENT = "student-1";
const ENROLLMENT = "enrollment-1";
const EXAM = "exam-ipmat";
const QUESTION = "question-1";
const ANSWER_KEY = "ANSWER-KEY-9042";

let baseUrl: string;
let close: () => Promise<void>;

interface JsonResponse {
  status: number;
  json: Record<string, unknown>;
}

/** Narrows `{ error: { code, message } }` out of an otherwise-`unknown` JSON body — the one shape `sendError()` (`../src/server.ts`) always produces for a non-2xx response. */
function errorCode(json: Record<string, unknown>): string {
  const error = json.error as { code: string } | undefined;
  return error?.code ?? "";
}

async function request(method: string, path: string, body?: unknown): Promise<JsonResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

beforeAll(async () => {
  const deps = createInMemoryDependencies({
    enrollments: [{ id: ENROLLMENT, studentId: STUDENT, examId: EXAM }],
    questions: [{ id: QUESTION, conceptId: "concept-percentages", options: null, correctAnswer: ANSWER_KEY, expectedTimeSeconds: 90, validationState: "published" }],
    questionContent: [{ id: QUESTION, chapterName: "Percentages", conceptName: "Percentages", prompt: "Find the base.", answerFormat: "numeric_entry", options: null, expectedTimeSeconds: 90 }]
  });

  const server = createServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await close();
});

describe("apps/api -- HTTP transport", () => {
  it("POST /v1/recommendation returns a student-safe recommendation", async () => {
    const res = await request("POST", "/v1/recommendation", { studentId: STUDENT, enrollmentId: ENROLLMENT });
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty("headline");
    expect(JSON.stringify(res.json)).not.toContain("diagnostics");
  });

  it("maps a missing enrollment to 404 not_found, never a stack trace or raw error", async () => {
    const res = await request("POST", "/v1/recommendation", { studentId: STUDENT, enrollmentId: "no-such-enrollment" });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    expect(JSON.stringify(res.json)).not.toMatch(/at .*\.ts:\d+/); // no stack-trace-shaped text
  });

  it("maps an ownership mismatch to 403", async () => {
    const res = await request("POST", "/v1/recommendation", { studentId: "someone-else", enrollmentId: ENROLLMENT });
    expect(res.status).toBe(403);
    expect(errorCode(res.json)).toBe("ownership_mismatch");
  });

  it("rejects a malformed JSON body with 400 invalid_request", async () => {
    const res = await fetch(`${baseUrl}/v1/attempts`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_request");
  });

  it("rejects a request missing a required field with 400 invalid_request", async () => {
    const res = await request("POST", "/v1/attempts", { studentId: STUDENT, enrollmentId: ENROLLMENT });
    expect(res.status).toBe(400);
    expect(errorCode(res.json)).toBe("invalid_request");
  });

  it("rejects an unknown route with 404", async () => {
    const res = await request("GET", "/v1/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("full start -> submit -> result round trip returns correctAnswer only after submission", async () => {
    const started = await request("POST", "/v1/attempts", { studentId: STUDENT, enrollmentId: ENROLLMENT, questionId: QUESTION });
    expect(started.status).toBe(200);
    expect(JSON.stringify(started.json)).not.toContain(ANSWER_KEY);
    const attemptId = started.json.attemptId as string;

    const submitted = await request("POST", `/v1/attempts/${attemptId}/submit`, { studentId: STUDENT, enrollmentId: ENROLLMENT, questionId: QUESTION, chosenAnswer: ANSWER_KEY });
    expect(submitted.status).toBe(200);
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true, correctAnswer: ANSWER_KEY });

    const result = await request("GET", `/v1/attempts/${attemptId}/result?studentId=${STUDENT}&enrollmentId=${ENROLLMENT}`);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ status: "submitted", correctAnswer: ANSWER_KEY });
  });

  it("skip -> autopsy round trip reports pending: false (a valid ordinary state)", async () => {
    const started = await request("POST", "/v1/attempts", { studentId: STUDENT, enrollmentId: ENROLLMENT, questionId: QUESTION });
    const attemptId = started.json.attemptId as string;

    const skipped = await request("POST", `/v1/attempts/${attemptId}/skip`, { studentId: STUDENT, enrollmentId: ENROLLMENT, questionId: QUESTION });
    expect(skipped.status).toBe(200);
    expect(skipped.json.status).toBe("skipped");

    const autopsy = await request("GET", `/v1/attempts/${attemptId}/autopsy?studentId=${STUDENT}&enrollmentId=${ENROLLMENT}`);
    expect(autopsy.status).toBe(200);
    expect(autopsy.json).toEqual({ attemptId, pending: false, hypothesis: null });
  });

  it("rejects a cross-student attempt submission with 403, never grading another student's attempt", async () => {
    const started = await request("POST", "/v1/attempts", { studentId: STUDENT, enrollmentId: ENROLLMENT, questionId: QUESTION });
    const attemptId = started.json.attemptId as string;

    const res = await request("POST", `/v1/attempts/${attemptId}/submit`, { studentId: "attacker", enrollmentId: ENROLLMENT, questionId: QUESTION, chosenAnswer: ANSWER_KEY });
    expect(res.status).toBe(403);
    expect(errorCode(res.json)).toBe("ownership_mismatch");
  });
});
