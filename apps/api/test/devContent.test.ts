import type { AddressInfo } from "node:net";
import { InMemoryConceptReader, InMemoryTrainingQuestionReader, type TrainingQuestionRecord } from "@ipmat/db";
import { PublicationDecisionError, decidePublication, reverseAlgebraHard } from "@ipmat/question-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_EXAM_ID, buildDevContentSeed, type DevContentSeed } from "../src/devContent.js";
import { createServer } from "../src/server.js";
import { createInMemoryDependencies } from "../src/wiring.js";

/**
 * Product Phase 2 Unit 1 -- the development-only published practice content
 * set (`../src/devContent.ts`) and its path through the REAL apps/api HTTP
 * transport. Domain-level publication rules are covered by
 * `@ipmat/question-engine`'s own tests; this file proves the content set
 * obeys them and that the existing recommendation/practice path (no
 * frontend involvement) can discover it.
 */

let seed: DevContentSeed;
let baseUrl: string;
let close: () => Promise<void>;

async function request(method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers["cookie"] = cookie;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function signupOnboardEnroll(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse" })
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  await fetch(`${baseUrl}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
  await fetch(`${baseUrl}/v1/enrollment`, { method: "POST", headers: { cookie } });
  return cookie;
}

beforeAll(async () => {
  seed = await buildDevContentSeed();
  const server = createServer(createInMemoryDependencies(seed));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
  await close();
});

describe("dev content set -- publication + Question DNA guarantees", () => {
  it("is deterministic and non-trivial: several published questions with stable ids", async () => {
    const again = await buildDevContentSeed();
    expect(seed.questionContent.length).toBeGreaterThanOrEqual(3);
    expect(again.questionContent.map((q) => q.id)).toEqual(seed.questionContent.map((q) => q.id));
  });

  it("every question is published and carries complete Question DNA (nothing defaulted or empty)", () => {
    const records = seed.trainingQuestions.get(DEV_EXAM_ID) ?? [];
    expect(records).toHaveLength(seed.questionContent.length);
    for (const record of records) {
      const q = record.question;
      expect(record.validationState).toBe("published");
      expect(record.expectedTimeSeconds).toBeGreaterThan(0);
      expect(q.examCode).toBe("IPMAT_INDORE");
      expect(q.sectionName).toBe("Quant");
      expect(q.chapterName).toBe("Percentages");
      expect(q.conceptName).toBe("Percentages");
      expect(q.patternFamilyName).toBeTruthy();
      expect(q.patternTaxonomyCellId).toBeTruthy();
      expect(q.testingModes.length).toBeGreaterThan(0);
      expect(Object.keys(q.difficultyDimensions)).toHaveLength(6);
    }
    for (const canonical of seed.questions) expect(canonical.validationState).toBe("published");
  });

  it("the student-facing content never carries the answer key", () => {
    for (const content of seed.questionContent) {
      expect(Object.keys(content).sort()).toEqual(["answerFormat", "chapterName", "conceptName", "expectedTimeSeconds", "id", "options", "prompt"]);
    }
  });

  it("every question id exists consistently in all three read models (training, canonical, student content)", () => {
    const training = (seed.trainingQuestions.get(DEV_EXAM_ID) ?? []).map((r) => r.question.questionId).sort();
    expect(seed.questions.map((q) => q.id).sort()).toEqual(training);
    expect(seed.questionContent.map((q) => q.id).sort()).toEqual(training);
    for (const canonical of seed.questions) {
      if (canonical.options) expect(canonical.options).toContain(canonical.correctAnswer);
    }
  });

  it("hard/extreme fixtures are NOT part of the set: the publication rule still refuses them without human review", () => {
    expect(seed.questionContent.map((q) => q.prompt)).not.toContain(reverseAlgebraHard.candidate.stem);
    expect(() => decidePublication("publish", { currentValidationState: "ai_validated", difficultyTier: "hard", hasProvenance: true })).toThrow(PublicationDecisionError);
  });

  it("the training reader excludes any unpublished record, even one sitting next to published ones", async () => {
    const published = seed.trainingQuestions.get(DEV_EXAM_ID) ?? [];
    const draft: TrainingQuestionRecord = { ...published[0]!, validationState: "ai_validated", question: { ...published[0]!.question, questionId: "dev-unpublished" } };
    const reader = new InMemoryTrainingQuestionReader(new Map([[DEV_EXAM_ID, [...published, draft]]]));
    const ids = (await reader.findPublishedByExamId(DEV_EXAM_ID)).map((r) => r.question.questionId);
    expect(ids).not.toContain("dev-unpublished");
    expect(ids).toHaveLength(published.length);
  });

  it("the concept reader exposes the one real concept the published questions belong to", async () => {
    const concepts = await new InMemoryConceptReader(seed.concepts).findWithPublishedQuestionsByExamId(DEV_EXAM_ID);
    expect(concepts.map((c) => c.name)).toEqual(["Percentages"]);
    expect(new Set(seed.questions.map((q) => q.conceptId))).toEqual(new Set(concepts.map((c) => c.id)));
  });
});

describe("dev content set -- through the real apps/api HTTP path", () => {
  it("POST /v1/recommendation discovers a published question for an enrolled student (no frontend involved)", async () => {
    const cookie = await signupOnboardEnroll("devcontent-recommend@example.com");
    const res = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(res.status).toBe(200);
    const questionId = res.json.questionId as string | null;
    expect(questionId).not.toBeNull();
    expect(seed.questionContent.map((q) => q.id)).toContain(questionId);
    expect(JSON.stringify(res.json)).not.toContain("diagnostics");
  });

  it("the recommended question can be started and returns student-safe content (no answer key)", async () => {
    const cookie = await signupOnboardEnroll("devcontent-start@example.com");
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    const started = await request("POST", "/v1/attempts", { questionId: rec.json.questionId }, cookie);
    expect(started.status).toBe(200);
    const question = started.json.question as { prompt: string };
    expect(question.prompt.length).toBeGreaterThan(0);
    const canonical = seed.questions.find((q) => q.id === rec.json.questionId)!;
    expect(JSON.stringify(started.json)).not.toContain(`"correctAnswer"`);
    expect(canonical.correctAnswer).toBeTruthy();
  });

  it("an unseeded wiring is still genuinely empty (the default is unchanged)", async () => {
    const empty = createServer(createInMemoryDependencies());
    await new Promise<void>((resolve) => empty.listen(0, resolve));
    const url = `http://127.0.0.1:${(empty.address() as AddressInfo).port}`;
    try {
      const signup = await fetch(`${url}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "devcontent-empty@example.com", password: "correct-horse" }) });
      const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      await fetch(`${url}/v1/onboarding/complete`, { method: "POST", headers: { cookie } });
      await fetch(`${url}/v1/enrollment`, { method: "POST", headers: { cookie } });
      const res = await fetch(`${url}/v1/recommendation`, { method: "POST", headers: { cookie } });
      const json = (await res.json()) as { questionId: string | null };
      expect(json.questionId).toBeNull();
    } finally {
      await new Promise<void>((resolve) => empty.close(() => resolve()));
    }
  });
});
