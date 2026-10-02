import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaHistoricalRecordRepository } from "../../src/repositories/prismaHistoricalRecordRepository.js";

/**
 * Code-level tests against a fake client (NOT a claim about real Postgres -
 * see prismaHistoricalRecordRepository.integration.test.ts for that).
 * Provable here: reads are always scoped by exam code, and the repository
 * selects nothing that is question content.
 */

function fake(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = {
    exam: { findUnique: vi.fn().mockResolvedValue(null) },
    historicalQuestionRecord: { findMany, findUnique: vi.fn(), upsert: vi.fn() },
    concept: { findMany: vi.fn().mockResolvedValue([]) }
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("PrismaHistoricalRecordRepository (fake client)", () => {
  it("every read is filtered by the exam code - there is no unscoped read", async () => {
    const { prisma, findMany } = fake();
    const repo = new PrismaHistoricalRecordRepository(prisma);
    await repo.listByExamCode("EXAM_A");
    await repo.findById("EXAM_A", "id-1");
    expect(findMany.mock.calls[0]![0].where).toEqual({ exam: { code: "EXAM_A" } });
    expect(findMany.mock.calls[1]![0].where).toEqual({ id: "id-1", exam: { code: "EXAM_A" } });
  });

  it("a write for an unknown exam is a typed missing_reference and writes nothing", async () => {
    const { prisma } = fake();
    const record = { id: "x", examCode: "NOPE", classification: null } as never;
    await expect(new PrismaHistoricalRecordRepository(prisma).save(record)).rejects.toBeInstanceOf(PersistenceError);
    expect((prisma.historicalQuestionRecord.upsert as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("includes only names/codes of related rows - no question content is selected", async () => {
    const { prisma, findMany } = fake();
    await new PrismaHistoricalRecordRepository(prisma).listByExamCode("EXAM_A");
    const text = JSON.stringify(findMany.mock.calls[0]![0].include).toLowerCase();
    for (const forbidden of ["body", "options", "answer", "solution", "explanation"]) expect(text).not.toContain(forbidden);
  });
});
