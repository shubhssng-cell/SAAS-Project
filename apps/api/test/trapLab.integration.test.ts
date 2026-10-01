import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPrismaClient } from "@ipmat/db";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { createPrismaDependencies } from "../src/wiring.js";
import { createIsolatedDatabase } from "./isolatedDatabase.js";

/**
 * Phase 5 Unit 4 -- Trap Lab on REAL POSTGRES, through the real HTTP server on the real Prisma repositories, with two independent API instances.
 *
 * SKIPPED unless `IPMAT_TEST_DATABASE_URL` is set (same opt-in and "name must contain test" guard as the other integration suites).
 *
 * SYNTHETIC TEST DATA. The seed has three real questions -- far too few to show a recurring trap, a cross-concept recurrence, a code tie-break or
 * surface variation -- and the provider's rule is NOT weakened to make it appear. This suite builds its OWN throwaway database (migrate + seed),
 * publishes a labelled pool into it (bodies start with "[TEST DATA phase-5-unit-4]"; clones of the seeded demonstration question that carry
 * different seeded error-taxonomy codes, seeded pattern-taxonomy cells and concepts, plus the seeded provenance row), withholds the seeded real
 * questions from the pool INSIDE that database only, and drops the database afterwards. Nothing synthetic exists in the shared test database, the
 * seed, or any application code path.
 */

const DATABASE_URL = process.env.IPMAT_TEST_DATABASE_URL;
if (DATABASE_URL) {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against database "${dbName}": IPMAT_TEST_DATABASE_URL must point at a database whose name contains "test".`);
  }
}

const DEMO_QUESTION = "00000000-0000-0000-0000-000000000002";
const CORRECT = "20,000";
const WRONG = "16,000";
const TEST_DATA = "[TEST DATA phase-5-unit-4]";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
interface Spec {
  key: string;
  code: "A" | "B" | null; // resolved to two seeded error-taxonomy codes at setup
  cell: number; // index into the seeded pattern-taxonomy cells
  concept: 0 | 1; // index into two seeded concepts
}
const SPECS: Spec[] = [
  { key: "P1", code: "A", cell: 0, concept: 0 },
  { key: "P2", code: "A", cell: 1, concept: 0 },
  { key: "R1", code: "A", cell: 2, concept: 1 },
  { key: "O1", code: "B", cell: 3, concept: 0 },
  { key: "O2", code: "B", cell: 4, concept: 0 },
  { key: "B1", code: "A", cell: 0, concept: 0 }, // the SAME surface (cell) as P1
  { key: "B2", code: "A", cell: 5, concept: 0 },
  { key: "B3", code: "A", cell: 6, concept: 0 },
  { key: "BR", code: "A", cell: 7, concept: 1 },
  { key: "OB1", code: "B", cell: 5, concept: 0 },
  { key: "N1", code: null, cell: 0, concept: 0 }
];
const idOf = (key: string): string => `00000000-0000-0000-0000-00000000e${String(SPECS.findIndex((s) => s.key === key) + 1).padStart(3, "0")}`;
const keyOf = (id: string): string => SPECS[Number(id.slice(-3)) - 1]!.key;
const UNSEEN_AFTER_P1P2 = ["R1", "B2", "B3", "BR"].map(idOf); // cells not yet attempted against code A
const SEEN_AFTER_P1P2 = ["B1", "P1", "P2"].map(idOf);
let codeA = "";
let codeB = "";
let cellIds: string[] = [];
let conceptIds: string[] = [];

interface Instance {
  prisma: PrismaClient;
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}
let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>>;

async function startInstance(): Promise<Instance> {
  const prisma = createPrismaClient(isolated.url);
  await prisma.$connect();
  const server = createServer(createPrismaDependencies(prisma));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    prisma,
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  };
}

async function call(instance: Instance, method: string, path: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json; raw: string; setCookie: string | null }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${instance.baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  return { status: res.status, json: JSON.parse(raw), raw, setCookie: res.headers.get("set-cookie") };
}

async function newStudent(instance: Instance, label: string): Promise<{ cookie: string; studentId: string }> {
  const signup = await call(instance, "POST", "/v1/auth/signup", undefined, { email: `${label}-${randomUUID()}@example.com`, password: "correct-horse" });
  const cookie = (signup.setCookie ?? "").split(";")[0] ?? "";
  await call(instance, "POST", "/v1/onboarding/complete", cookie);
  expect((await call(instance, "POST", "/v1/enrollment", cookie)).status).toBe(200);
  return { cookie, studentId: (signup.json.student as { id: string }).id };
}

/** Ordinary practice through the real HTTP path; `keys` may repeat (a question retried). */
async function answer(instance: Instance, cookie: string, keys: string[], correct: boolean): Promise<void> {
  for (const key of keys) {
    const questionId = idOf(key);
    const started = await call(instance, "POST", "/v1/attempts", cookie, { questionId });
    expect(started.status).toBe(200);
    expect((await call(instance, "POST", `/v1/attempts/${started.json.attemptId}/submit`, cookie, { questionId, chosenAnswer: correct ? CORRECT : WRONG })).status).toBe(200);
  }
}

async function publishSyntheticPool(prisma: PrismaClient): Promise<void> {
  const demo = await prisma.question.findUniqueOrThrow({ where: { id: DEMO_QUESTION } });
  const codes = await prisma.errorTaxonomy.findMany({ orderBy: { code: "asc" }, take: 2 });
  codeA = codes[0]!.code;
  codeB = codes[1]!.code;
  cellIds = (await prisma.patternTaxonomyCell.findMany({ orderBy: { id: "asc" }, take: 8 })).map((c) => c.id);
  expect(cellIds.length).toBe(8);
  conceptIds = [demo.conceptId, (await prisma.concept.findMany({ where: { id: { not: demo.conceptId } }, take: 1, orderBy: { id: "asc" } })).map((c) => c.id)[0]!];
  expect(conceptIds[1]).toBeTruthy();
  for (const spec of SPECS) {
    const rest: Record<string, unknown> = { ...demo };
    delete rest.id;
    delete rest.createdAt;
    await prisma.question.create({
      data: {
        ...(rest as Omit<typeof demo, "id" | "createdAt">),
        id: idOf(spec.key),
        body: `${TEST_DATA} ${spec.key}`,
        conceptId: conceptIds[spec.concept]!,
        patternTaxonomyCellId: cellIds[spec.cell]!,
        trapErrorTaxonomyId: spec.code === null ? null : codes[spec.code === "A" ? 0 : 1]!.id,
        options: demo.options as object,
        difficultyDimensions: demo.difficultyDimensions as object,
        solutionSteps: demo.solutionSteps as object,
        groundTruthDerivation: demo.groundTruthDerivation as object
      }
    });
  }
}

const TEN = { completion: { kind: "fixed_question_count", questionCount: 10 } };
const TWO = { completion: { kind: "fixed_question_count", questionCount: 2 } };
const card = async (instance: Instance, cookie: string): Promise<Json> => ((await call(instance, "GET", "/v1/training/systems", cookie)).json.systems as Json[]).find((x) => x.systemId === "trap-lab")!;

let a: Instance;
let b: Instance;
let seededPublishedBefore: string[] = [];

describe.skipIf(!DATABASE_URL)("Trap Lab -- real Postgres, synthetic TEST DATA pool (Phase 5 Unit 4)", { timeout: 240_000 }, () => {
  beforeAll(async () => {
    isolated = await createIsolatedDatabase(DATABASE_URL!, "trap");
    a = await startInstance();
    b = await startInstance();
    seededPublishedBefore = (await a.prisma.question.findMany({ where: { validationState: "published" }, select: { id: true } })).map((q) => q.id).sort();
    await publishSyntheticPool(a.prisma);
    // Inside this THROWAWAY database only: withhold the seeded real questions so the labelled synthetic pool alone defines what Trap Lab can serve.
    await a.prisma.question.updateMany({ where: { validationState: "published", NOT: { body: { startsWith: TEST_DATA } } }, data: { validationState: "human_reviewed" } });
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await isolated?.drop();
  }, 60_000);

  it("the real seeded set is exactly what the seed made; the synthetic pool is labelled TEST DATA and lives only in this throwaway database", async () => {
    expect(seededPublishedBefore).toContain(DEMO_QUESTION);
    expect(await a.prisma.question.count({ where: { validationState: "published", body: { startsWith: TEST_DATA } } })).toBe(SPECS.length);
    const real = await a.prisma.question.findMany({ where: { NOT: { body: { startsWith: TEST_DATA } } }, select: { id: true } });
    expect(real.map((q) => q.id).sort()).toEqual(seededPublishedBefore);
    const shared = createPrismaClient(DATABASE_URL!);
    await shared.$connect();
    const table = await shared.$queryRawUnsafe<Array<{ t: string | null }>>("select to_regclass('public.questions')::text as t");
    if (table[0]?.t) expect(await shared.question.count({ where: { body: { startsWith: TEST_DATA } } })).toBe(0);
    await shared.$disconnect();
  });

  it("not applicable: no evidence / one failure / the SAME question failed five times / one failure on each of two codes / only correct answers -- each with its own explanation, and a start is 409", async () => {
    const insufficient = "Needs recorded incorrect answers on questions that share a trap pattern first.";
    const noRecurring = "Your recorded practice doesn't show the same trap pattern across several different questions yet.";
    const cases: Array<[string, Array<[string[], boolean]>, string]> = [
      ["none", [], insufficient],
      ["correct", [[["P1", "P2", "R1"], true]], insufficient],
      ["untagged", [[["N1", "N1"], false]], insufficient],
      ["one", [[["P1"], false]], noRecurring],
      ["retried", [[["P1", "P1", "P1", "P1", "P1"], false]], noRecurring],
      ["twocodes", [[["P1", "O1"], false]], noRecurring]
    ];
    for (const [label, plan, note] of cases) {
      const s = await newStudent(a, `tr-${label}`);
      for (const [keys, correct] of plan) await answer(a, s.cookie, keys, correct);
      const c = await card(a, s.cookie);
      expect(c, label).toMatchObject({ label: "Traps", availability: "not_applicable", note });
      expect((await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "trap-lab", config: TEN })).status, label).toBe(409);
    }
  });

  it("recurring trap (also across two concepts): objective with NO stage -> surface variation -> exhaustion, across a second instance and ownership; nothing about the trap leaks", async () => {
    const s = await newStudent(a, "tr-life");
    const other = await newStudent(b, "tr-oth");
    await answer(a, s.cookie, ["P1", "P2"], false);
    expect(await card(a, s.cookie)).toMatchObject({ availability: "available", note: "Ready to train." });

    const started = await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "trap-lab", config: TEN });
    expect(started.status).toBe(200);
    const session = started.json.session as Json;
    expect(session).toMatchObject({ systemTitle: "Trap Lab", dimension: "trap", stage: null, objective: { targetConceptName: null } });
    expect(session.objective.statement).toBe("Practice a recurring trap pattern: the same kind of trap, in different question formats. This session focuses on a trap pattern that has appeared across your practice.");
    const row = await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(JSON.stringify([row.objective, row.config])).not.toMatch(/stage|errorTaxonomy|targetErrorTaxonomyCode/i);

    const served: string[] = [];
    let firstRaw = "";
    for (let i = 0; i < 7; i += 1) {
      const instance = i % 2 === 0 ? a : b;
      const next = await call(instance, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
      expect(next.status).toBe(200);
      expect(next.json.status).toBe("question");
      expect(next.json.stageTransition).toBeNull();
      expect(next.json.session.stage).toBeNull();
      if (i === 0) {
        firstRaw = next.raw;
        // a second instance resumes the same open question; another student is refused
        expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {})).json.attemptId).toBe(next.json.attemptId);
        expect((await call(b, "GET", `/v1/training/sessions/${session.sessionId}`, other.cookie)).status).toBe(403);
        expect((await call(b, "POST", `/v1/training/sessions/${session.sessionId}/next`, other.cookie, {})).status).toBe(403);
      }
      served.push(next.json.question.questionId);
      expect((await call(instance, "POST", `/v1/attempts/${next.json.attemptId}/submit`, s.cookie, { questionId: next.json.question.questionId, chosenAnswer: CORRECT })).json).toMatchObject({ status: "submitted", isCorrect: true });
    }
    // repeat the trap, vary the surface: every unseen surface first (order within a partition is by exposure then id), the already-seen surfaces last
    expect([...served.slice(0, 4)].sort()).toEqual([...UNSEEN_AFTER_P1P2].sort());
    expect([...served.slice(4)].sort()).toEqual([...SEEN_AFTER_P1P2].sort());
    expect(served.map(keyOf).every((k) => ["R1", "B1", "B2", "B3", "BR", "P1", "P2"].includes(k))).toBe(true); // never code B, never untagged
    expect(new Set(served).size).toBe(7);

    // correct answers did not cancel the recurrence; the pool for this trap is now exhausted -> an honest "no further question", the session stays active
    const exhausted = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    expect(exhausted.json).toMatchObject({ status: "no_question", session: { status: "active", stage: null } });
    const done = await call(b, "POST", `/v1/training/sessions/${session.sessionId}/finish`, s.cookie, {});
    expect(done.json).toMatchObject({ status: "completed", stage: null, summary: { submittedCount: 7, correctCount: 7 } });

    // nothing about the trap leaks: no code, no cell id, no taxonomy words, no answer key field
    for (const text of [firstRaw, JSON.stringify(done.json), (await call(a, "GET", "/v1/training/systems", s.cookie)).raw]) {
      for (const secret of [codeA, codeB, ...cellIds, "targetErrorTaxonomyCode", "errorTaxonomy", "distinctFailing", "recurrence", "providerId", "diagnostics", "correctAnswer", "groundTruth"]) expect(text, secret).not.toContain(secret);
      expect(text.toLowerCase()).not.toMatch(/confidence|diagnos|prone|you always|trap score/);
    }
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: session.sessionId } })).practiceBlockId;
    const rows = await a.prisma.attempt.findMany({ where: { practiceBlockId: block }, orderBy: { blockSequenceNumber: "asc" } });
    expect(rows.map((r) => [r.status, r.isCorrect, r.blockSequenceNumber])).toEqual(Array.from({ length: 7 }, (_, i) => ["submitted", true, i + 1]));
  });

  it("cross-concept recurrence activates it; the target code is the largest distinct-failure count, with an exact tie broken by code", async () => {
    const cross = await newStudent(a, "tr-cross");
    await answer(a, cross.cookie, ["P1", "R1"], false); // the same code on two DIFFERENT concepts
    expect((await card(a, cross.cookie)).availability).toBe("available");

    const bigger = await newStudent(a, "tr-big"); // code A fails on 3 distinct questions, code B on 2 -> A
    await answer(a, bigger.cookie, ["P1", "P2", "R1", "O1", "O2"], false);
    const s1 = (await call(a, "POST", "/v1/training/sessions", bigger.cookie, { systemId: "trap-lab", config: TWO })).json.session as Json;
    const q1 = await call(a, "POST", `/v1/training/sessions/${s1.sessionId}/next`, bigger.cookie, {});
    expect(q1.json.question.questionId.slice(-3)).not.toBe(""); // a question was served
    expect(["B1", "B2", "B3", "BR", "P1", "P2", "R1"]).toContain(keyOf(q1.json.question.questionId));

    const tied = await newStudent(a, "tr-tie"); // 2 vs 2 -> the lexicographically smaller code (A < B)
    await answer(a, tied.cookie, ["P1", "P2", "O1", "O2"], false);
    const s2 = (await call(a, "POST", "/v1/training/sessions", tied.cookie, { systemId: "trap-lab", config: TWO })).json.session as Json;
    const q2 = await call(a, "POST", `/v1/training/sessions/${s2.sessionId}/next`, tied.cookie, {});
    expect(codeA < codeB).toBe(true);
    expect(["B1", "B2", "B3", "BR", "P1", "P2", "R1"]).toContain(keyOf(q2.json.question.questionId));
  });

  it("an unpublished question is never served as Trap Lab", async () => {
    const s = await newStudent(a, "tr-unpub");
    await answer(a, s.cookie, ["P1", "P2"], false);
    await a.prisma.question.updateMany({ where: { id: { in: ["B2", "B3"].map(idOf) } }, data: { validationState: "human_reviewed" } });
    try {
      const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "trap-lab", config: TEN })).json as { session: Json };
      const served: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        const next = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
        if (next.json.status !== "question") break;
        served.push(keyOf(next.json.question.questionId));
        await call(a, "POST", `/v1/attempts/${next.json.attemptId}/submit`, s.cookie, { questionId: next.json.question.questionId, chosenAnswer: CORRECT });
      }
      expect(served.length).toBeGreaterThan(3);
      expect(served).not.toContain("B2");
      expect(served).not.toContain("B3");
    } finally {
      await a.prisma.question.updateMany({ where: { id: { in: ["B2", "B3"].map(idOf) } }, data: { validationState: "published" } });
    }
  });

  it("concurrency: 12 parallel starts make one session; 10 parallel next calls across two instances make one open attempt", async () => {
    const s = await newStudent(a, "tr-race");
    await answer(a, s.cookie, ["P1", "P2"], false);
    const starts = await Promise.all(Array.from({ length: 12 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", "/v1/training/sessions", s.cookie, { systemId: "trap-lab", config: TEN })));
    expect(starts.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(new Set(starts.map((r) => r.json.session.sessionId)).size).toBe(1);
    expect(starts.filter((r) => r.json.resumed === false)).toHaveLength(1);
    const sessionId = starts[0]!.json.session.sessionId as string;
    const nexts = await Promise.all(Array.from({ length: 10 }, (_, i) => call(i % 2 === 0 ? a : b, "POST", `/v1/training/sessions/${sessionId}/next`, s.cookie, {})));
    expect(nexts.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(nexts.map((r) => r.json.attemptId)).size).toBe(1);
    const block = (await a.prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })).practiceBlockId;
    expect(await a.prisma.attempt.count({ where: { practiceBlockId: block } })).toBe(1);
  });

  it("training attempts are ordinary attempts: ordinary evidence, and no autopsy / repair / mastery row is written", async () => {
    const s = await newStudent(a, "tr-ev");
    await answer(a, s.cookie, ["P1", "P2"], false);
    const counts = async () => ({ autopsies: await a.prisma.autopsy.count(), plans: await a.prisma.repairPlan.count(), mastery: await a.prisma.masteryState.count() });
    const before = await counts();
    const { session } = (await call(a, "POST", "/v1/training/sessions", s.cookie, { systemId: "trap-lab", config: TWO })).json as { session: Json };
    const q = await call(a, "POST", `/v1/training/sessions/${session.sessionId}/next`, s.cookie, {});
    await call(a, "POST", `/v1/attempts/${q.json.attemptId}/skip`, s.cookie, { questionId: q.json.question.questionId });
    const evidence = await call(a, "GET", `/v1/attempts/${q.json.attemptId}/evidence`, s.cookie);
    expect(evidence.status).toBe(200);
    expect(evidence.json.facts.verdict).toBe("not_graded");
    expect(evidence.json.history.priorAttempts).toBe(2);
    expect(await counts()).toEqual(before);
  });
});
