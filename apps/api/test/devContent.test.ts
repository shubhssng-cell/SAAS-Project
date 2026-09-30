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

  it("every dev question carries an authored solution in the canonical store", () => {
    for (const q of seed.questions) expect(q.solutionSteps?.length ?? 0).toBeGreaterThan(0);
  });

  it("submit returns a server-graded result with solution + question context; the same result is re-readable by attempt id; nothing leaks before submission", async () => {
    const cookie = await signupOnboardEnroll("devcontent-result@example.com");
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    const questionId = rec.json.questionId as string;
    const canonical = seed.questions.find((q) => q.id === questionId)!;

    const started = await request("POST", "/v1/attempts", { questionId }, cookie);
    const startedJson = JSON.stringify(started.json);
    expect(startedJson).not.toContain("solutionSteps");
    expect(startedJson).not.toContain(canonical.solutionSteps![0]!);
    const attemptId = started.json.attemptId as string;

    const wrong = canonical.options!.find((o) => o !== canonical.correctAnswer)!;
    const submitted = await request("POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer: wrong }, cookie);
    expect(submitted.status).toBe(200);
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: false, chosenAnswer: wrong, correctAnswer: canonical.correctAnswer });
    expect(submitted.json.solutionSteps).toEqual(canonical.solutionSteps);
    expect((submitted.json.question as { prompt: string }).prompt).toBe(seed.questionContent.find((q) => q.id === questionId)!.prompt);

    const reread = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, cookie);
    expect(reread.json).toEqual(submitted.json);

    const otherCookie = await signupOnboardEnroll("devcontent-result-other@example.com");
    const stolen = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, otherCookie);
    expect(stolen.status).toBe(403);
    expect(JSON.stringify(stolen.json)).not.toContain("solutionSteps");
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

describe("attempt recovery through the real HTTP path (Product Phase 2 Unit 5)", () => {
  it("POST /v1/attempts is idempotent for an open attempt: a reload gets the SAME attempt id with server-derived elapsedSeconds, and submit uses it", async () => {
    const cookie = await signupOnboardEnroll("recovery-same@example.com");
    const questionId = seed.questionContent[0]!.id;
    const first = await request("POST", "/v1/attempts", { questionId }, cookie);
    expect(first.json.elapsedSeconds).toBe(0);
    await new Promise((r) => setTimeout(r, 1200));
    const reloaded = await request("POST", "/v1/attempts", { questionId }, cookie);
    expect(reloaded.json.attemptId).toBe(first.json.attemptId);
    expect(reloaded.json.elapsedSeconds as number).toBeGreaterThanOrEqual(1);
    const parallel = await Promise.all([1, 2, 3].map(() => request("POST", "/v1/attempts", { questionId }, cookie)));
    expect(new Set(parallel.map((r) => r.json.attemptId))).toEqual(new Set([first.json.attemptId]));

    const canonical = seed.questions.find((q) => q.id === questionId)!;
    const submitted = await request("POST", `/v1/attempts/${reloaded.json.attemptId as string}/submit`, { questionId, chosenAnswer: canonical.correctAnswer }, cookie);
    expect(submitted.status).toBe(200);
    expect(submitted.json).toMatchObject({ attemptId: first.json.attemptId, isCorrect: true, status: "submitted" });
    const again = await request("POST", `/v1/attempts/${first.json.attemptId as string}/submit`, { questionId, chosenAnswer: canonical.correctAnswer }, cookie);
    expect(again.status).toBe(409);

    const next = await request("POST", "/v1/attempts", { questionId }, cookie);
    expect(next.json.attemptId).not.toBe(first.json.attemptId); // a finished attempt never resumes
  });

  it("another student starting the same question gets their own attempt and cannot use the first student's", async () => {
    const a = await signupOnboardEnroll("recovery-a@example.com");
    const b = await signupOnboardEnroll("recovery-b@example.com");
    const questionId = seed.questionContent[0]!.id;
    const mine = await request("POST", "/v1/attempts", { questionId }, a);
    const theirs = await request("POST", "/v1/attempts", { questionId }, b);
    expect(theirs.json.attemptId).not.toBe(mine.json.attemptId);
    const stolen = await request("POST", `/v1/attempts/${mine.json.attemptId as string}/submit`, { questionId, chosenAnswer: "x" }, b);
    expect(stolen.status).toBe(403);
    expect(JSON.stringify(stolen.json)).not.toMatch(/startedAt|studentId/);
    const stillMine = await request("POST", "/v1/attempts", { questionId }, a);
    expect(stillMine.json.attemptId).toBe(mine.json.attemptId);
  });

  it("an unauthenticated start is 401 and creates nothing", async () => {
    const res = await request("POST", "/v1/attempts", { questionId: seed.questionContent[0]!.id });
    expect(res.status).toBe(401);
  });
});

describe("skip through the real HTTP path (Product Phase 2 Unit 6)", () => {
  it("start -> skip: a terminal 'skipped' result with no answer key; skip/submit again are 409; result re-readable; next start is a NEW attempt", async () => {
    const cookie = await signupOnboardEnroll("skip-flow@example.com");
    const questionId = seed.questionContent[0]!.id;
    const canonical = seed.questions.find((q) => q.id === questionId)!;
    const started = await request("POST", "/v1/attempts", { questionId }, cookie);
    const attemptId = started.json.attemptId as string;

    const skipped = await request("POST", `/v1/attempts/${attemptId}/skip`, { questionId }, cookie);
    expect(skipped.status).toBe(200);
    expect(skipped.json).toMatchObject({ attemptId, status: "skipped", isCorrect: null, chosenAnswer: null, correctAnswer: null, solutionSteps: [], question: null });
    expect(JSON.stringify(skipped.json)).not.toContain(canonical.solutionSteps![0]!);

    expect((await request("POST", `/v1/attempts/${attemptId}/skip`, { questionId }, cookie)).status).toBe(409);
    expect((await request("POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer: canonical.correctAnswer }, cookie)).status).toBe(409);

    const reread = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, cookie);
    expect(reread.json).toEqual(skipped.json);

    const next = await request("POST", "/v1/attempts", { questionId }, cookie);
    expect(next.json.attemptId).not.toBe(attemptId); // a skipped attempt never resumes
    expect(next.json.elapsedSeconds).toBe(0);
    const submitted = await request("POST", `/v1/attempts/${next.json.attemptId as string}/submit`, { questionId, chosenAnswer: canonical.correctAnswer }, cookie);
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true });
    const stillSkipped = await request("GET", `/v1/attempts/${attemptId}/result`, undefined, cookie);
    expect(stillSkipped.json).toMatchObject({ status: "skipped" });
  });

  it("another student cannot skip someone else's attempt (403) and an unauthenticated skip is 401", async () => {
    const a = await signupOnboardEnroll("skip-owner@example.com");
    const b = await signupOnboardEnroll("skip-other@example.com");
    const questionId = seed.questionContent[0]!.id;
    const attemptId = (await request("POST", "/v1/attempts", { questionId }, a)).json.attemptId as string;
    const stolen = await request("POST", `/v1/attempts/${attemptId}/skip`, { questionId }, b);
    expect(stolen.status).toBe(403);
    expect(JSON.stringify(stolen.json)).not.toMatch(/startedAt|studentId/);
    expect((await request("POST", `/v1/attempts/${attemptId}/skip`, { questionId })).status).toBe(401);
    expect((await request("POST", "/v1/attempts", { questionId }, a)).json.attemptId).toBe(attemptId); // still open for its owner
  });
});

describe("first adaptive layer through the real HTTP path (Phase 3.1)", () => {
  const training = () => (seed.trainingQuestions.get(DEV_EXAM_ID) ?? []).map((r) => r.question);
  const byFamily = (family: string) => training().find((q) => q.patternFamilyName === family)!;
  const canonicalOf = (id: string) => seed.questions.find((q) => q.id === id)!;
  const wrongOptionFor = (id: string) => canonicalOf(id).options!.find((o) => o !== canonicalOf(id).correctAnswer)!;

  async function practice(cookie: string, questionId: string, outcome: "correct" | "wrong" | "skip") {
    const started = await request("POST", "/v1/attempts", { questionId }, cookie);
    const attemptId = started.json.attemptId as string;
    if (outcome === "skip") return request("POST", `/v1/attempts/${attemptId}/skip`, { questionId }, cookie);
    const chosenAnswer = outcome === "correct" ? canonicalOf(questionId).correctAnswer : wrongOptionFor(questionId);
    return request("POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer }, cookie);
  }

  it("the dev pool is what the rules are exercised on: one standard and two advanced Percentages questions", () => {
    expect(training().map((q) => q.difficultyTier).sort()).toEqual(["advanced", "advanced", "standard"]);
  });

  it("no prior performance: a valid, published question with the ordinary coverage copy", async () => {
    const cookie = await signupOnboardEnroll("adaptive-cold@example.com");
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(rec.status).toBe(200);
    expect(training().map((q) => q.questionId)).toContain(rec.json.questionId);
    expect(rec.json.modeLabel).toBe("Coverage");
  });

  it("INCORRECT on an advanced question -> the next recommendation is the related, easier question, with observation-only copy", async () => {
    const cookie = await signupOnboardEnroll("adaptive-incorrect@example.com");
    const missed = byFamily("Successive Percentage Change");
    await practice(cookie, missed.questionId, "wrong");
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(rec.json.modeLabel).toBe("After an incorrect answer");
    expect(rec.json.questionId).toBe(byFamily("Percentage Point vs Percentage Change").questionId); // the standard-tier question
    expect(rec.json.questionId).not.toBe(missed.questionId);
    expect(rec.json.explanation).toMatch(/last answer was incorrect/);
    expect(JSON.stringify(rec.json)).not.toMatch(/correctAnswer|solutionSteps|groundTruth|recent_|primaryReason/);
  });

  it("SKIP -> a different, non-harder question with skip-specific copy (not the incorrect-answer path)", async () => {
    const cookie = await signupOnboardEnroll("adaptive-skip@example.com");
    const skipped = byFamily("Successive Percentage Change");
    const result = await practice(cookie, skipped.questionId, "skip");
    expect(result.json.status).toBe("skipped");
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(rec.json.modeLabel).toBe("After a skipped question");
    expect(rec.json.questionId).toBe(byFamily("Percentage Point vs Percentage Change").questionId);
    expect(rec.json.explanation).toMatch(/skipped your last question/);
  });

  it("CORRECT and on pace is not treated as a problem: ordinary coverage copy, and the answered question is not repeated", async () => {
    const cookie = await signupOnboardEnroll("adaptive-correct@example.com");
    const done = byFamily("Percentage Point vs Percentage Change");
    const result = await practice(cookie, done.questionId, "correct");
    expect(result.json).toMatchObject({ status: "submitted", isCorrect: true });
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    expect(rec.json.questionId).not.toBe(done.questionId);
    expect(String(rec.json.modeLabel)).not.toMatch(/After an incorrect|skipped/);
    expect(JSON.stringify(rec.json)).not.toMatch(/weak|struggl|confiden/i);
  });

  it("another student's performance never affects this student's recommendation", async () => {
    const a = await signupOnboardEnroll("adaptive-iso-a@example.com");
    const b = await signupOnboardEnroll("adaptive-iso-b@example.com");
    await practice(a, byFamily("Successive Percentage Change").questionId, "wrong");
    const recB = await request("POST", "/v1/recommendation", undefined, b);
    expect(recB.json.modeLabel).toBe("Coverage");
  });
});

describe("accumulated evidence through the real HTTP path (Phase 3.2)", () => {
  const training = () => (seed.trainingQuestions.get(DEV_EXAM_ID) ?? []).map((r) => r.question);
  const idOf = (family: string) => training().find((q) => q.patternFamilyName === family)!.questionId;
  const canonicalOf = (id: string) => seed.questions.find((q) => q.id === id)!;

  async function answer(cookie: string, questionId: string, outcome: "correct" | "wrong") {
    const started = await request("POST", "/v1/attempts", { questionId }, cookie);
    const c = canonicalOf(questionId);
    const chosenAnswer = outcome === "correct" ? c.correctAnswer : c.options!.find((o) => o !== c.correctAnswer)!;
    return request("POST", `/v1/attempts/${started.json.attemptId as string}/submit`, { questionId, chosenAnswer }, cookie);
  }
  const play = async (cookie: string, steps: Array<[string, "correct" | "wrong"]>) => {
    for (const [family, outcome] of steps) await answer(cookie, idOf(family), outcome);
  };
  const recommendation = async (cookie: string) => (await request("POST", "/v1/recommendation", undefined, cookie)).json;
  const SUCC = "Successive Percentage Change", REV = "Reverse Percentage", POINT = "Percentage Point vs Percentage Change";

  it("CASE A -- one incorrect answer is met by the recent rule only, never as an accumulated pattern", async () => {
    const cookie = await signupOnboardEnroll("acc-a@example.com");
    await play(cookie, [[SUCC, "wrong"]]);
    const rec = await recommendation(cookie);
    expect(rec.modeLabel).toBe("After an incorrect answer");
    expect(JSON.stringify(rec)).not.toMatch(/Repeated incorrect|Accuracy so far|graded answers/);
  });

  it("CASE B -- three incorrect answers: the accumulated copy states the count as a fact; the just-attempted question is not re-served", async () => {
    const cookie = await signupOnboardEnroll("acc-b@example.com");
    await play(cookie, [[SUCC, "wrong"], [REV, "wrong"], [SUCC, "wrong"]]);
    const rec = await recommendation(cookie);
    expect(rec).toMatchObject({ modeLabel: "Repeated incorrect answers", headline: "More practice on this topic" });
    expect(rec.explanation).toBe("Your last 3 graded answers on Percentages were all incorrect, so here's more practice on Percentages.");
    expect(rec.questionId).not.toBe(idOf(SUCC));
    expect(JSON.stringify(rec)).not.toMatch(/repeated_error|accuracy_weakness|recent_|primaryReason|correctAnswer|solutionSteps|groundTruth/);
    expect(Object.keys(rec).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]);
  });

  it("CASE E -- mixed results state the observed proportion, and it stops once later answers are correct (not permanent)", async () => {
    const cookie = await signupOnboardEnroll("acc-e@example.com");
    await play(cookie, [[POINT, "wrong"], [SUCC, "correct"], [REV, "wrong"], [SUCC, "correct"]]);
    const mixed = await recommendation(cookie);
    expect(mixed.modeLabel).toBe("Accuracy so far");
    expect(mixed.explanation).toBe("2 of your 4 graded answers on Percentages were incorrect, so here's more practice on Percentages.");
    await play(cookie, [[POINT, "correct"], [SUCC, "correct"], [REV, "correct"]]);
    expect((await recommendation(cookie)).modeLabel).not.toBe("Accuracy so far");
  });

  it("PERMANENCE -- two early misses then a long run of correct answers do not keep reporting repeated errors", async () => {
    const cookie = await signupOnboardEnroll("acc-perm@example.com");
    await play(cookie, [[SUCC, "wrong"], [REV, "wrong"], [POINT, "correct"], [SUCC, "correct"], [REV, "correct"], [POINT, "correct"], [SUCC, "correct"], [REV, "correct"]]);
    const rec = await recommendation(cookie);
    expect(String(rec.modeLabel)).not.toMatch(/Repeated incorrect|Accuracy so far/);
  });

  it("CASE D -- three correct on-pace answers on the standard tier: the recommendation moves off the basic question to the advanced tier", async () => {
    const cookie = await signupOnboardEnroll("acc-d@example.com");
    await play(cookie, [[POINT, "correct"], [POINT, "correct"], [POINT, "correct"]]);
    const rec = await recommendation(cookie);
    expect([idOf(SUCC), idOf(REV)]).toContain(rec.questionId);
    expect(String(rec.modeLabel)).not.toMatch(/incorrect|Accuracy/);
  });

  it("isolation: another student's three incorrect answers do not change this student's recommendation", async () => {
    const a = await signupOnboardEnroll("acc-iso-a@example.com");
    const b = await signupOnboardEnroll("acc-iso-b@example.com");
    await play(a, [[SUCC, "wrong"], [REV, "wrong"], [SUCC, "wrong"]]);
    expect((await recommendation(b)).modeLabel).toBe("Coverage");
  });
});

describe("observation-only attempt evidence through the real HTTP path (Phase 4 Unit 1)", () => {
  const canonicalOf = (id: string) => seed.questions.find((q) => q.id === id)!;
  async function startRecommended(cookie: string) {
    const rec = await request("POST", "/v1/recommendation", undefined, cookie);
    const questionId = rec.json.questionId as string;
    const started = await request("POST", "/v1/attempts", { questionId }, cookie);
    return { questionId, attemptId: started.json.attemptId as string, canonical: canonicalOf(questionId) };
  }

  it("is refused before submission (409), and available after submission with neutral observations and no answer key", async () => {
    const cookie = await signupOnboardEnroll("evidence-flow@example.com");
    const { questionId, attemptId, canonical } = await startRecommended(cookie);

    const early = await request("GET", `/v1/attempts/${attemptId}/evidence`, undefined, cookie);
    expect(early.status).toBe(409);
    expect(Object.keys(early.json)).toEqual(["error"]); // a refusal carries no evidence and no answer

    const wrong = canonical.options!.find((o) => o !== canonical.correctAnswer)!;
    await request("POST", `/v1/attempts/${attemptId}/submit`, { questionId, chosenAnswer: wrong }, cookie);
    const evidence = await request("GET", `/v1/attempts/${attemptId}/evidence`, undefined, cookie);
    expect(evidence.status).toBe(200);
    expect(Object.keys(evidence.json).sort()).toEqual(["attemptId", "context", "facts", "history", "notRecorded", "observations", "questionId", "status"]);
    const observations = evidence.json.observations as string[];
    expect(observations).toContain(`Your selected answer was ${wrong}.`);
    expect(observations).toContain("Your answer was incorrect.");
    expect(observations.some((o) => /^You took \d+ seconds?\.$/.test(o))).toBe(true);
    expect(observations.some((o) => o.startsWith("This question was in Percentages"))).toBe(true);
    const text = JSON.stringify(evidence.json);
    // the answer key is never stated: no sentence or field names it (short numeric keys make a substring check meaningless)
    expect(observations.some((o) => o === `Your selected answer was ${canonical.correctAnswer}.`)).toBe(false);
    expect((evidence.json.facts as { selectedAnswer: string }).selectedAnswer).toBe(wrong);
    expect(text).not.toMatch(/solutionSteps|correctAnswer|hypothesis|diagnos|repair|confiden|motivat|careless|understand/i);
  });

  it("a skipped attempt has evidence too (a skip, not a grade); an unknown attempt is 404; another student is refused (403)", async () => {
    const cookie = await signupOnboardEnroll("evidence-skip@example.com");
    const { questionId, attemptId } = await startRecommended(cookie);
    await request("POST", `/v1/attempts/${attemptId}/skip`, { questionId }, cookie);
    const evidence = await request("GET", `/v1/attempts/${attemptId}/evidence`, undefined, cookie);
    expect(evidence.status).toBe(200);
    expect((evidence.json.observations as string[])[0]).toBe("You skipped this question.");
    expect(evidence.json.facts).toMatchObject({ verdict: "not_graded", selectedAnswer: null });

    expect((await request("GET", "/v1/attempts/no-such-attempt/evidence", undefined, cookie)).status).toBe(404);
    const other = await signupOnboardEnroll("evidence-other@example.com");
    expect((await request("GET", `/v1/attempts/${attemptId}/evidence`, undefined, other)).status).toBe(403);
    expect((await request("GET", `/v1/attempts/${attemptId}/evidence`)).status).toBe(401);
  });

  it("history is counted from earlier attempts only, and an earlier attempt's evidence is unchanged by later practice", async () => {
    const cookie = await signupOnboardEnroll("evidence-history@example.com");
    const first = await startRecommended(cookie);
    const wrongOf = (c: { options: string[] | null; correctAnswer: string }) => c.options!.find((o) => o !== c.correctAnswer)!;
    await request("POST", `/v1/attempts/${first.attemptId}/submit`, { questionId: first.questionId, chosenAnswer: wrongOf(first.canonical) }, cookie);
    const firstBefore = (await request("GET", `/v1/attempts/${first.attemptId}/evidence`, undefined, cookie)).json;
    expect(firstBefore.history).toBeNull();

    const second = await startRecommended(cookie);
    await request("POST", `/v1/attempts/${second.attemptId}/submit`, { questionId: second.questionId, chosenAnswer: second.canonical.correctAnswer }, cookie);
    const secondEvidence = (await request("GET", `/v1/attempts/${second.attemptId}/evidence`, undefined, cookie)).json;
    expect(secondEvidence.history).toEqual({ priorAttempts: 1, onConcept: { attempts: 1, correct: 0, incorrect: 1, skipped: 0 } });
    expect((secondEvidence.observations as string[])).toContain("Before this attempt you had 1 earlier attempt on Percentages: 0 correct, 1 incorrect.");
    expect((await request("GET", `/v1/attempts/${first.attemptId}/evidence`, undefined, cookie)).json).toEqual(firstBefore);
  });
});
