import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaContentIntelligenceRepository } from "../../src/repositories/prismaContentIntelligenceRepository.js";

/**
 * Code-level tests against a fake client (NOT a claim about real Postgres - see
 * prismaContentIntelligenceRepository.integration.test.ts). Provable here: every
 * read is exam-scoped, a decision is only ever applied to a still-undecided
 * candidate, and the repository refuses invalid decisions before any query.
 */
function fake() {
  const contentSource = { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) };
  const contentSourceVersion = { findMany: vi.fn().mockResolvedValue([]) };
  const contentChunk = { findMany: vi.fn().mockResolvedValue([]) };
  const contentCandidate = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn().mockResolvedValue(null) };
  const prisma = { contentSource, contentSourceVersion, contentChunk, contentCandidate } as unknown as PrismaClient;
  return { prisma, contentSource, contentSourceVersion, contentChunk, contentCandidate };
}

describe("PrismaContentIntelligenceRepository (fake client)", () => {
  it("loadExam scopes every table by the exam code through the source", async () => {
    const f = fake();
    await new PrismaContentIntelligenceRepository(f.prisma).loadExam("EXAM_A");
    expect(f.contentSource.findMany.mock.calls[0]![0].where).toEqual({ exam: { code: "EXAM_A" } });
    for (const call of [f.contentSourceVersion.findMany, f.contentChunk.findMany, f.contentCandidate.findMany]) {
      expect(JSON.stringify(call.mock.calls[0]![0].where)).toContain('"code":"EXAM_A"');
    }
  });

  it("getChunks is exam-scoped and skips the query entirely for no ids", async () => {
    const f = fake();
    const repo = new PrismaContentIntelligenceRepository(f.prisma);
    expect(await repo.getChunks("EXAM_A", [])).toEqual([]);
    expect(f.contentChunk.findMany).not.toHaveBeenCalled();
    await repo.getChunks("EXAM_A", ["c1"]);
    expect(JSON.stringify(f.contentChunk.findMany.mock.calls[0]![0].where)).toContain('"code":"EXAM_A"');
  });

  it("a decision is applied only to a candidate that is still undecided (state filter in the WHERE)", async () => {
    const f = fake();
    const candidate = { kind: "concept_mention", id: "c1", state: "accepted", review: { reviewedBy: "r", reviewedAt: "2026-10-02T10:00:00.000Z" } } as never;
    await expect(new PrismaContentIntelligenceRepository(f.prisma).decideCandidate(candidate)).rejects.toMatchObject({ code: "invalid_candidate" });
    expect(f.contentCandidate.updateMany.mock.calls[0]![0].where).toEqual({ id: "c1", state: "candidate" });
  });

  it("an 'undecided' or review-less decision is refused before any query", async () => {
    const f = fake();
    const repo = new PrismaContentIntelligenceRepository(f.prisma);
    await expect(repo.decideCandidate({ id: "c", state: "candidate", review: null } as never)).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(repo.decideCandidate({ id: "c", state: "accepted", review: null } as never)).rejects.toMatchObject({ code: "invalid_transition" });
    expect(f.contentCandidate.updateMany).not.toHaveBeenCalled();
  });
});
