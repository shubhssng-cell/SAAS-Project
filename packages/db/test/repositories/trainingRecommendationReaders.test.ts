import type { PrismaClient } from "@prisma/client";
import { recordAttemptEvent, skipAttempt, startAttempt, submitAttempt, type AttemptQuestionContext, type AttemptState } from "@ipmat/attempt";
import { describe, expect, it, vi } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { InMemoryAttemptRepository } from "../../src/repositories/inMemoryAttemptRepository.js";
import { InMemoryConceptReader } from "../../src/repositories/inMemoryConceptReader.js";
import { InMemoryEnrollmentReader } from "../../src/repositories/inMemoryEnrollmentReader.js";
import { InMemoryPracticeSessionRepository } from "../../src/repositories/inMemoryPracticeSessionRepository.js";
import { InMemoryTrainingQuestionReader } from "../../src/repositories/inMemoryTrainingQuestionReader.js";
import { PrismaAttemptRepository } from "../../src/repositories/prismaAttemptRepository.js";
import { PrismaConceptReader } from "../../src/repositories/prismaConceptReader.js";
import { PrismaEnrollmentReader } from "../../src/repositories/prismaEnrollmentReader.js";
import { PrismaPracticeSessionRepository } from "../../src/repositories/prismaPracticeSessionRepository.js";
import {
  parseDifficultyDimensions,
  PrismaTrainingQuestionReader,
  toTrainingQuestionRecord,
  type TrainingQuestionRow
} from "../../src/repositories/prismaTrainingQuestionReader.js";
import type { TrainingQuestionRecord } from "../../src/repositories/types.js";

/**
 * The six read methods the Training Recommendation Composition layer needs
 * (docs/project-memory/37_TRAINING_RECOMMENDATION.md §6). Prisma-backed
 * classes are verified at the code level against a fake `PrismaClient` —
 * the exact query shape each sends — NOT a claim about live PostgreSQL
 * behavior (no live database has ever been reachable in this environment).
 * In-memory doubles are verified behaviorally against the same contract.
 */

const t = (offsetSeconds: number): string => new Date(Date.parse("2026-09-22T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

const numericQuestion = (questionId: string): AttemptQuestionContext => ({
  questionId,
  conceptId: "concept-1",
  answerFormat: "numeric_entry",
  options: null,
  correctAnswer: "480",
  expectedTimeSeconds: 90
});

function submitted(id: string, studentId: string, questionId: string, startOffset: number, finalizeOffset: number): AttemptState {
  const started = startAttempt({ id, studentId, questionId, enrollmentId: "enrollment-1", now: t(startOffset) });
  const answered = recordAttemptEvent(started, { type: "answer_selected", occurredAt: t(startOffset + 1), selectedAnswer: "480" }, { studentId, questionId });
  return submitAttempt(answered, { studentId, questionId }, numericQuestion(questionId), { now: t(finalizeOffset) });
}

function skipped(id: string, studentId: string, questionId: string, startOffset: number, finalizeOffset: number): AttemptState {
  const started = startAttempt({ id, studentId, questionId, enrollmentId: "enrollment-1", now: t(startOffset) });
  return skipAttempt(started, { studentId, questionId }, { now: t(finalizeOffset) });
}

describe("AttemptHistoryReader — InMemoryAttemptRepository", () => {
  it("findFinalizedByStudentId returns only this student's finalized attempts, ordered finalizedAt ASC", async () => {
    const repo = new InMemoryAttemptRepository();
    // Saved deliberately OUT of finalizedAt order.
    await repo.save(submitted("a-late", "student-1", "q-1", 100, 300));
    await repo.save(skipped("a-early", "student-1", "q-2", 0, 50));
    await repo.save(submitted("a-mid", "student-1", "q-3", 60, 120));
    await repo.save(startAttempt({ id: "a-open", studentId: "student-1", questionId: "q-4", enrollmentId: "enrollment-1", now: t(10) }));
    await repo.save(submitted("a-other", "student-2", "q-1", 0, 10));

    const found = await repo.findFinalizedByStudentId("student-1");
    expect(found.map((a) => a.id)).toEqual(["a-early", "a-mid", "a-late"]);
    expect(found.every((a) => a.studentId === "student-1" && a.status !== "in_progress")).toBe(true);
  });

  it("findFinalizedByStudentId breaks finalizedAt ties by id ASC", async () => {
    const repo = new InMemoryAttemptRepository();
    await repo.save(submitted("a-2", "student-1", "q-1", 0, 100));
    await repo.save(submitted("a-1", "student-1", "q-2", 0, 100));
    expect((await repo.findFinalizedByStudentId("student-1")).map((a) => a.id)).toEqual(["a-1", "a-2"]);
  });

  it("findFinalizedByStudentId returns [] for a student with no finalized attempts", async () => {
    const repo = new InMemoryAttemptRepository();
    await repo.save(startAttempt({ id: "a-open", studentId: "student-1", questionId: "q-1", enrollmentId: "enrollment-1", now: t(0) }));
    expect(await repo.findFinalizedByStudentId("student-1")).toEqual([]);
  });

  it("findByPracticeBlockId returns every attempt in the block (finalized or not) in blockSequenceNumber order, never another block's", async () => {
    const repo = new InMemoryAttemptRepository();
    // Allocated in order 1,2,3 — but with timestamps deliberately NOT monotonic, to prove ordering is by sequence number.
    await repo.save(startAttempt({ id: "b1", studentId: "student-1", questionId: "q-1", enrollmentId: "enrollment-1", now: t(500) }), { practiceBlockId: "block-1" });
    await repo.save(startAttempt({ id: "b2", studentId: "student-1", questionId: "q-2", enrollmentId: "enrollment-1", now: t(100) }), { practiceBlockId: "block-1" });
    await repo.save(startAttempt({ id: "x1", studentId: "student-1", questionId: "q-3", enrollmentId: "enrollment-1", now: t(0) }), { practiceBlockId: "block-2" });
    await repo.save(startAttempt({ id: "b3", studentId: "student-1", questionId: "q-3", enrollmentId: "enrollment-1", now: t(0) }), { practiceBlockId: "block-1" });

    const found = await repo.findByPracticeBlockId("block-1");
    expect(found.map((a) => a.id)).toEqual(["b1", "b2", "b3"]);
    expect(found.map((a) => a.blockMembership?.blockSequenceNumber)).toEqual([1, 2, 3]);
    expect(await repo.findByPracticeBlockId("no-such-block")).toEqual([]);
  });
});

describe("AttemptHistoryReader — PrismaAttemptRepository (query shape, no live database)", () => {
  const row = {
    id: "a-1",
    studentId: "student-1",
    questionId: "q-1",
    enrollmentId: "enrollment-1",
    retryOfAttemptId: null,
    status: "submitted",
    startedAt: new Date(t(0)),
    submittedAt: new Date(t(30)),
    finalizedAt: new Date(t(30)),
    timeSpentSeconds: 30,
    chosenAnswer: "480",
    isCorrect: true,
    hintsUsed: 0,
    solutionOpenedAt: null,
    practiceBlockId: "block-1",
    blockSequenceNumber: 1,
    events: [{ eventType: "question_started", occurredAt: new Date(t(0)), payload: null }]
  };

  it("findFinalizedByStudentId scopes by studentId, excludes in_progress, orders finalizedAt ASC then id ASC", async () => {
    const findMany = vi.fn().mockResolvedValue([row]);
    const repo = new PrismaAttemptRepository({ attempt: { findMany } } as unknown as PrismaClient);

    const found = await repo.findFinalizedByStudentId("student-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", status: { not: "in_progress" }, finalizedAt: { not: null } },
      orderBy: [{ finalizedAt: "asc" }, { id: "asc" }],
      include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } }
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "a-1", status: "submitted", finalizedAt: t(30), blockMembership: { practiceBlockId: "block-1", blockSequenceNumber: 1 } });
  });

  it("findByPracticeBlockId scopes by practiceBlockId and orders by blockSequenceNumber, never a timestamp", async () => {
    const findMany = vi.fn().mockResolvedValue([row]);
    const repo = new PrismaAttemptRepository({ attempt: { findMany } } as unknown as PrismaClient);

    await repo.findByPracticeBlockId("block-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { practiceBlockId: "block-1" },
      orderBy: { blockSequenceNumber: "asc" },
      include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } }
    });
  });

  it("propagates a query failure instead of returning []", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("connection lost"));
    const repo = new PrismaAttemptRepository({ attempt: { findMany } } as unknown as PrismaClient);
    await expect(repo.findFinalizedByStudentId("student-1")).rejects.toThrow("connection lost");
  });
});

describe("PracticeSessionRepository.findActiveByEnrollmentId", () => {
  it("InMemory: null when none is active, the session when exactly one is", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    expect(await repo.findActiveByEnrollmentId("enrollment-1")).toBeNull();

    await repo.create({ id: "session-old", enrollmentId: "enrollment-1", now: t(0) });
    await repo.complete("session-old", { now: t(10) });
    await repo.create({ id: "session-other-enrollment", enrollmentId: "enrollment-2", now: t(0) });
    expect(await repo.findActiveByEnrollmentId("enrollment-1")).toBeNull();

    await repo.create({ id: "session-new", enrollmentId: "enrollment-1", now: t(20) });
    expect((await repo.findActiveByEnrollmentId("enrollment-1"))?.id).toBe("session-new");
  });

  it("InMemory: fails closed when more than one session is active for the enrollment", async () => {
    const repo = new InMemoryPracticeSessionRepository();
    await repo.create({ id: "session-a", enrollmentId: "enrollment-1", now: t(0) });
    await repo.create({ id: "session-b", enrollmentId: "enrollment-1", now: t(10) });
    await expect(repo.findActiveByEnrollmentId("enrollment-1")).rejects.toThrow(PersistenceError);
  });

  it("Prisma: scopes by enrollmentId + status active, and fails closed on two rows", async () => {
    const sessionRow = (id: string) => ({ id, enrollmentId: "enrollment-1", status: "active", startedAt: new Date(t(0)), endedAt: null, sessionTimeBudgetSeconds: null });
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([sessionRow("s-1")]).mockResolvedValueOnce([sessionRow("s-1"), sessionRow("s-2")]);
    const repo = new PrismaPracticeSessionRepository({ practiceSession: { findMany } } as unknown as PrismaClient);

    expect(await repo.findActiveByEnrollmentId("enrollment-1")).toBeNull();
    expect((await repo.findActiveByEnrollmentId("enrollment-1"))?.id).toBe("s-1");
    await expect(repo.findActiveByEnrollmentId("enrollment-1")).rejects.toThrow(PersistenceError);
    expect(findMany).toHaveBeenCalledWith({ where: { enrollmentId: "enrollment-1", status: "active" }, orderBy: { id: "asc" }, take: 2 });
  });
});

describe("EnrollmentReader", () => {
  it("Prisma: selects only id/studentId/examId by id; null when missing", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce({ id: "enrollment-1", studentId: "student-1", examId: "exam-1" }).mockResolvedValueOnce(null);
    const reader = new PrismaEnrollmentReader({ enrollment: { findUnique } } as unknown as PrismaClient);

    expect(await reader.findById("enrollment-1")).toEqual({ id: "enrollment-1", studentId: "student-1", examId: "exam-1" });
    expect(await reader.findById("missing")).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "enrollment-1" }, select: { id: true, studentId: true, examId: true } });
  });

  it("InMemory: returns seeded records, null otherwise", async () => {
    const reader = new InMemoryEnrollmentReader([{ id: "enrollment-1", studentId: "student-1", examId: "exam-1" }]);
    expect(await reader.findById("enrollment-1")).toEqual({ id: "enrollment-1", studentId: "student-1", examId: "exam-1" });
    expect(await reader.findById("enrollment-2")).toBeNull();
  });
});

const dims = { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 };

function questionRow(overrides: Partial<TrainingQuestionRow> = {}): TrainingQuestionRow {
  return {
    id: "q-1",
    validationState: "published",
    difficultyTier: "standard",
    difficultyDimensions: dims,
    noveltyLevel: "standard",
    examRelevance: "core",
    expectedTimeSeconds: 90,
    testingModes: ["reverse"],
    combinesWithConceptIds: [],
    patternTaxonomyCellId: "cell-1",
    trapErrorTaxonomyId: "tax-1",
    exam: { code: "IPMAT_INDORE" },
    section: { name: "Quant" },
    chapter: { name: "Percentages" },
    concept: { name: "Percentages" },
    patternTaxonomyCell: { patternFamily: { name: "Reverse Percentage" } },
    trapErrorTaxonomy: { code: "base_confusion" },
    ...overrides
  };
}

describe("toTrainingQuestionRecord — pure row mapping, fail-closed exclusion", () => {
  it("maps a complete published row to AutopsyQuestionContext with resolved names and no answer-bearing field", () => {
    const record = toTrainingQuestionRecord(questionRow({ combinesWithConceptIds: ["concept-ratio"] }), new Map([["concept-ratio", "Ratio"]]));
    expect(record).toEqual({
      question: {
        questionId: "q-1",
        examCode: "IPMAT_INDORE",
        sectionName: "Quant",
        chapterName: "Percentages",
        conceptName: "Percentages",
        patternFamilyName: "Reverse Percentage",
        patternTaxonomyCellId: "cell-1",
        difficultyTier: "standard",
        difficultyDimensions: dims,
        noveltyLevel: "standard",
        examRelevance: "core",
        testingModes: ["reverse"],
        trapErrorTaxonomyCode: "base_confusion",
        combinesWithConcepts: ["Ratio"]
      },
      expectedTimeSeconds: 90,
      validationState: "published"
    });
    expect(Object.keys(record?.question ?? {})).not.toContain("correctAnswer");
    expect(Object.keys(record?.question ?? {})).not.toContain("options");
  });

  it("a question with no trap maps trapErrorTaxonomyCode to null", () => {
    expect(toTrainingQuestionRecord(questionRow({ trapErrorTaxonomyId: null, trapErrorTaxonomy: null }), new Map())?.question.trapErrorTaxonomyCode).toBeNull();
  });

  it.each<[string, Partial<TrainingQuestionRow>]>([
    ["not published", { validationState: "ai_validated" }],
    ["non-positive expectedTimeSeconds", { expectedTimeSeconds: 0 }],
    ["non-integer expectedTimeSeconds", { expectedTimeSeconds: 12.5 }],
    ["empty testingModes", { testingModes: [] }],
    ["difficultyDimensions not an object", { difficultyDimensions: "hard" }],
    ["difficultyDimensions an array", { difficultyDimensions: [0.1, 0.2] }],
    ["difficultyDimensions missing a dimension", { difficultyDimensions: { ...dims, multiStepDepth: undefined } }],
    ["difficultyDimensions non-finite", { difficultyDimensions: { ...dims, timePressure: Number.NaN } }],
    ["trap id that did not resolve", { trapErrorTaxonomyId: "tax-missing", trapErrorTaxonomy: null }],
    ["unresolvable combinesWithConceptIds", { combinesWithConceptIds: ["concept-missing"] }]
  ])("excludes a row with %s", (_label, overrides) => {
    expect(toTrainingQuestionRecord(questionRow(overrides), new Map())).toBeNull();
  });

  it("parseDifficultyDimensions returns exactly the six dimensions, dropping unrelated keys", () => {
    expect(parseDifficultyDimensions({ ...dims, extra: 1 })).toEqual(dims);
    expect(parseDifficultyDimensions(null)).toBeNull();
  });
});

describe("PrismaTrainingQuestionReader (query shape, no live database)", () => {
  it("selects published questions for the exam WITHOUT any answer-bearing column, resolves combination names in one batch, excludes malformed rows", async () => {
    const questionFindMany = vi.fn().mockResolvedValue([
      questionRow({ id: "q-1", combinesWithConceptIds: ["concept-ratio"] }),
      questionRow({ id: "q-2", difficultyDimensions: { broken: true } }),
      questionRow({ id: "q-3", combinesWithConceptIds: ["concept-ratio", "concept-gone"] })
    ]);
    const conceptFindMany = vi.fn().mockResolvedValue([{ id: "concept-ratio", name: "Ratio" }]);
    const reader = new PrismaTrainingQuestionReader({ question: { findMany: questionFindMany }, concept: { findMany: conceptFindMany } } as unknown as PrismaClient);

    const records = await reader.findPublishedByExamId("exam-1");

    expect(records.map((r) => r.question.questionId)).toEqual(["q-1"]);
    expect(records[0]?.question.combinesWithConcepts).toEqual(["Ratio"]);

    const query = questionFindMany.mock.calls[0]?.[0] as { where: unknown; orderBy: unknown; select: Record<string, unknown>; include?: unknown };
    expect(query.where).toEqual({ examId: "exam-1", validationState: "published" });
    expect(query.orderBy).toEqual({ id: "asc" });
    expect(query.include).toBeUndefined();
    for (const forbidden of ["correctAnswer", "options", "solutionSteps", "groundTruthDerivation", "body"]) {
      expect(query.select).not.toHaveProperty(forbidden);
    }
    expect(conceptFindMany).toHaveBeenCalledTimes(1);
    expect(conceptFindMany).toHaveBeenCalledWith({ where: { id: { in: ["concept-ratio", "concept-gone"] } }, select: { id: true, name: true } });
  });

  it("skips the concept lookup entirely when no question combines concepts; [] when nothing is published", async () => {
    const questionFindMany = vi.fn().mockResolvedValueOnce([questionRow()]).mockResolvedValueOnce([]);
    const conceptFindMany = vi.fn();
    const reader = new PrismaTrainingQuestionReader({ question: { findMany: questionFindMany }, concept: { findMany: conceptFindMany } } as unknown as PrismaClient);

    expect(await reader.findPublishedByExamId("exam-1")).toHaveLength(1);
    expect(await reader.findPublishedByExamId("exam-1")).toEqual([]);
    expect(conceptFindMany).not.toHaveBeenCalled();
  });
});

describe("InMemoryTrainingQuestionReader", () => {
  it("returns only published records for the exam, ordered by question id", async () => {
    const make = (questionId: string, validationState: TrainingQuestionRecord["validationState"]): TrainingQuestionRecord => {
      const record = toTrainingQuestionRecord(questionRow({ id: questionId }), new Map());
      if (!record) throw new Error("fixture row must map");
      return { ...record, validationState };
    };
    const reader = new InMemoryTrainingQuestionReader(new Map([["exam-1", [make("q-2", "published"), make("q-3", "draft"), make("q-1", "published")]]]));
    expect((await reader.findPublishedByExamId("exam-1")).map((r) => r.question.questionId)).toEqual(["q-1", "q-2"]);
    expect(await reader.findPublishedByExamId("exam-2")).toEqual([]);
  });
});

describe("ConceptReader", () => {
  it("Prisma: resolves concepts through published questions of the exam (not Concept.status)", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "concept-1", name: "Percentages", chapterId: "chapter-1" }]);
    const reader = new PrismaConceptReader({ concept: { findMany } } as unknown as PrismaClient);

    expect(await reader.findWithPublishedQuestionsByExamId("exam-1")).toEqual([{ id: "concept-1", name: "Percentages", chapterId: "chapter-1" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { questionsPrimary: { some: { examId: "exam-1", validationState: "published" } } },
      orderBy: { id: "asc" },
      select: { id: true, name: true, chapterId: true }
    });
  });

  it("InMemory: returns seeded concepts for the exam ordered by id, [] otherwise", async () => {
    const reader = new InMemoryConceptReader(
      new Map([["exam-1", [{ id: "concept-2", name: "Ratio", chapterId: "chapter-2" }, { id: "concept-1", name: "Percentages", chapterId: "chapter-1" }]]])
    );
    expect((await reader.findWithPublishedQuestionsByExamId("exam-1")).map((c) => c.id)).toEqual(["concept-1", "concept-2"]);
    expect(await reader.findWithPublishedQuestionsByExamId("exam-2")).toEqual([]);
  });
});
