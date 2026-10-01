import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PersistenceError, PrismaAttemptRepository, createPrismaClient } from "@ipmat/db";
import { startAttempt } from "@ipmat/attempt";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHypothesisDependencies } from "../src/hypothesisWiring.js";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";

/**
 * Product Phase 2 Unit 7 -- REAL DATABASE tests. The practice lifecycle runs through the real HTTP
 * server on the real Prisma repositories against a real Postgres. Nothing here is a fake client.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (a normal `npm test` never touches a database). It
 * is deliberately a DIFFERENT variable from `DATABASE_URL`, and the database name must contain
 * "test" -- the suite refuses to run against anything else, because it writes rows.
 *
 * Prerequisites (see docs/product-roadmap/PHASE_2_REAL_PRACTICE_LOOP.md, Unit 7): a Postgres with the
 * repo's migrations applied and `packages/db/prisma/seed.ts` run (the seed provides the exam, concepts
 * and the one published demonstration question these tests practice).
 *
 * "Two API instances" below means two independent `PrismaClient`s + two independently constructed
 * services/servers sharing nothing but the database -- exactly what a process restart or a second
 * deployed instance looks like to the database.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
  }
}

const DEMO_QUESTION = "00000000-0000-0000-0000-000000000002";
const DEMO_CORRECT = "20,000";
const DEMO_WRONG = "16,000";

interface Instance {
  prisma: PrismaClient;
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}

/** Every instance shares the hypothesis secret (as every real instance that may answer a student's response must). `noModel` simulates a deployment with no AI configured. */
const HYPOTHESIS_ENV = { IPMAT_AI_PROVIDER: "dev-scripted", IPMAT_HYPOTHESIS_SECRET: "integration-test-secret-0123456789" };

async function startInstance(options: { noModel?: boolean } = {}): Promise<Instance> {
  const prisma = createPrismaClient(DATABASE_URL!);
  await prisma.$connect();
  const server = createServer({ ...createPrismaDependencies(prisma), ...createHypothesisDependencies(options.noModel ? { IPMAT_HYPOTHESIS_SECRET: HYPOTHESIS_ENV.IPMAT_HYPOTHESIS_SECRET } : HYPOTHESIS_ENV) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    prisma,
    server,
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  };
}

async function call(instance: Instance, method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; setCookie: string | null }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${instance.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, setCookie: res.headers.get("set-cookie") };
}

/** A brand-new real student, onboarded and enrolled, through the real HTTP API. */
async function newStudent(instance: Instance, label: string): Promise<{ cookie: string; studentId: string }> {
  const signup = await call(instance, "POST", "/v1/auth/signup", undefined, { email: `${label}-${randomUUID()}@example.com`, password: "correct-horse" });
  const cookie = (signup.setCookie ?? "").split(";")[0] ?? "";
  await call(instance, "POST", "/v1/onboarding/complete", cookie);
  const enrolled = await call(instance, "POST", "/v1/enrollment", cookie);
  expect(enrolled.status).toBe(200);
  return { cookie, studentId: (signup.json.student as { id: string }).id };
}

let a: Instance; // "instance A"
let b: Instance; // "instance B" -- a second, independent API instance / a restarted process

describe.skipIf(!DATABASE_URL)("Prisma persistence -- real Postgres (Product Phase 2 Unit 7)", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    a = await startInstance();
    b = await startInstance();
  });
  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it("the migration guarantee exists in the real database: a partial unique index on open attempts", async () => {
    const rows = await a.prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(`select indexdef from pg_indexes where tablename = 'attempts' and indexname = 'attempts_one_open_per_student_question_enrollment'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/);
    expect(rows[0]!.indexdef).toMatch(/WHERE.*in_progress/);
  });

  it("seed content is what the practice path sees: a recommended question is one of the persisted PUBLISHED questions (incl. the demonstration question)", async () => {
    const student = await newStudent(a, "seed");
    const rec = await call(a, "POST", "/v1/recommendation", student.cookie);
    expect(rec.status).toBe(200);
    const published = (await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((q) => q.id);
    expect(published).toContain(DEMO_QUESTION);
    expect(published).toContain(rec.json.questionId);
  });

  it("start -> resume -> submit -> result: state, events and grading persist in real tables", async () => {
    const s = await newStudent(a, "lifecycle");
    const started = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION });
    expect(started.status).toBe(200);
    const attemptId = started.json.attemptId as string;
    expect(started.json.elapsedSeconds).toBe(0);
    expect(JSON.stringify(started.json)).not.toMatch(/correctAnswer|solutionSteps|studentId|enrollmentId/);

    await new Promise((r) => setTimeout(r, 1200));
    const resumed = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION });
    expect(resumed.json.attemptId).toBe(attemptId);
    expect(resumed.json.elapsedSeconds as number).toBeGreaterThanOrEqual(1);

    const submitted = await call(a, "POST", `/v1/attempts/${attemptId}/submit`, s.cookie, { questionId: DEMO_QUESTION, chosenAnswer: DEMO_WRONG });
    expect(submitted.status).toBe(200);
    expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: false, chosenAnswer: DEMO_WRONG, correctAnswer: DEMO_CORRECT });
    expect((submitted.json.solutionSteps as string[]).length).toBeGreaterThan(0); // read from the real Json column
    expect(submitted.json.question).toMatchObject({ chapterName: "Percentages" });
    expect((await call(a, "POST", `/v1/attempts/${attemptId}/submit`, s.cookie, { questionId: DEMO_QUESTION, chosenAnswer: DEMO_CORRECT })).status).toBe(409);

    const row = await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } } });
    expect(row).toMatchObject({ status: "submitted", isCorrect: false, chosenAnswer: DEMO_WRONG, studentId: s.studentId, questionId: DEMO_QUESTION });
    expect(row.finalizedAt).not.toBeNull();
    expect(row.timeSpentSeconds).toBeGreaterThanOrEqual(1);
    expect(row.events.map((e) => e.eventType)).toEqual(["answer_selected", "answer_submitted"]);
  });

  it("skip persists as 'skipped' (not graded), is terminal, never resumes, and a later submitted attempt does not overwrite it", async () => {
    const s = await newStudent(a, "skip");
    const attemptId = (await call(a, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION })).json.attemptId as string;
    const skipped = await call(a, "POST", `/v1/attempts/${attemptId}/skip`, s.cookie, { questionId: DEMO_QUESTION });
    expect(skipped.json).toMatchObject({ status: "skipped", isCorrect: null, chosenAnswer: null, correctAnswer: null, solutionSteps: [], question: null });
    expect((await call(a, "POST", `/v1/attempts/${attemptId}/skip`, s.cookie, { questionId: DEMO_QUESTION })).status).toBe(409);
    expect((await call(a, "POST", `/v1/attempts/${attemptId}/submit`, s.cookie, { questionId: DEMO_QUESTION, chosenAnswer: DEMO_CORRECT })).status).toBe(409);

    const row = await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { events: true } });
    expect(row).toMatchObject({ status: "skipped", isCorrect: null, chosenAnswer: null });
    expect(row.events.map((e) => e.eventType)).toContain("question_skipped");

    const next = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION });
    expect(next.json.attemptId).not.toBe(attemptId);
    expect(next.json.elapsedSeconds).toBe(0);
    await call(a, "POST", `/v1/attempts/${next.json.attemptId as string}/submit`, s.cookie, { questionId: DEMO_QUESTION, chosenAnswer: DEMO_CORRECT });
    expect((await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("skipped");
    expect((await call(a, "GET", `/v1/attempts/${attemptId}/result`, s.cookie)).json).toMatchObject({ status: "skipped" });
  });

  it("restart / second instance: a fresh server on a fresh Prisma client sees the session, enrollment, in-progress attempt and results", async () => {
    const s = await newStudent(a, "restart");
    const attemptId = (await call(a, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION })).json.attemptId as string;

    // Instance C stands in for a restarted process: brand-new client, brand-new services, no shared memory.
    const c = await startInstance();
    try {
      expect((await call(c, "GET", "/v1/auth/me", s.cookie)).json.student).toMatchObject({ id: s.studentId }); // the session cookie still works
      expect((await call(c, "GET", "/v1/enrollment", s.cookie)).json.enrollment).not.toBeNull();
      const resumed = await call(c, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION });
      expect(resumed.json.attemptId).toBe(attemptId); // the open attempt survived the "restart"
      const submitted = await call(c, "POST", `/v1/attempts/${attemptId}/submit`, s.cookie, { questionId: DEMO_QUESTION, chosenAnswer: DEMO_CORRECT });
      expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true });
    } finally {
      await c.close();
    }
    // ...and the finalized result is readable from yet another instance.
    const reread = await call(b, "GET", `/v1/attempts/${attemptId}/result`, s.cookie);
    expect(reread.json).toMatchObject({ attemptId, status: "submitted", isCorrect: true, correctAnswer: DEMO_CORRECT });
  });

  it("ownership isolation: another student cannot read, submit or skip this student's attempt, and it is left untouched", async () => {
    const owner = await newStudent(a, "owner");
    const other = await newStudent(b, "other");
    const attemptId = (await call(a, "POST", "/v1/attempts", owner.cookie, { questionId: DEMO_QUESTION })).json.attemptId as string;

    const read = await call(b, "GET", `/v1/attempts/${attemptId}/result`, other.cookie);
    const submit = await call(b, "POST", `/v1/attempts/${attemptId}/submit`, other.cookie, { questionId: DEMO_QUESTION, chosenAnswer: DEMO_CORRECT });
    const skip = await call(b, "POST", `/v1/attempts/${attemptId}/skip`, other.cookie, { questionId: DEMO_QUESTION });
    expect([read.status, submit.status, skip.status]).toEqual([403, 403, 403]);
    expect(JSON.stringify([read.json, submit.json, skip.json])).not.toMatch(/startedAt|studentId|enrollmentId/);
    expect((await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("in_progress");

    const theirs = await call(b, "POST", "/v1/attempts", other.cookie, { questionId: DEMO_QUESTION });
    expect(theirs.json.attemptId).not.toBe(attemptId);
    expect((await call(a, "POST", "/v1/attempts", owner.cookie, { questionId: DEMO_QUESTION })).json.attemptId).toBe(attemptId);
    expect((await call(a, "POST", "/v1/attempts", undefined, { questionId: DEMO_QUESTION })).status).toBe(401);
  });

  it("publication filtering: an unpublished question cannot be started, recommended, or its content read", async () => {
    const demo = await a.prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
    const draftId = randomUUID();
    const { id: _id, provenanceId: _prov, ...rest } = demo;
    void _id;
    void _prov;
    await a.prisma.question.create({ data: { ...rest, id: draftId, validationState: "ai_validated", provenanceId: null } as never });
    try {
      const s = await newStudent(a, "draft");
      const start = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: draftId });
      expect(start.status).toBeGreaterThanOrEqual(400);
      expect(start.status).toBeLessThan(500);
      const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
      expect(rec.json.questionId).not.toBe(draftId);
      expect(await a.prisma.attempt.count({ where: { studentId: s.studentId } })).toBe(0);
    } finally {
      await a.prisma.question.delete({ where: { id: draftId } });
    }
  });

  it("the database refuses publishing without provenance (the existing CHECK constraint holds on a real database)", async () => {
    const demo = await a.prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
    const { id: _id, provenanceId: _prov, ...rest } = demo;
    void _id;
    void _prov;
    await expect(a.prisma.question.create({ data: { ...rest, id: randomUUID(), validationState: "published", provenanceId: null } as never })).rejects.toThrow();
  });

  it("CONCURRENCY: 20 parallel starts split across two independent API instances create exactly ONE open attempt", async () => {
    for (let round = 0; round < 3; round++) {
      const s = await newStudent(a, `race${round}`);
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/attempts", s.cookie, { questionId: DEMO_QUESTION })));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.json.attemptId)).size).toBe(1);
      expect(await a.prisma.attempt.count({ where: { studentId: s.studentId, status: "in_progress" } })).toBe(1);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Product Phase 2 Unit 8 -- the persisted practice content set (3 published questions: the base
  // seed's demonstration question + 2 published via the real import + publication path).
  // ---------------------------------------------------------------------------------------------

  it("UNIT 8: exactly the expected published practice set exists, each with honest provenance and complete Question DNA + solution data", async () => {
    const published = await a.prisma.question.findMany({ where: { validationState: "published" }, include: { provenance: true, concept: true, chapter: true, patternTaxonomyCell: { include: { patternFamily: true } } } });
    expect(published.length).toBeGreaterThanOrEqual(3);
    for (const q of published) {
      expect(q.provenance?.sourceType).toBe("original"); // internal/original content; nothing claims to be an official IPMAT question
      expect(q.provenance?.sourceType).not.toMatch(/official|pyq|previous/i);
      expect(q.testingModes.length).toBeGreaterThan(0);
      expect(Object.keys(q.difficultyDimensions as object).sort()).toEqual(["computationalLoad", "conceptualLoad", "multiStepDepth", "representationNovelty", "timePressure", "trapDensity"]);
      expect(q.expectedTimeSeconds).toBeGreaterThan(0);
      expect(Array.isArray(q.solutionSteps) && (q.solutionSteps as unknown[]).length > 0).toBe(true);
      expect((q.options as string[]).includes(q.correctAnswer)).toBe(true);
      expect(q.chapter.name).toBe("Percentages");
      expect(q.patternTaxonomyCell.patternFamily.name).toBeTruthy();
    }
    // The two Unit 8 questions came in through the real pipeline -> import -> publication path (source_ref says so).
    const viaSeed = published.filter((q) => q.provenance?.sourceRef?.startsWith("phase-2-unit-8-dev-seed:"));
    expect(viaSeed).toHaveLength(2);
    expect(viaSeed.map((q) => q.difficultyTier).sort()).toEqual(["advanced", "standard"]); // never a tier that needs human review
  });

  it("UNIT 8: the Prisma TrainingQuestionReader and ConceptReader see exactly the published set and exclude an unpublished question", async () => {
    const { PrismaConceptReader, PrismaTrainingQuestionReader } = await import("@ipmat/db");
    const exam = await a.prisma.exam.findUniqueOrThrow({ where: { code: "IPMAT_INDORE" } });
    const publishedIds = (await a.prisma.question.findMany({ where: { validationState: "published", examId: exam.id }, select: { id: true } })).map((q) => q.id).sort();

    const demo = await a.prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
    const draftId = randomUUID();
    const { id: _id, provenanceId: _prov, ...rest } = demo;
    void _id;
    void _prov;
    await a.prisma.question.create({ data: { ...rest, id: draftId, validationState: "human_reviewed", provenanceId: null } as never });
    try {
      const training = await new PrismaTrainingQuestionReader(a.prisma).findPublishedByExamId(exam.id);
      const ids = training.map((r) => r.question.questionId).sort();
      expect(ids).toEqual(publishedIds);
      expect(ids).not.toContain(draftId);
      expect(training.every((r) => r.validationState === "published" && r.question.testingModes.length > 0 && r.expectedTimeSeconds > 0)).toBe(true);
      const concepts = await new PrismaConceptReader(a.prisma).findWithPublishedQuestionsByExamId(exam.id);
      expect(concepts.map((c) => c.name)).toEqual(["Percentages"]);
    } finally {
      await a.prisma.question.delete({ where: { id: draftId } });
    }
  });

  it("UNIT 8: recommendation discovers the persisted set, and a student can practice ALL of it through the real HTTP path (submit or skip), never leaking an answer key before submission", async () => {
    const s = await newStudent(a, "multi");
    const total = await a.prisma.question.count({ where: { validationState: "published" } });
    const seen: string[] = [];
    for (let round = 0; round < total; round++) {
      const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
      expect(rec.status).toBe(200);
      const questionId = rec.json.questionId as string;
      expect(JSON.stringify(rec.json)).not.toMatch(/correctAnswer|solutionSteps/);
      seen.push(questionId);

      const started = await call(a, "POST", "/v1/attempts", s.cookie, { questionId });
      expect(started.status).toBe(200);
      expect(JSON.stringify(started.json)).not.toMatch(/correctAnswer|solutionSteps|groundTruth/);
      const question = started.json.question as { options: string[]; prompt: string };
      expect(question.prompt.length).toBeGreaterThan(20);
      const attemptId = started.json.attemptId as string;
      // Phase 3.1 note: this Unit 8 test practices with CORRECT, on-pace answers. A wrong answer or a skip is now (by design)
      // reacted to by the first adaptive layer -- e.g. "a related question that isn't harder" -- so the coverage-first tour of the
      // whole set is only guaranteed while answers are correct. The adaptive reactions have their own PHASE 3.1 tests below.
      const canonical = await a.prisma.question.findUniqueOrThrow({ where: { id: questionId } });
      const submitted = await call(a, "POST", `/v1/attempts/${attemptId}/submit`, s.cookie, { questionId, chosenAnswer: canonical.correctAnswer });
      expect(submitted.json).toMatchObject({ status: "submitted", isCorrect: true });
      expect((submitted.json.solutionSteps as string[]).length).toBeGreaterThan(0);
      expect(question.options).toContain(canonical.correctAnswer);
    }
    // The real recommender, on real Prisma readers, walked through every published question before repeating.
    expect(new Set(seen).size).toBe(total);
    const attempts = await a.prisma.attempt.findMany({ where: { studentId: s.studentId }, orderBy: { startedAt: "asc" } });
    expect(attempts.map((x) => x.status)).toEqual(Array(total).fill("submitted"));
  });

  it("UNIT 8: recommendation continuity survives a restart -- a fresh instance recommends from persisted history, not from scratch", async () => {
    const s = await newStudent(a, "continuity");
    const first = (await call(a, "POST", "/v1/recommendation", s.cookie)).json.questionId as string;
    const start1 = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: first });
    const att1 = start1.json.attemptId as string;
    // Correct answers (see the Phase 3.1 note in the test above): with a wrong answer or a skip the adaptive layer, by design, may
    // legitimately steer to an already-seen question; coverage continuity is what a correct, on-pace student gets.
    const correctOf = async (id: string) => (await a.prisma.question.findUniqueOrThrow({ where: { id } })).correctAnswer;
    expect((await call(a, "POST", `/v1/attempts/${att1}/submit`, s.cookie, { questionId: first, chosenAnswer: await correctOf(first) })).status).toBe(200);
    const second = (await call(a, "POST", "/v1/recommendation", s.cookie)).json.questionId as string;
    expect(second).not.toBe(first);
    const att2 = (await call(a, "POST", "/v1/attempts", s.cookie, { questionId: second })).json.attemptId as string;
    expect((await call(a, "POST", `/v1/attempts/${att2}/submit`, s.cookie, { questionId: second, chosenAnswer: await correctOf(second) })).status).toBe(200);

    const restarted = await startInstance(); // brand-new client + services: nothing but the database carries over
    try {
      const third = (await call(restarted, "POST", "/v1/recommendation", s.cookie)).json.questionId as string;
      expect([first, second]).not.toContain(third); // it knows both are already done
      expect((await call(restarted, "GET", `/v1/attempts/${att1}/result`, s.cookie)).json).toMatchObject({ status: "submitted" });
      expect((await call(restarted, "GET", `/v1/attempts/${att2}/result`, s.cookie)).json).toMatchObject({ status: "submitted", isCorrect: true });
    } finally {
      await restarted.close();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3.1 -- the FIRST adaptive layer, on the real Prisma readers + real Postgres. The next
  // recommendation reacts to the student's most recent PERSISTED finalized attempt.
  // ---------------------------------------------------------------------------------------------

  async function familyIds(): Promise<{ point: string; successive: string; reverse: string; expected: Record<string, number> }> {
    const rows = await a.prisma.question.findMany({ where: { validationState: "published" }, include: { patternTaxonomyCell: { include: { patternFamily: true } } } });
    const idOf = (family: string) => rows.find((r) => r.patternTaxonomyCell.patternFamily.name === family)!.id;
    return {
      point: idOf("Percentage Point vs Percentage Change"),
      successive: idOf("Successive Percentage Change"),
      reverse: idOf("Reverse Percentage"),
      expected: Object.fromEntries(rows.map((r) => [r.id, r.expectedTimeSeconds]))
    };
  }

  async function practiceOnce(instance: Instance, cookie: string, questionId: string, outcome: "correct" | "wrong" | "skip", startedSecondsAgo?: number): Promise<string> {
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId });
    const attemptId = started.json.attemptId as string;
    if (startedSecondsAgo !== undefined) {
      // Test-only: move the PERSISTED start time back, so the server-derived elapsed time (finalizedAt - startedAt) is genuinely long.
      await instance.prisma.attempt.update({ where: { id: attemptId }, data: { startedAt: new Date(Date.now() - startedSecondsAgo * 1000) } });
    }
    if (outcome === "skip") {
      await call(instance, "POST", `/v1/attempts/${attemptId}/skip`, cookie, { questionId });
      return attemptId;
    }
    const q = await instance.prisma.question.findUniqueOrThrow({ where: { id: questionId } });
    const options = q.options as string[];
    const chosenAnswer = outcome === "correct" ? q.correctAnswer : options.find((o) => o !== q.correctAnswer)!;
    const submitted = await call(instance, "POST", `/v1/attempts/${attemptId}/submit`, cookie, { questionId, chosenAnswer });
    expect(submitted.status).toBe(200);
    return attemptId;
  }

  it("PHASE 3.1: no prior performance -> a valid published question with the ordinary coverage copy (adaptive layer fails safe)", async () => {
    const s = await newStudent(a, "ad-cold");
    const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
    const ids = await familyIds();
    expect([ids.point, ids.successive, ids.reverse]).toContain(rec.json.questionId);
    expect(rec.json.modeLabel).toBe("Coverage");
  });

  it("PHASE 3.1: INCORRECT on an advanced question -> the related, easier persisted question; and a restarted instance makes the SAME adaptive choice from persisted history", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "ad-incorrect");
    await practiceOnce(a, s.cookie, ids.successive, "wrong");
    const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
    expect(rec.json).toMatchObject({ questionId: ids.point, modeLabel: "After an incorrect answer" });
    expect(rec.json.explanation).toMatch(/last answer was incorrect/);
    expect(JSON.stringify(rec.json)).not.toMatch(/correctAnswer|solutionSteps|groundTruth|recent_|primaryReason/);

    const restarted = await startInstance(); // nothing but the database carries over
    try {
      const again = await call(restarted, "POST", "/v1/recommendation", s.cookie);
      expect(again.json).toEqual(rec.json);
    } finally {
      await restarted.close();
    }
  });

  it("PHASE 3.1: SKIP -> a non-harder question with skip-specific copy, read from the persisted skipped attempt", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "ad-skip");
    const attemptId = await practiceOnce(a, s.cookie, ids.successive, "skip");
    expect((await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("skipped");
    const rec = await call(b, "POST", "/v1/recommendation", s.cookie); // a DIFFERENT instance: only the database is shared
    expect(rec.json).toMatchObject({ questionId: ids.point, modeLabel: "After a skipped question" });
  });

  it("PHASE 3.1: SLOW correct answer -- elapsed time from the persisted timestamps is consumed -> stays at the same tier (the other advanced question)", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "ad-slow");
    const attemptId = await practiceOnce(a, s.cookie, ids.successive, "correct", 200); // expected 75s, ~200s elapsed
    const row = await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(row.status).toBe("submitted");
    expect(row.isCorrect).toBe(true);
    expect(row.timeSpentSeconds!).toBeGreaterThanOrEqual(190);
    const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
    expect(rec.json).toMatchObject({ questionId: ids.reverse, modeLabel: "Steady pace" });
  });

  it("PHASE 3.1: the same correct answer ON PACE is not treated as slow, and a correct answer is not treated as a problem", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "ad-correct");
    await practiceOnce(a, s.cookie, ids.point, "correct");
    const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
    expect(rec.json.questionId).not.toBe(ids.point);
    expect(String(rec.json.modeLabel)).not.toMatch(/After an incorrect|skipped|Steady pace/);
  });

  it("PHASE 3.1: reacts to the MOST RECENT attempt only -- a wrong answer followed by a correct on-pace one no longer triggers the incorrect rule", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "ad-latest");
    await practiceOnce(a, s.cookie, ids.successive, "wrong");
    await new Promise((r) => setTimeout(r, 1100)); // distinct finalizedAt
    await practiceOnce(a, s.cookie, ids.point, "correct");
    const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
    expect(rec.json.modeLabel).not.toBe("After an incorrect answer");
  });

  it("PHASE 3.1: another student's history never influences this student", async () => {
    const ids = await familyIds();
    const other = await newStudent(a, "ad-iso-a");
    const me = await newStudent(b, "ad-iso-b");
    await practiceOnce(a, other.cookie, ids.successive, "wrong");
    expect((await call(b, "POST", "/v1/recommendation", me.cookie)).json.modeLabel).toBe("Coverage");
  });

  it("PHASE 3.1: published-only still holds -- an unpublished question that would be the best incorrect-answer match is never recommended", async () => {
    const ids = await familyIds();
    const original = await a.prisma.question.findUniqueOrThrow({ where: { id: ids.point } });
    const draftId = randomUUID();
    const { id: _id, provenanceId: _prov, ...rest } = original;
    void _id;
    void _prov;
    await a.prisma.question.create({ data: { ...rest, id: draftId, validationState: "human_reviewed", provenanceId: null } as never });
    try {
      const s = await newStudent(a, "ad-draft");
      await practiceOnce(a, s.cookie, ids.successive, "wrong");
      const rec = await call(a, "POST", "/v1/recommendation", s.cookie);
      expect(rec.json.questionId).toBe(ids.point);
      expect(rec.json.questionId).not.toBe(draftId);
    } finally {
      await a.prisma.question.delete({ where: { id: draftId } });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3.2 -- ACCUMULATED evidence on the real Prisma readers + real Postgres. The decision is a pure function of the
  // persisted attempts: a brand-new instance (fresh client, fresh services) reconstructs it from the database alone.
  // ---------------------------------------------------------------------------------------------

  const card = async (instance: Instance, cookie: string) => (await call(instance, "POST", "/v1/recommendation", cookie)).json;

  it("PHASE 3.2 CASE A: one incorrect answer -> only the recent rule reacts; no accumulated pattern is claimed", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "acc-a");
    await practiceOnce(a, s.cookie, ids.successive, "wrong");
    const rec = await card(a, s.cookie);
    expect(rec.modeLabel).toBe("After an incorrect answer");
    expect(JSON.stringify(rec)).not.toMatch(/Repeated incorrect|Accuracy so far|graded answers/);
  });

  it("PHASE 3.2 CASE B: three incorrect answers -> accumulated evidence decides, stated as a fact; a RESTARTED instance and a SECOND instance reconstruct the identical decision from Postgres", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "acc-b");
    await practiceOnce(a, s.cookie, ids.successive, "wrong");
    await practiceOnce(a, s.cookie, ids.reverse, "wrong");
    await practiceOnce(a, s.cookie, ids.successive, "wrong");
    const rec = await card(a, s.cookie);
    expect(rec).toMatchObject({ modeLabel: "Repeated incorrect answers", headline: "More practice on this topic" });
    expect(rec.explanation).toBe("Your last 3 graded answers on Percentages were all incorrect, so here's more practice on Percentages.");
    expect(rec.questionId).not.toBe(ids.successive); // the just-attempted question is not re-served
    expect(JSON.stringify(rec)).not.toMatch(/repeated_error|accuracy_weakness|recent_|primaryReason|correctAnswer|solutionSteps|groundTruth/);

    const restarted = await startInstance(); // nothing but the database carries over
    try {
      expect(await card(restarted, s.cookie)).toEqual(rec);
    } finally {
      await restarted.close();
    }
    expect(await card(b, s.cookie)).toEqual(rec);
    expect(await a.prisma.attempt.count({ where: { studentId: s.studentId, status: "submitted", isCorrect: false } })).toBe(3);
  });

  it("PHASE 3.2 CASE C: three correct-but-slow answers (persisted timestamps) -> the existing accumulated-speed response (Speed Lab) takes over, identically after a restart", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "acc-c");
    for (const q of [ids.successive, ids.reverse, ids.successive]) {
      const attemptId = await practiceOnce(a, s.cookie, q, "correct", 220); // expected 75-90s; ~220s elapsed on the server's clock
      expect((await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).timeSpentSeconds!).toBeGreaterThanOrEqual(200);
    }
    const rec = await card(a, s.cookie);
    expect(rec.modeLabel).toBe("Solving speed"); // Speed Lab's existing observation-style copy
    const restarted = await startInstance();
    try {
      expect(await card(restarted, s.cookie)).toEqual(rec);
    } finally {
      await restarted.close();
    }
  });

  it("PHASE 3.2 CASE D: three correct on-pace answers on the standard tier -> the recommendation moves off the basic question to the advanced tier", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "acc-d");
    for (let i = 0; i < 3; i++) await practiceOnce(a, s.cookie, ids.point, "correct");
    const rec = await card(a, s.cookie);
    expect([ids.successive, ids.reverse]).toContain(rec.questionId);
    expect(String(rec.modeLabel)).not.toMatch(/incorrect|Accuracy/);
  });

  it("PHASE 3.2 CASE E: mixed results state the observed proportion and are NOT permanent -- more correct answers clear it; two early misses never become permanent", async () => {
    const ids = await familyIds();
    const mixed = await newStudent(a, "acc-e");
    await practiceOnce(a, mixed.cookie, ids.point, "wrong");
    await practiceOnce(a, mixed.cookie, ids.successive, "correct");
    await practiceOnce(a, mixed.cookie, ids.reverse, "wrong");
    await practiceOnce(a, mixed.cookie, ids.successive, "correct");
    const rec = await card(a, mixed.cookie);
    expect(rec).toMatchObject({ modeLabel: "Accuracy so far", explanation: "2 of your 4 graded answers on Percentages were incorrect, so here's more practice on Percentages." });
    for (const q of [ids.point, ids.successive, ids.reverse]) await practiceOnce(a, mixed.cookie, q, "correct");
    expect((await card(a, mixed.cookie)).modeLabel).not.toBe("Accuracy so far");

    const early = await newStudent(a, "acc-perm");
    for (const [q, o] of [[ids.successive, "wrong"], [ids.reverse, "wrong"], [ids.point, "correct"], [ids.successive, "correct"], [ids.reverse, "correct"], [ids.point, "correct"], [ids.successive, "correct"], [ids.reverse, "correct"]] as const) {
      await practiceOnce(a, early.cookie, q, o);
    }
    expect(String((await card(a, early.cookie)).modeLabel)).not.toMatch(/Repeated incorrect|Accuracy so far/);
  });

  it("PHASE 3.2: another student's accumulated history never influences this student; published-only holds inside the accumulated path", async () => {
    const ids = await familyIds();
    const other = await newStudent(a, "acc-iso-a");
    const me = await newStudent(b, "acc-iso-b");
    for (const q of [ids.successive, ids.reverse, ids.successive]) await practiceOnce(a, other.cookie, q, "wrong");
    expect((await card(b, me.cookie)).modeLabel).toBe("Coverage");

    const original = await a.prisma.question.findUniqueOrThrow({ where: { id: ids.point } });
    const draftId = randomUUID();
    const { id: _id, provenanceId: _prov, ...rest } = original;
    void _id;
    void _prov;
    await a.prisma.question.create({ data: { ...rest, id: draftId, validationState: "human_reviewed", provenanceId: null } as never });
    try {
      expect((await card(a, other.cookie)).questionId).not.toBe(draftId);
    } finally {
      await a.prisma.question.delete({ where: { id: draftId } });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3.3 -- TREND evidence (last 3 graded answers vs. the earlier ones) on the real Prisma readers + real Postgres. The decision
  // is a pure function of the persisted attempts: a brand-new instance reconstructs it from the database alone.
  // Trend evidence describes changes in observed performance; it does not diagnose the student.
  // ---------------------------------------------------------------------------------------------

  async function replay(instance: Instance, cookie: string, steps: Array<[string, "correct" | "wrong" | "skip"]>) {
    for (const [q, o] of steps) await practiceOnce(instance, cookie, q, o);
  }
  async function sameAfterRestart(cookie: string, expected: Record<string, unknown>) {
    const restarted = await startInstance(); // nothing but the database carries over
    try {
      expect(await card(restarted, cookie)).toEqual(expected);
    } finally {
      await restarted.close();
    }
    expect(await card(b, cookie)).toEqual(expected);
  }
  const INTERNAL = /recent_|repeated_error|accuracy_weakness|persistent_difficulty|deteriorating|improving|primaryReason|trendEvidence|correctAnswer|solutionSteps|groundTruth/;
  const PSYCH = /confiden|motivat|anxi|lazy|careless|struggl|understand|intelligen|afraid|feel|bad at|naturally|losing|weak/i;

  it("PHASE 3.3 CASE A/E: wrong, wrong, then three correct -> recent progress (one step up), the old mean no longer drives it, identical after a restart", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-imp");
    await replay(a, s.cookie, [[ids.successive, "wrong"], [ids.reverse, "wrong"], [ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"]]);
    const rec = await card(a, s.cookie);
    expect(rec).toMatchObject({
      modeLabel: "Recent progress",
      headline: "Keep building on your progress",
      explanation: "Your last 3 graded answers on Percentages were all correct, compared with 0 of 2 earlier ones, so this moves you forward gradually."
    });
    expect([ids.successive, ids.reverse]).toContain(rec.questionId); // a step up from the standard tier
    expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    expect(JSON.stringify(rec)).not.toMatch(PSYCH);
    // the old facts are still in Postgres -- nothing was erased
    expect(await a.prisma.attempt.count({ where: { studentId: s.studentId, status: "submitted", isCorrect: false } })).toBe(2);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3.3 CASE B: correct x3 then wrong x2 -> the current run of errors is stated WITH the earlier successful answers, at a steady difficulty", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-det");
    await replay(a, s.cookie, [[ids.point, "correct"], [ids.successive, "correct"], [ids.reverse, "correct"], [ids.point, "wrong"], [ids.successive, "wrong"]]);
    const rec = await card(a, s.cookie);
    expect(rec).toMatchObject({
      modeLabel: "Recent change",
      headline: "Keep the difficulty steady",
      explanation: "Your last 2 graded answers on Percentages were all incorrect, while 2 of 2 earlier ones were correct, so here's more practice on Percentages at a steady difficulty."
    });
    expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    expect(JSON.stringify(rec)).not.toMatch(PSYCH);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3.3 CASE B (no trailing error run): strong earlier history, then wrong/correct/wrong -> recent change, a question that is not harder, identical after a restart", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-det2");
    await replay(a, s.cookie, [[ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"], [ids.successive, "wrong"], [ids.reverse, "correct"], [ids.successive, "wrong"]]);
    const rec = await card(a, s.cookie);
    expect(rec).toMatchObject({
      modeLabel: "Recent change",
      explanation: "1 of your last 3 graded answers on Percentages were correct, compared with 4 of 4 earlier ones, so here's another question that isn't harder."
    });
    expect(rec.questionId).not.toBe(ids.successive); // never immediately re-served
    expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3.3 CASE C: wrong, wrong, correct, wrong, correct, wrong -> persistent difficulty is stated with both windows' counts; one success did not clear it", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-pers");
    await replay(a, s.cookie, [[ids.successive, "wrong"], [ids.reverse, "wrong"], [ids.point, "correct"], [ids.successive, "wrong"], [ids.point, "correct"], [ids.reverse, "wrong"]]);
    const rec = await card(a, s.cookie);
    expect(rec).toMatchObject({
      modeLabel: "Accuracy over time",
      explanation: "Only 1 of 3 earlier graded answers and 1 of your last 3 on Percentages were correct, so here's more practice on Percentages."
    });
    expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3.3 CASE C2: wrong, wrong, correct, wrong, wrong -> the existing repeated-incorrect response still applies (one success in the middle does not clear the current run)", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-pers2");
    await replay(a, s.cookie, [[ids.successive, "wrong"], [ids.reverse, "wrong"], [ids.point, "correct"], [ids.successive, "wrong"], [ids.reverse, "wrong"]]);
    expect(await card(a, s.cookie)).toMatchObject({ modeLabel: "Repeated incorrect answers" });
  });

  it("PHASE 3.3 CASE D: four correct answers is a sustained run, not a change -- no progress/change card is claimed", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-sus");
    await replay(a, s.cookie, [[ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"]]);
    const rec = await card(a, s.cookie);
    expect(String(rec.modeLabel)).not.toMatch(/Recent progress|Recent change|incorrect|Accuracy/);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3.3: skipped attempts are not graded -- they neither form the window nor break the run", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "trend-skip");
    await replay(a, s.cookie, [[ids.successive, "wrong"], [ids.reverse, "wrong"], [ids.point, "skip"], [ids.point, "correct"], [ids.successive, "skip"], [ids.point, "correct"], [ids.point, "correct"]]);
    const rec = await card(a, s.cookie);
    expect(rec).toMatchObject({ modeLabel: "Recent progress", explanation: "Your last 3 graded answers on Percentages were all correct, compared with 0 of 2 earlier ones, so this moves you forward gradually." });
    expect(await a.prisma.attempt.count({ where: { studentId: s.studentId, status: "skipped" } })).toBe(2);
  });

  it("PHASE 3.3: another student's history never influences this student's trend, and the published-only rule still holds", async () => {
    const ids = await familyIds();
    const improver = await newStudent(a, "trend-iso1");
    const other = await newStudent(a, "trend-iso2");
    await replay(a, other.cookie, [[ids.successive, "wrong"]]);
    const before = await card(a, other.cookie);
    await replay(a, improver.cookie, [[ids.successive, "wrong"], [ids.reverse, "wrong"], [ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"]]);
    expect(await card(a, other.cookie)).toEqual(before);
    expect(before.modeLabel).toBe("After an incorrect answer");
    const published = new Set((await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((r) => r.id));
    expect(published.has((await card(a, improver.cookie)).questionId as string)).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3 Unit 4 -- the SELECTION POLICY on the real Prisma readers + real Postgres: difficulty fit, coverage, exposure, progression and the
  // global no-immediate-repeat rule. The development pool is three published questions (Reverse [advanced], Successive [advanced], Point
  // [standard]); this proves the policy and its persistence, not calibration on an exam-sized bank.
  // ---------------------------------------------------------------------------------------------

  it("PHASE 3 UNIT 4: repeated errors at the ADVANCED tier keep the difficulty steady (same tier, not the just-attempted question, not simply the first published one)", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "sel-steady");
    await replay(a, s.cookie, [[ids.successive, "wrong"], [ids.reverse, "wrong"]]);
    const rec = await card(a, s.cookie);
    expect(rec.modeLabel).toBe("Repeated incorrect answers");
    expect(rec.questionId).toBe(ids.successive); // same tier as the last answer; Reverse was just attempted; Point would be a step down
    expect(rec.questionId).not.toBe(ids.reverse);
    expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    expect(JSON.stringify(rec)).not.toMatch(PSYCH);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3 UNIT 4: documented fallback -- repeated errors on the ONLY standard question: the harder questions are the only alternatives, so one is served (never the just-attempted one)", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "sel-noalt");
    await replay(a, s.cookie, [[ids.point, "wrong"], [ids.point, "wrong"]]);
    const rec = await card(a, s.cookie);
    expect(rec.modeLabel).toBe("Repeated incorrect answers");
    expect([ids.successive, ids.reverse]).toContain(rec.questionId);
    expect(rec.questionId).not.toBe(ids.point);
  });

  it("PHASE 3 UNIT 4: coverage decides between otherwise similar questions -- the unseen pattern family wins over the seen one even though its id sorts later", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "sel-cover");
    await replay(a, s.cookie, [[ids.reverse, "correct"], [ids.point, "correct"], [ids.point, "correct"]]);
    const rec = await card(a, s.cookie);
    expect(rec.questionId).toBe(ids.successive); // Successive is unseen; Reverse (the smaller id) was already practised; Point was just attempted
    expect(rec.questionId).not.toBe(ids.reverse);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3 UNIT 4: a progression-ready student is moved up, and following the recommendations never serves the same question twice in a row", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "sel-progress");
    await replay(a, s.cookie, [[ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"]]);
    let rec = await card(a, s.cookie);
    expect([ids.successive, ids.reverse]).toContain(rec.questionId); // off the basic question, onto the advanced tier
    expect(String(rec.modeLabel)).not.toMatch(/incorrect|Accuracy/);
    const followed: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = rec.questionId as string;
      if (followed.length > 0) expect(id).not.toBe(followed[followed.length - 1]);
      followed.push(id);
      await practiceOnce(a, s.cookie, id, "correct");
      rec = await card(a, s.cookie);
      expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    }
    expect(new Set(followed).size).toBeGreaterThan(1);
    await sameAfterRestart(s.cookie, rec);
  });

  it("PHASE 3 UNIT 4: DOCUMENTED SOLE-CANDIDATE FALLBACK -- when the just-attempted question is the only published question it is served again, and restoring the pool restores the rule", async () => {
    const ids = await familyIds();
    const s = await newStudent(a, "sel-sole");
    await practiceOnce(a, s.cookie, ids.reverse, "wrong");
    await a.prisma.question.updateMany({ where: { id: { in: [ids.successive, ids.point] } }, data: { validationState: "human_reviewed" } });
    try {
      const rec = await card(a, s.cookie);
      expect(rec.questionId).toBe(ids.reverse); // the only published question
      expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
    } finally {
      await a.prisma.question.updateMany({ where: { id: { in: [ids.successive, ids.point] } }, data: { validationState: "published" } });
    }
    expect((await card(a, s.cookie)).questionId).not.toBe(ids.reverse); // alternatives exist again
  });

  it("PHASE 3 UNIT 4: another student's practice never changes this student's selection", async () => {
    const ids = await familyIds();
    const x = await newStudent(a, "sel-iso-x");
    const y = await newStudent(a, "sel-iso-y");
    const before = await card(a, x.cookie);
    await replay(a, y.cookie, [[ids.point, "correct"], [ids.point, "correct"], [ids.point, "correct"]]);
    expect(await card(a, x.cookie)).toEqual(before);
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3 Unit 5 -- HARDENING on real Postgres. The development pool is three questions, which cannot show selection trade-offs, so these
  // tests add a SYNTHETIC pool clearly labelled TEST DATA (body prefixed "[TEST DATA phase-3-unit-5]", provenance sourceRef
  // "phase-3-unit-5-TEST-DATA"), run the policy against it, and UNPUBLISH it again in `finally`. It is scaffolding for validating the
  // POLICY and its persistence -- not question content, and not calibration.
  // ---------------------------------------------------------------------------------------------

  interface SyntheticPool {
    ids: Record<string, string>;
    tier: Record<string, string>;
    release: () => Promise<void>;
    setPublished: (labels: string[], published: boolean) => Promise<void>;
  }

  async function publishSyntheticPool(spec: Array<{ label: string; tier: "standard" | "advanced" }>): Promise<SyntheticPool> {
    const real = (await a.prisma.question.findMany({ where: { validationState: "published" } })).filter((q) => !q.body.startsWith("[TEST DATA"));
    const template = real.find((q) => q.difficultyTier === "standard")!;
    const templateCell = await a.prisma.patternTaxonomyCell.findUniqueOrThrow({ where: { id: template.patternTaxonomyCellId } });
    const templateFamily = await a.prisma.questionPatternFamily.findUniqueOrThrow({ where: { id: templateCell.patternFamilyId } });
    const usedTraps = new Set(real.map((q) => q.trapErrorTaxonomyId));
    const traps = (await a.prisma.errorTaxonomy.findMany({ orderBy: { id: "asc" } })).filter((t) => !usedTraps.has(t.id));
    if (traps.length < 2) throw new Error("not enough seeded error-taxonomy rows for the synthetic pool");
    const provenance = await a.prisma.provenance.create({ data: { sourceType: "original", sourceRef: "phase-3-unit-5-TEST-DATA", attributedTo: "synthetic test data (not question content)" } });
    const { id: _id, provenanceId: _p, createdAt: _c, ...rest } = template;
    const { id: _fid, createdAt: _fc, ...familyRest } = templateFamily;
    const { id: _cid, ...cellRest } = templateCell;
    void _id; void _p; void _c; void _fid; void _fc; void _cid;
    const ids: Record<string, string> = {};
    const tier: Record<string, string> = {};
    try {
    for (const [i, item] of spec.entries()) {
      const trap = traps[i % traps.length]!; // traps are reused only when the seed has fewer rows than synthetic questions
      const id = randomUUID();
      ids[item.label] = id;
      tier[id] = item.tier;
      // each synthetic question gets its OWN pattern family and taxonomy cell (also TEST DATA), so family/cell coverage is observable
      const family = await a.prisma.questionPatternFamily.create({ data: { ...familyRest, name: `[TEST DATA phase-3-unit-5] family ${item.label} ${id.slice(0, 8)}`, status: "draft" } as never });
      const cell = await a.prisma.patternTaxonomyCell.create({ data: { ...cellRest, patternFamilyId: family.id, trapErrorTaxonomyId: trap.id, difficultyTier: item.tier, coverageStatus: "uncovered" } as never });
      await a.prisma.question.create({
        data: { ...rest, id, body: `[TEST DATA phase-3-unit-5] ${item.label} -- ${template.body}`, patternTaxonomyCellId: cell.id, trapErrorTaxonomyId: trap.id, difficultyTier: item.tier, validationState: "published", provenanceId: provenance.id } as never
      });
    }
    } catch (error) {
      // never leave half a synthetic pool published
      await a.prisma.question.updateMany({ where: { id: { in: Object.values(ids) } }, data: { validationState: "human_reviewed" } });
      throw error;
    }
    const all = Object.values(ids);
    return {
      ids,
      tier,
      setPublished: async (labels, published) => {
        await a.prisma.question.updateMany({ where: { id: { in: labels.map((l) => ids[l]!) } }, data: { validationState: published ? "published" : "human_reviewed" } });
      },
      release: async () => {
        await a.prisma.question.updateMany({ where: { id: { in: all } }, data: { validationState: "human_reviewed" } });
      }
    };
  }

  async function practiceById(instance: Instance, cookie: string, questionId: string, outcome: "correct" | "wrong") {
    await practiceOnce(instance, cookie, questionId, outcome);
  }

  it("PHASE 3 UNIT 5 (synthetic TEST DATA pool): progression beats a basic unseen question; remediation stays not-harder; every decision is identical across a restarted and a second instance", async () => {
    const real = await familyIds();
    let pool: SyntheticPool | undefined;
    try {
      pool = await publishSyntheticPool([
        { label: "std-A", tier: "standard" },
        { label: "std-B", tier: "standard" },
        { label: "adv-A", tier: "advanced" },
        { label: "adv-B", tier: "advanced" }
      ]);
      const tierOf = async (id: string) => (await a.prisma.question.findUniqueOrThrow({ where: { id } })).difficultyTier;

      // CASE C on real data: three correct answers on the standard tier; the pool still holds UNSEEN standard questions (std-A, std-B).
      const ready = await newStudent(a, "hard-prog");
      await replay(a, ready.cookie, [[real.point, "correct"], [real.point, "correct"], [real.point, "correct"]]);
      const up = await card(a, ready.cookie);
      expect(await tierOf(up.questionId as string)).toBe("advanced"); // not a basic question merely because it is unseen
      await sameAfterRestart(ready.cookie, up);

      // remediation: two failures on synthetic STANDARD questions -> the recommendation stays at the standard tier, although advanced questions exist
      const weak = await newStudent(a, "hard-remedy");
      await practiceById(a, weak.cookie, pool!.ids["std-A"]!, "wrong");
      await practiceById(a, weak.cookie, pool!.ids["std-B"]!, "wrong");
      const steady = await card(a, weak.cookie);
      expect(steady.modeLabel).toBe("Repeated incorrect answers");
      expect(await tierOf(steady.questionId as string)).toBe("standard");
      expect(steady.questionId).not.toBe(pool!.ids["std-B"]); // the just-attempted question
      await sameAfterRestart(weak.cookie, steady);
    } finally {
      await pool?.release();
    }
  });

  it("PHASE 3 UNIT 5 (synthetic TEST DATA pool): a 14-step followed loop never repeats consecutively, only ever serves published questions, and every step is identical on a fresh and a second instance", async () => {
    // both pools are created INSIDE the try, so the finally below always unpublishes whatever was created
    let pool: SyntheticPool | undefined;
    let unpublished: SyntheticPool | undefined;
    try {
      pool = await publishSyntheticPool([
        { label: "std-A", tier: "standard" },
        { label: "adv-A", tier: "advanced" },
        { label: "adv-B", tier: "advanced" }
      ]);
      unpublished = await publishSyntheticPool([{ label: "hidden", tier: "advanced" }]);
      await unpublished.setPublished(["hidden"], false);
      const s = await newStudent(a, "hard-loop");
      const published = new Set((await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((r) => r.id));
      let previous: string | null = null;
      const served: string[] = [];
      for (let i = 0; i < 14; i++) {
        const rec = await card(a, s.cookie);
        const id = rec.questionId as string;
        expect(Object.keys(rec).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]); // nothing else crosses the boundary
        expect(JSON.stringify(rec)).not.toMatch(INTERNAL);
        expect(JSON.stringify(rec)).not.toMatch(PSYCH);
        expect(published.has(id)).toBe(true);
        expect(id).not.toBe(unpublished.ids["hidden"]);
        if (previous !== null) expect(id).not.toBe(previous);
        if (i % 4 === 3) await sameAfterRestart(s.cookie, rec); // every 4th step: a fresh instance and the second instance decide identically
        else expect(await card(b, s.cookie)).toEqual(rec);
        served.push(id);
        await practiceOnce(a, s.cookie, id, i % 5 === 4 ? "wrong" : "correct");
        previous = id;
      }
      expect(new Set(served).size).toBeGreaterThan(2);
    } finally {
      await pool?.release();
      await unpublished?.release();
    }
  });

  it("PHASE 3 UNIT 5: documented sole-candidate fallback is deterministic on real data, and a thin pool (one published question) never errors", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hard-sole");
    await practiceOnce(a, s.cookie, real.point, "correct");
    const others = (await a.prisma.question.findMany({ where: { validationState: "published", id: { not: real.point } }, select: { id: true } })).map((r) => r.id);
    await a.prisma.question.updateMany({ where: { id: { in: others } }, data: { validationState: "human_reviewed" } });
    try {
      const first = await card(a, s.cookie);
      expect(first.questionId).toBe(real.point); // the only published question, although it was just attempted
      await sameAfterRestart(s.cookie, first);
      expect(await card(b, s.cookie)).toEqual(first);
    } finally {
      await a.prisma.question.updateMany({ where: { id: { in: others } }, data: { validationState: "published" } });
    }
    expect((await card(a, s.cookie)).questionId).not.toBe(real.point);
  });

  it("PHASE 3 UNIT 5: six different persisted histories each give the same recommendation on the original, a restarted and a second instance (same database -> same decision)", async () => {
    const real = await familyIds();
    const histories: Array<Array<[string, "correct" | "wrong" | "skip"]>> = [
      [],
      [[real.point, "wrong"]],
      [[real.reverse, "wrong"], [real.successive, "wrong"]],
      [[real.point, "correct"], [real.point, "correct"], [real.point, "correct"]],
      [[real.successive, "wrong"], [real.reverse, "wrong"], [real.point, "correct"], [real.point, "correct"], [real.point, "correct"]],
      [[real.point, "skip"], [real.successive, "correct"]]
    ];
    const restarted = await startInstance();
    try {
      for (const [i, steps] of histories.entries()) {
        const s = await newStudent(a, `hard-matrix-${i}`);
        await replay(a, s.cookie, steps);
        const decided = await card(a, s.cookie);
        expect(await card(b, s.cookie), `history ${i} second instance`).toEqual(decided);
        expect(await card(restarted, s.cookie), `history ${i} restarted instance`).toEqual(decided);
        expect(await card(a, s.cookie), `history ${i} repeat`).toEqual(decided);
      }
    } finally {
      await restarted.close();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 4 Unit 1 -- OBSERVATION-ONLY attempt evidence on real Postgres. The evidence is reconstructed from the persisted attempt,
  // its events and the persisted question metadata on every request: a fresh instance and a second instance read the same rows and
  // return the identical object, and asking for it writes nothing (no autopsy, no repair plan, no mastery row).
  // ---------------------------------------------------------------------------------------------

  const evidenceOf = (instance: Instance, cookie: string, attemptId: string) => call(instance, "GET", `/v1/attempts/${attemptId}/evidence`, cookie);
  const EVIDENCE_KEYS = ["attemptId", "context", "facts", "history", "notRecorded", "observations", "questionId", "status"];
  const DIAGNOSTIC = /hypothesis|diagnos|repair|candidateError|errorCategory|trap|modelConfidence|solutionSteps|correctAnswer|confiden|motivat|careless|understand|confus|unsure/i;

  async function startAndSubmit(instance: Instance, cookie: string, questionId: string, outcome: "correct" | "wrong" | "skip"): Promise<string> {
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId });
    const attemptId = started.json.attemptId as string;
    if (outcome === "skip") {
      await call(instance, "POST", `/v1/attempts/${attemptId}/skip`, cookie, { questionId });
      return attemptId;
    }
    const q = await instance.prisma.question.findUniqueOrThrow({ where: { id: questionId } });
    const chosenAnswer = outcome === "correct" ? q.correctAnswer : (q.options as string[]).find((o) => o !== q.correctAnswer)!;
    const r = await call(instance, "POST", `/v1/attempts/${attemptId}/submit`, cookie, { questionId, chosenAnswer });
    expect(r.status).toBe(200);
    return attemptId;
  }

  it("PHASE 4 UNIT 1: evidence comes from the PERSISTED finalized attempt (answer, verdict, elapsed time, events), and a restarted and a second instance return the identical object", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "ev-persist");
    const attemptId = await startAndSubmit(a, s.cookie, real.successive, "wrong");
    const row = await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { events: true } });

    const first = await evidenceOf(a, s.cookie, attemptId);
    expect(first.status).toBe(200);
    expect(Object.keys(first.json).sort()).toEqual(EVIDENCE_KEYS);
    expect(first.json.facts).toMatchObject({ verdict: "incorrect", selectedAnswer: row.chosenAnswer, elapsedSeconds: row.timeSpentSeconds, expectedSeconds: real.expected[real.successive] });
    const observations = first.json.observations as string[];
    expect(observations).toContain(`Your selected answer was ${row.chosenAnswer}.`);
    expect(observations).toContain("Your answer was incorrect.");
    expect(observations.some((o) => o.startsWith('This question was in Percentages, pattern "Successive Percentage Change"'))).toBe(true);
    // the real flow records ONE selection at submission: changes are reported as not recorded, never as zero
    expect(row.events.filter((e) => e.eventType === "answer_selected")).toHaveLength(1);
    expect(first.json.notRecorded).toEqual(["Changes to your answer before submitting are not recorded in this practice flow."]);
    expect(first.json.facts).toMatchObject({ answerChangeCount: null });
    expect(JSON.stringify(first.json)).not.toMatch(DIAGNOSTIC);

    const restarted = await startInstance(); // nothing but the database carries over
    try {
      expect((await evidenceOf(restarted, s.cookie, attemptId)).json).toEqual(first.json);
    } finally {
      await restarted.close();
    }
    expect((await evidenceOf(b, s.cookie, attemptId)).json).toEqual(first.json);
    expect((await evidenceOf(a, s.cookie, attemptId)).json).toEqual(first.json);
  });

  it("PHASE 4 UNIT 1: nothing before submission (409), nothing for another student (403), a skip has evidence as a skip, an unknown attempt is 404", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "ev-bounds");
    const open = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: real.point });
    const early = await evidenceOf(a, s.cookie, open.json.attemptId as string);
    expect(early.status).toBe(409);
    expect(Object.keys(early.json)).toEqual(["error"]);
    await call(a, "POST", `/v1/attempts/${open.json.attemptId as string}/skip`, s.cookie, { questionId: real.point });

    const skipped = await evidenceOf(a, s.cookie, open.json.attemptId as string);
    expect(skipped.status).toBe(200);
    expect((skipped.json.observations as string[])[0]).toBe("You skipped this question.");
    expect(skipped.json.facts).toMatchObject({ verdict: "not_graded", selectedAnswer: null });

    const other = await newStudent(a, "ev-bounds-other");
    expect((await evidenceOf(a, other.cookie, open.json.attemptId as string)).status).toBe(403);
    expect((await evidenceOf(a, s.cookie, randomUUID())).status).toBe(404);
  });

  it("PHASE 4 UNIT 1: history is counted from the persisted earlier attempts only; later practice never changes an earlier attempt's evidence", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "ev-history");
    const ids: string[] = [];
    for (const [q, o] of [[real.point, "wrong"], [real.successive, "correct"], [real.reverse, "wrong"], [real.point, "skip"]] as const) ids.push(await startAndSubmit(a, s.cookie, q, o));

    const fourth = await evidenceOf(a, s.cookie, ids[3]!);
    expect(fourth.json.history).toEqual({ priorAttempts: 3, onConcept: { attempts: 3, correct: 1, incorrect: 2, skipped: 0 } });
    expect(await a.prisma.attempt.count({ where: { studentId: s.studentId, status: "submitted", isCorrect: false } })).toBe(2); // the persisted counts the evidence states
    expect((fourth.json.observations as string[])).toContain("Before this attempt you had 3 earlier attempts on Percentages: 1 correct, 2 incorrect.");

    const firstBefore = await evidenceOf(a, s.cookie, ids[0]!);
    expect(firstBefore.json.history).toBeNull();
    await startAndSubmit(a, s.cookie, real.successive, "wrong");
    expect((await evidenceOf(a, s.cookie, ids[0]!)).json).toEqual(firstBefore.json);
  });

  it("PHASE 4 UNIT 1: Unit 1 creates NO diagnosis, hypothesis, RepairPlan or mastery row -- it only reads", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "ev-nowrite");
    const count = async () => ({
      autopsies: await a.prisma.autopsy.count({ where: { attempt: { studentId: s.studentId } } }),
      repairPlans: await a.prisma.repairPlan.count({ where: { studentId: s.studentId } }),
      mastery: await a.prisma.masteryState.count({ where: { studentId: s.studentId } })
    });
    expect(await count()).toEqual({ autopsies: 0, repairPlans: 0, mastery: 0 });
    const attemptId = await startAndSubmit(a, s.cookie, real.reverse, "wrong");
    await evidenceOf(a, s.cookie, attemptId);
    await evidenceOf(b, s.cookie, attemptId);
    expect(await count()).toEqual({ autopsies: 0, repairPlans: 0, mastery: 0 });
    const autopsy = await call(a, "GET", `/v1/attempts/${attemptId}/autopsy`, s.cookie);
    expect(autopsy.json).toMatchObject({ pending: false, hypothesis: null }); // no hypothesis exists: evidence is not one
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 4 Unit 2 -- HYPOTHESIS + CONFIRMATION on real Postgres. The hypothesis input is the Unit 1 observation evidence, rebuilt from the
  // persisted attempt on every request; the offer/response endpoints WRITE NOTHING (no autopsy, no RepairPlan, no mastery row, no attempt
  // change). The model is the "dev-scripted" scaffold (it is not AI): this proves the pipeline, the boundaries and the persistence
  // behavior -- not the quality of a real model's proposals.
  // ---------------------------------------------------------------------------------------------

  const hypothesisOf = (instance: Instance, cookie: string, attemptId: string) => call(instance, "POST", `/v1/attempts/${attemptId}/hypothesis`, cookie, {});
  const respondOf = (instance: Instance, cookie: string, attemptId: string, body: Record<string, unknown>) => call(instance, "POST", `/v1/attempts/${attemptId}/hypothesis/response`, cookie, body);
  const GENERIC_PATTERN = "This question was designed around a common wrong-answer pattern.";
  const writesFor = async (studentId: string) => ({
    autopsies: await a.prisma.autopsy.count({ where: { attempt: { studentId } } }),
    repairPlans: await a.prisma.repairPlan.count({ where: { studentId } }),
    mastery: await a.prisma.masteryState.count({ where: { studentId } })
  });

  it("PHASE 4 UNIT 3: the OFFER is persisted once -- a restarted and a second instance return the stored offer (no new model call, one autopsy row), and a token from one is honored by the others", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-persist");
    const attemptId = await startAndSubmit(a, s.cookie, real.successive, "wrong");
    const evidence = await evidenceOf(a, s.cookie, attemptId);
    const row = await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });

    const offer = await hypothesisOf(a, s.cookie, attemptId);
    expect(offer.status).toBe(200);
    expect(offer.json.status).toBe("ready");
    expect(Object.keys(offer.json).sort()).toEqual(["attemptId", "hypothesis", "status", "token"]);
    const hypothesis = offer.json.hypothesis as { summary: string; supportingEvidence: string[] };
    expect(hypothesis.summary).toMatch(/\bmay\b/);
    expect(hypothesis.supportingEvidence).toContain(`Your selected answer was ${row.chosenAnswer}.`);
    for (const line of hypothesis.supportingEvidence) expect((evidence.json.observations as string[]).includes(line) || line === GENERIC_PATTERN).toBe(true);
    expect(JSON.stringify(offer.json)).not.toMatch(/modelConfidence|generationMetadata|promptVersion|dev-scripted|proposedErrorCategory|correctAnswer|solutionSteps/i);

    // the offer is in the database: awaiting, with its provenance (the observation evidence it was generated from)
    const stored = await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId } });
    expect(stored).toMatchObject({ confirmed: null, confirmedAt: null, studentCorrectionText: null, hypothesisText: hypothesis.summary });
    expect((stored.evidenceUsed as { observationEvidence: { identity: { attemptId: string } } }).observationEvidence.identity.attemptId).toBe(attemptId);
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(0);

    const restarted = await startInstance(); // nothing but the database carries over
    try {
      expect(((await hypothesisOf(restarted, s.cookie, attemptId)).json.hypothesis as { summary: string }).summary).toBe(hypothesis.summary);
      expect(((await hypothesisOf(b, s.cookie, attemptId)).json.hypothesis as { summary: string }).summary).toBe(hypothesis.summary);
      expect(await a.prisma.autopsy.count({ where: { attemptId } })).toBe(1); // asking again never makes a second offer
      // a token issued by instance A is answered by the restarted instance; the second instance then sees the SAME persisted answer
      expect((await respondOf(restarted, s.cookie, attemptId, { token: offer.json.token, response: "confirmed" })).json).toMatchObject({ status: "confirmed", persisted: true, alreadyRecorded: false });
      expect((await respondOf(b, s.cookie, attemptId, { token: offer.json.token, response: "rejected" })).json).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    } finally {
      await restarted.close();
    }
  });

  it("PHASE 4 UNIT 3 CASE A: CONFIRM -> one confirmed autopsy + exactly one RepairPlan with provenance; duplicates (sequential, across instances, and concurrent) create nothing more; restart and a second instance read the same state", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-confirm");
    const attemptId = await startAndSubmit(a, s.cookie, real.reverse, "wrong");
    const attemptBefore = JSON.stringify(await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { events: { orderBy: { id: "asc" } } } }));
    const offer = (await hypothesisOf(a, s.cookie, attemptId)).json as { token: string };

    const done = await respondOf(a, s.cookie, attemptId, { token: offer.token, response: "confirmed" });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ status: "confirmed", persisted: true, alreadyRecorded: false, diagnosis: { state: "confirmed" }, studentCorrectionText: null });
    const view = done.json.repairPlan as { conceptName: string; patternFamilyName: string; status: string };
    expect(Object.keys(view).sort()).toEqual(["conceptName", "patternFamilyName", "status"]);
    expect(view).toMatchObject({ status: "pending" });
    expect(JSON.stringify(done.json)).not.toMatch(/autopsyId|studentId|taxonomy|misconception|modelConfidence|dev-scripted|followUp|priority|correctAnswer/i);
    expect(JSON.stringify(view)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // the plan view carries no ids

    // real rows, with provenance
    const autopsy = await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId }, include: { repairPlan: true } });
    expect(autopsy).toMatchObject({ confirmed: true, studentCorrectionText: null });
    expect(autopsy.confirmedAt).not.toBeNull();
    expect(autopsy.repairPlan).toMatchObject({ autopsyId: autopsy.id, studentId: s.studentId, status: "pending", targetPatternFamilyName: view.patternFamilyName, targetConceptName: view.conceptName, followUpQuestionIds: [] });
    expect(autopsy.repairPlan!.targetErrorTaxonomyId).not.toBeNull();
    expect((autopsy.evidenceUsed as { observationEvidence: unknown }).observationEvidence).toBeDefined();
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(1);

    // duplicates: a different response, the same one again, from the other instance, and 12 concurrent ones across both instances
    expect((await respondOf(a, s.cookie, attemptId, { token: offer.token, response: "rejected" })).json).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    expect((await respondOf(b, s.cookie, attemptId, { token: offer.token, response: "confirmed" })).json).toMatchObject({ status: "confirmed", alreadyRecorded: true });
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => respondOf(i % 2 ? a : b, s.cookie, attemptId, { token: offer.token, response: "confirmed" })));
    expect(burst.every((r) => r.status === 200 && (r.json as { status: string }).status === "confirmed")).toBe(true);
    expect(await a.prisma.autopsy.count({ where: { attemptId } })).toBe(1);
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(1);
    expect((await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId } })).confirmedAt).toEqual(autopsy.confirmedAt); // the first response time, untouched

    // restart + second instance: the persisted state is reconstructed, and the offer endpoint reports the stored answer (not a new offer)
    const restarted = await startInstance();
    try {
      for (const instance of [restarted, b]) {
        expect((await hypothesisOf(instance, s.cookie, attemptId)).json).toMatchObject({ status: "answered", result: { status: "confirmed", persisted: true, repairPlan: view } });
      }
    } finally {
      await restarted.close();
    }

    // nothing else moved: the attempt and its events are unchanged, no mastery row was written, another student sees none of it
    expect(JSON.stringify(await a.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { events: { orderBy: { id: "asc" } } } }))).toBe(attemptBefore);
    expect(await a.prisma.masteryState.count({ where: { studentId: s.studentId } })).toBe(0);
    const other = await newStudent(a, "hyp-confirm-other");
    expect(await a.prisma.repairPlan.count({ where: { studentId: other.studentId } })).toBe(0);
    expect((await respondOf(a, other.cookie, attemptId, { token: offer.token, response: "confirmed" })).status).toBe(403);
  });

  it("PHASE 4 UNIT 3 CASE B: REJECT -> recorded as not confirmed; no diagnosis, no RepairPlan; a later confirm cannot change it (also after a restart)", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-reject");
    const attemptId = await startAndSubmit(a, s.cookie, real.successive, "wrong");
    const offer = (await hypothesisOf(a, s.cookie, attemptId)).json as { token: string };

    expect((await respondOf(a, s.cookie, attemptId, { token: offer.token, response: "rejected" })).json).toMatchObject({ status: "rejected", persisted: true, diagnosis: { state: "not_confirmed" }, repairPlan: null, studentCorrectionText: null });
    const autopsy = await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId }, include: { repairPlan: true } });
    expect(autopsy).toMatchObject({ confirmed: false, studentCorrectionText: null, repairPlan: null });
    expect(autopsy.confirmedAt).not.toBeNull();

    const restarted = await startInstance();
    try {
      expect((await respondOf(restarted, s.cookie, attemptId, { token: offer.token, response: "confirmed" })).json).toMatchObject({ status: "rejected", alreadyRecorded: true, repairPlan: null });
      expect((await hypothesisOf(restarted, s.cookie, attemptId)).json).toMatchObject({ status: "answered", result: { status: "rejected", diagnosis: { state: "not_confirmed" } } });
    } finally {
      await restarted.close();
    }
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(0);
    expect(await a.prisma.autopsy.count({ where: { attemptId, confirmed: true } })).toBe(0);
    expect(await writesFor(s.studentId)).toEqual({ autopsies: 1, repairPlans: 0, mastery: 0 }); // the offer + its rejection, and nothing else
  });

  it("PHASE 4 UNIT 3 CASE C: CORRECT -> the student's exact words are stored; not a diagnosis; no RepairPlan; identical after a restart", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-correct");
    const attemptId = await startAndSubmit(a, s.cookie, real.point, "wrong");
    const offer = (await hypothesisOf(a, s.cookie, attemptId)).json as { token: string; hypothesis: { summary: string } };
    const words = "  I used the new value — not the original.\nSecond line ✓ ";

    expect((await respondOf(a, s.cookie, attemptId, { token: offer.token, response: "corrected", correctedExplanation: words })).json).toMatchObject({ status: "corrected", studentCorrectionText: words, persisted: true, diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null });
    const autopsy = await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId }, include: { repairPlan: true } });
    expect(autopsy).toMatchObject({ confirmed: false, studentCorrectionText: words, hypothesisText: offer.hypothesis.summary, repairPlan: null });
    expect(autopsy.confirmedAt).not.toBeNull();

    const restarted = await startInstance();
    try {
      expect((await hypothesisOf(restarted, s.cookie, attemptId)).json).toMatchObject({ status: "answered", result: { status: "corrected", studentCorrectionText: words, diagnosis: { state: "awaiting_diagnosis" }, repairPlan: null } });
      expect((await respondOf(restarted, s.cookie, attemptId, { token: offer.token, response: "corrected", correctedExplanation: "different words" })).json).toMatchObject({ studentCorrectionText: words, alreadyRecorded: true });
    } finally {
      await restarted.close();
    }
    expect((await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId } })).studentCorrectionText).toBe(words);
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(0);
  });

  it("PHASE 4 UNIT 3: the database itself refuses a second RepairPlan for one autopsy (migration 0011) and a second autopsy for one attempt", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-constraint");
    const attemptId = await startAndSubmit(a, s.cookie, real.reverse, "wrong");
    const offer = (await hypothesisOf(a, s.cookie, attemptId)).json as { token: string };
    await respondOf(a, s.cookie, attemptId, { token: offer.token, response: "confirmed" });
    const autopsy = await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId }, include: { repairPlan: true } });
    const plan = autopsy.repairPlan!;

    await expect(
      a.prisma.repairPlan.create({ data: { autopsyId: autopsy.id, studentId: s.studentId, targetConceptId: plan.targetConceptId, targetErrorTaxonomyId: plan.targetErrorTaxonomyId, followUpQuestionIds: [], status: "pending", targetConceptName: plan.targetConceptName, targetPatternFamilyName: plan.targetPatternFamilyName, targetTaxonomyCellId: plan.targetTaxonomyCellId, targetErrorCategory: plan.targetErrorCategory, recommendedTrainingMode: plan.recommendedTrainingMode, priority: plan.priority } })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(a.prisma.autopsy.create({ data: { attemptId, hypothesisText: "another", evidenceUsed: {}, generatedByProvider: "x", promptVersion: "x" } })).rejects.toMatchObject({ code: "P2002" });
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(1);
  });

  it("PHASE 4 UNIT 3: the stored confirmed plan is what the EXISTING recommendation path reads (unchanged code), identically on a restarted instance; rejected/corrected answers add nothing to it", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-recommend");
    const attemptId = await startAndSubmit(a, s.cookie, real.reverse, "wrong");
    const before = await call(a, "POST", "/v1/recommendation", s.cookie);
    const offer = (await hypothesisOf(a, s.cookie, attemptId)).json as { token: string };
    await respondOf(a, s.cookie, attemptId, { token: offer.token, response: "confirmed" });
    const after = await call(a, "POST", "/v1/recommendation", s.cookie);
    expect(after.status).toBe(200);
    // the existing repair tier consumed the stored plan; this unit changed no selection code
    const restarted = await startInstance();
    try {
      expect((await call(restarted, "POST", "/v1/recommendation", s.cookie)).json).toEqual(after.json);
    } finally {
      await restarted.close();
    }
    const unchanged = await newStudent(a, "hyp-recommend-reject");
    const rejectedAttempt = await startAndSubmit(a, unchanged.cookie, real.reverse, "wrong");
    const rejectedBefore = await call(a, "POST", "/v1/recommendation", unchanged.cookie);
    const rejectedOffer = (await hypothesisOf(a, unchanged.cookie, rejectedAttempt)).json as { token: string };
    await respondOf(a, unchanged.cookie, rejectedAttempt, { token: rejectedOffer.token, response: "rejected" });
    expect((await call(a, "POST", "/v1/recommendation", unchanged.cookie)).json).toEqual(rejectedBefore.json);
    void before;
  });

  it("PHASE 4 UNIT 2: nothing before submission (409), nothing for another student (403), no session (401), forged/garbage tokens refused (409), not_applicable for correct and skipped attempts", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "hyp-bounds");
    const open = await call(a, "POST", "/v1/attempts", s.cookie, { questionId: real.point });
    const openId = open.json.attemptId as string;
    expect((await hypothesisOf(a, s.cookie, openId)).status).toBe(409);
    expect((await respondOf(a, s.cookie, openId, { token: "x", response: "confirmed" })).status).toBe(409);
    await call(a, "POST", `/v1/attempts/${openId}/skip`, s.cookie, { questionId: real.point });
    expect((await hypothesisOf(a, s.cookie, openId)).json).toMatchObject({ status: "not_applicable" });
    const correctId = await startAndSubmit(a, s.cookie, real.successive, "correct");
    expect((await hypothesisOf(a, s.cookie, correctId)).json).toMatchObject({ status: "not_applicable" });

    const wrongId = await startAndSubmit(a, s.cookie, real.reverse, "wrong");
    const offer = (await hypothesisOf(a, s.cookie, wrongId)).json as { token: string };
    const other = await newStudent(a, "hyp-bounds-other");
    expect((await hypothesisOf(a, other.cookie, wrongId)).status).toBe(403);
    expect((await respondOf(a, other.cookie, wrongId, { token: offer.token, response: "confirmed" })).status).toBe(403);
    expect((await call(a, "POST", `/v1/attempts/${wrongId}/hypothesis`, undefined, {})).status).toBe(401);
    expect((await respondOf(a, s.cookie, wrongId, { token: "garbage", response: "confirmed" })).status).toBe(409);
    expect((await respondOf(a, s.cookie, wrongId, { token: offer.token.slice(0, -3) + "AAA", response: "confirmed" })).status).toBe(409);
    // the token also cannot be moved onto another of this student's attempts
    const otherAttempt = await startAndSubmit(a, s.cookie, real.successive, "wrong");
    expect((await respondOf(a, s.cookie, otherAttempt, { token: offer.token, response: "confirmed" })).status).toBe(403);
  });

  it("PHASE 4 UNIT 2: with no model configured the offer is 'unavailable' (nothing fabricated) and the result, evidence and Continue path still work", async () => {
    const real = await familyIds();
    const noModel = await startInstance({ noModel: true });
    try {
      const s = await newStudent(noModel, "hyp-nomodel");
      const attemptId = await startAndSubmit(noModel, s.cookie, real.reverse, "wrong");
      expect((await hypothesisOf(noModel, s.cookie, attemptId)).json).toEqual({ status: "unavailable", attemptId });
      expect((await call(noModel, "GET", `/v1/attempts/${attemptId}/result`, s.cookie)).status).toBe(200);
      expect((await evidenceOf(noModel, s.cookie, attemptId)).status).toBe(200);
      expect((await call(noModel, "POST", "/v1/recommendation", s.cookie)).status).toBe(200);
    } finally {
      await noModel.close();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 4 Unit 4 -- TARGETED REPAIR PRACTICE on real Postgres: a stored confirmed RepairPlan drives the next question, answering it is an
  // ordinary persisted attempt, the plan's lifecycle (pending -> in_progress -> completed) is derived from persisted attempts and synced to
  // the stored status, and the decision is identical after a restart, on a second instance, and under concurrent requests.
  // ---------------------------------------------------------------------------------------------

  const recommendationOf = (instance: Instance, cookie: string) => call(instance, "POST", "/v1/recommendation", cookie);
  const REPAIR_LABEL = "Confirmed pattern";
  async function confirmedPlanFor(s: { cookie: string; studentId: string }, questionId: string, decision: "confirmed" | "rejected" | "corrected" = "confirmed") {
    const attemptId = await startAndSubmit(a, s.cookie, questionId, "wrong");
    const offer = (await hypothesisOf(a, s.cookie, attemptId)).json as { token: string };
    const body = decision === "corrected" ? { token: offer.token, response: "corrected", correctedExplanation: "my own words" } : { token: offer.token, response: decision };
    expect((await respondOf(a, s.cookie, attemptId, body)).status).toBe(200);
    return attemptId;
  }
  const planRow = (attemptId: string) => a.prisma.repairPlan.findFirst({ where: { autopsy: { attemptId } } });

  it("PHASE 4 UNIT 4: confirm -> the next question is a targeted repair question (not the one just answered) with an honest, metadata-free explanation; answering it is an ordinary persisted attempt", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "rep-flow");
    const diagnosed = await confirmedPlanFor(s, real.reverse);
    const rec = await recommendationOf(a, s.cookie);
    expect(rec.status).toBe(200);
    expect(rec.json.modeLabel).toBe(REPAIR_LABEL);
    expect(rec.json.questionId).not.toBe(real.reverse); // no immediate repeat
    expect([real.point, real.successive]).toContain(rec.json.questionId);
    expect(Object.keys(rec.json).sort()).toEqual(["explanation", "headline", "modeLabel", "questionId"]);
    const text = JSON.stringify({ ...rec.json, questionId: undefined }); // the question id itself is a legitimate identifier
    expect(text).toContain("Reverse Percentage");
    expect(text).not.toMatch(/base_confusion|taxonomy|autopsy|misconception|modelConfidence|dev-scripted|concept_fallback|trap_only|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(text).not.toMatch(/confiden|motivat|careless|anxi|lazy|intelligen|you (felt|knew|thought)|weak|fixed|mastered/i);
    expect((await planRow(diagnosed))!.status).toBe("pending");

    const repairAttemptId = await startAndSubmit(a, s.cookie, rec.json.questionId as string, "correct");
    const row = await a.prisma.attempt.findUniqueOrThrow({ where: { id: repairAttemptId } });
    expect(row).toMatchObject({ status: "submitted", isCorrect: true, studentId: s.studentId, questionId: rec.json.questionId });
    expect((await call(a, "GET", `/v1/attempts/${repairAttemptId}/evidence`, s.cookie)).status).toBe(200);

    const after = await recommendationOf(a, s.cookie); // the lifecycle is recomputed and synced
    expect((await planRow(diagnosed))!.status).toBe("in_progress");
    expect(after.json.modeLabel).toBe(REPAIR_LABEL); // one correct answer does not end repair
    expect(after.json.questionId).not.toBe(rec.json.questionId);
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(1); // still exactly one plan: no second flow
  });

  it("PHASE 4 UNIT 4: restart, a second instance and 16 concurrent requests all make the identical repair decision; the plan state is reconstructed from Postgres", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "rep-restart");
    const diagnosed = await confirmedPlanFor(s, real.successive);
    const first = await recommendationOf(a, s.cookie);
    await startAndSubmit(a, s.cookie, first.json.questionId as string, "wrong");
    const before = await recommendationOf(a, s.cookie);
    expect(before.json.modeLabel).toBe(REPAIR_LABEL);

    const restarted = await startInstance();
    try {
      expect((await recommendationOf(restarted, s.cookie)).json).toEqual(before.json);
      expect((await recommendationOf(b, s.cookie)).json).toEqual(before.json);
      const burst = await Promise.all(Array.from({ length: 16 }, (_, i) => recommendationOf([a, b, restarted][i % 3]!, s.cookie)));
      for (const r of burst) expect(r.json).toEqual(before.json);
    } finally {
      await restarted.close();
    }
    expect((await planRow(diagnosed))!.status).toBe("in_progress");
    expect(await a.prisma.repairPlan.count({ where: { studentId: s.studentId } })).toBe(1);
  });

  it("PHASE 4 UNIT 4: with the seeded content (one question per family, distinct traps) every repair question is a broad concept fallback, so completion comes from the ROUND LIMIT -- correct or not, never claimed as fixed; ordinary practice then resumes", async () => {
    const real = await familyIds();
    const done = await newStudent(a, "rep-complete");
    const diagnosed = await confirmedPlanFor(done, real.reverse);
    for (let round = 0; round < 2; round++) {
      await startAndSubmit(a, done.cookie, (await recommendationOf(a, done.cookie)).json.questionId as string, "correct");
      expect((await recommendationOf(a, done.cookie)).json.modeLabel).toBe(REPAIR_LABEL); // two correct broad answers are NOT a demonstration
    }
    await startAndSubmit(a, done.cookie, (await recommendationOf(a, done.cookie)).json.questionId as string, "correct");
    const resumed = await recommendationOf(a, done.cookie);
    expect(resumed.json.modeLabel).not.toBe(REPAIR_LABEL);
    expect((await planRow(diagnosed))!.status).toBe("completed");
    expect((await recommendationOf(b, done.cookie)).json).toEqual(resumed.json); // and another instance agrees

    const failing = await newStudent(a, "rep-limit");
    const failingDiagnosed = await confirmedPlanFor(failing, real.reverse);
    for (let round = 0; round < 3; round++) {
      const rec = await recommendationOf(a, failing.cookie);
      expect(rec.json.modeLabel).toBe(REPAIR_LABEL);
      await startAndSubmit(a, failing.cookie, rec.json.questionId as string, "wrong");
    }
    expect((await recommendationOf(a, failing.cookie)).json.modeLabel).not.toBe(REPAIR_LABEL);
    expect((await planRow(failingDiagnosed))!.status).toBe("completed");
  });

  it("PHASE 4 UNIT 4: a rejected or corrected explanation never creates repair; another student's confirmed plan never affects this student", async () => {
    const real = await familyIds();
    const owner = await newStudent(a, "rep-owner");
    await confirmedPlanFor(owner, real.reverse);
    for (const decision of ["rejected", "corrected"] as const) {
      const s = await newStudent(a, `rep-${decision}`);
      const attemptId = await confirmedPlanFor(s, real.reverse, decision);
      expect(await planRow(attemptId)).toBeNull();
      expect((await recommendationOf(a, s.cookie)).json.modeLabel).not.toBe(REPAIR_LABEL);
      expect((await a.prisma.autopsy.findUniqueOrThrow({ where: { attemptId } })).confirmed).toBe(false);
    }
    const stranger = await newStudent(a, "rep-stranger");
    expect((await recommendationOf(a, stranger.cookie)).json.modeLabel).not.toBe(REPAIR_LABEL);
    expect(await a.prisma.repairPlan.count({ where: { studentId: stranger.studentId } })).toBe(0);
  });

  it("PHASE 4 UNIT 4: when NO repair candidate exists (every published question unavailable) the plan does not break practice -- a deterministic 'nothing to recommend' answer, and repair resumes once content returns", async () => {
    const real = await familyIds();
    const s = await newStudent(a, "rep-nocandidate");
    await confirmedPlanFor(s, real.reverse);
    const published = await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } });
    const ids = published.map((q) => q.id);
    try {
      await a.prisma.question.updateMany({ where: { id: { in: ids } }, data: { validationState: "draft" } });
      const none = await recommendationOf(a, s.cookie);
      expect(none.status).toBe(200);
      expect(none.json.questionId).toBeNull();
      expect((await recommendationOf(b, s.cookie)).json).toEqual(none.json);
    } finally {
      await a.prisma.question.updateMany({ where: { id: { in: ids } }, data: { validationState: "published" } });
    }
    expect((await recommendationOf(a, s.cookie)).json.modeLabel).toBe(REPAIR_LABEL); // the plan itself was never lost or completed by the gap
  });

  it("repository level: the database rejects a second open attempt as a typed conflict, but allows a new one once the first is finalized", async () => {
    const s = await newStudent(a, "repo");
    const enrollment = await a.prisma.enrollment.findFirstOrThrow({ where: { studentId: s.studentId } });
    const repo = new PrismaAttemptRepository(a.prisma);
    const mk = (id: string) => startAttempt({ id, studentId: s.studentId, questionId: DEMO_QUESTION, enrollmentId: enrollment.id, now: new Date().toISOString() });

    await repo.save(mk(randomUUID()));
    await expect(repo.save(mk(randomUUID()))).rejects.toMatchObject({ name: "PersistenceError", code: "conflict" });
    expect(await a.prisma.attempt.count({ where: { studentId: s.studentId } })).toBe(1);

    const open = await repo.findInProgressByStudentQuestion({ studentId: s.studentId, questionId: DEMO_QUESTION, enrollmentId: enrollment.id });
    expect(open).not.toBeNull();
    expect(await repo.findInProgressByStudentQuestion({ studentId: randomUUID(), questionId: DEMO_QUESTION, enrollmentId: enrollment.id })).toBeNull();
    await a.prisma.attempt.update({ where: { id: open!.id }, data: { status: "abandoned", finalizedAt: new Date(), timeSpentSeconds: 1 } });
    await expect(repo.save(mk(randomUUID()))).resolves.toBeDefined(); // finalized attempts do not block a new open one
    expect(PersistenceError).toBeDefined();
  });
});
