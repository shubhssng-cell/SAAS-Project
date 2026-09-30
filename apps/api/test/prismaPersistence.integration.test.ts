import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PersistenceError, PrismaAttemptRepository, createPrismaClient } from "@ipmat/db";
import { startAttempt } from "@ipmat/attempt";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

async function startInstance(): Promise<Instance> {
  const prisma = createPrismaClient(DATABASE_URL!);
  await prisma.$connect();
  const server = createServer(createPrismaDependencies(prisma));
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

describe.skipIf(!DATABASE_URL)("Prisma persistence -- real Postgres (Product Phase 2 Unit 7)", () => {
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
