import type { PrismaClient } from "@prisma/client";
import { createDraft, type AuthoredQuestion } from "@ipmat/content-authoring";
import { percentagesReversePercentageExample } from "@ipmat/question-engine";
import { describe, expect, it, vi } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaQuestionAuthoringRepository } from "../../src/repositories/prismaQuestionAuthoringRepository.js";

/**
 * Code-level tests against a fake client (NOT a claim about real Postgres -
 * see prismaQuestionAuthoringRepository.integration.test.ts). Provable here:
 * the repository refuses invalid creates BEFORE any query, and never reads
 * with an unscoped or content-bearing select where it should not.
 */
const { dna: demo, content } = percentagesReversePercentageExample;
const question = (over: Partial<AuthoredQuestion> = {}): AuthoredQuestion => {
  const d: Record<string, unknown> = { ...demo };
  delete d.provenanceSourceType;
  delete d.validationState;
  return { ...createDraft({ id: "q", dna: d as never, content: { body: content.body, answerFormat: "multiple_choice", options: content.options, correctAnswer: content.correctAnswer, solutionSteps: content.solutionSteps, groundTruthDerivation: null }, source: { sourceType: "original", sourceRef: null, licenseRef: null, attributedTo: null }, origin: "human_authored" }), ...over };
};

function fake() {
  const tx = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { $transaction: tx, question: { findMany } } as unknown as PrismaClient;
  return { prisma, tx, findMany };
}

describe("PrismaQuestionAuthoringRepository (fake client)", () => {
  it("only a draft can be created, and the refusal happens before any database work", async () => {
    const { prisma, tx } = fake();
    await expect(new PrismaQuestionAuthoringRepository(prisma).createDraft(question({ validationState: "published" }))).rejects.toBeInstanceOf(PersistenceError);
    expect(tx).not.toHaveBeenCalled();
  });

  it("a new question must state its origin; 'unknown' is refused before any database work", async () => {
    const { prisma, tx } = fake();
    await expect(new PrismaQuestionAuthoringRepository(prisma).createDraft(question({ origin: "unknown" }))).rejects.toMatchObject({ code: "invalid_record" });
    expect(tx).not.toHaveBeenCalled();
  });

  it("identity refs select no answer, solution, reviewer or provenance column", async () => {
    const { prisma, findMany } = fake();
    await new PrismaQuestionAuthoringRepository(prisma).listIdentityRefs("EXAM_A");
    const args = findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ exam: { code: "EXAM_A" } });
    const selected = Object.keys(args.select).sort();
    expect(selected).toEqual(["body", "id", "options", "validationState"]);
  });

  it("every list is scoped by exam code", async () => {
    const { prisma, findMany } = fake();
    const repo = new PrismaQuestionAuthoringRepository(prisma);
    await repo.listIdentityRefs("EXAM_A");
    await repo.listUniverseRefs("EXAM_A");
    for (const call of findMany.mock.calls) expect(call[0].where).toEqual({ exam: { code: "EXAM_A" } });
  });
});
