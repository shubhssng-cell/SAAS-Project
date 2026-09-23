import type { PrismaClient } from "@prisma/client";
import { PublicationDecisionError } from "@ipmat/question-engine";
import { describe, expect, it, vi } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { PrismaQuestionPublicationRepository } from "../../src/repositories/prismaQuestionPublicationRepository.js";

/**
 * Deliberately narrow, code-level tests — NOT a claim that any of this
 * proves real PostgreSQL transaction behavior. This codebase has never
 * exercised a `PrismaXRepository` class against a live database (see
 * every other `PrismaXRepository`'s own doc comment), and that remains
 * true here. What CAN be proven deterministically, without a live
 * database, is that `PrismaQuestionPublicationRepository.decide()`
 * actually REQUESTS `Serializable` isolation from Prisma, and that a
 * refused `decidePublication()` call never reaches `question.update()` at
 * all. Whether Postgres's Serializable Snapshot Isolation actually aborts
 * a concurrent conflicting transaction the way its own doc comment
 * describes is standard, well-documented Postgres behavior, but has NOT
 * been (and cannot currently be, since no live database has ever been
 * reachable in this environment) verified end-to-end.
 */

interface FakeQuestionRow {
  id: string;
  validationState: string;
  difficultyTier: string;
  provenanceId: string | null;
}

function makeFakePrisma(row: FakeQuestionRow | null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockImplementation(async ({ data }: { data: { validationState: string } }) => ({
    ...(row as FakeQuestionRow),
    validationState: data.validationState
  }));

  let capturedTransactionOptions: unknown;
  const fake = {
    question: { findUnique, update },
    async $transaction(fn: (tx: unknown) => Promise<unknown>, options?: unknown) {
      capturedTransactionOptions = options;
      return fn(fake);
    }
  };

  return { fake, findUnique, update, getTransactionOptions: () => capturedTransactionOptions };
}

const aiValidatedStandardRow: FakeQuestionRow = {
  id: "question-prisma-1",
  validationState: "ai_validated",
  difficultyTier: "standard",
  provenanceId: "provenance-1"
};

describe("PrismaQuestionPublicationRepository — code-level concurrency-safety properties (no live database)", () => {
  it("decide() requests Serializable isolation on every call -- a real, deterministic regression guard against the TOCTOU race this repository exists to close", async () => {
    const { fake, getTransactionOptions } = makeFakePrisma(aiValidatedStandardRow);
    const repo = new PrismaQuestionPublicationRepository(fake as unknown as PrismaClient);

    await repo.decide("question-prisma-1", "publish");

    expect(getTransactionOptions()).toEqual({ isolationLevel: "Serializable" });
  });

  it("a successful publish decision writes the new validationState and returns the canonical record", async () => {
    const { fake, update } = makeFakePrisma(aiValidatedStandardRow);
    const repo = new PrismaQuestionPublicationRepository(fake as unknown as PrismaClient);

    const result = await repo.decide("question-prisma-1", "publish");

    expect(update).toHaveBeenCalledWith({ where: { id: "question-prisma-1" }, data: { validationState: "published" } });
    expect(result).toEqual({ id: "question-prisma-1", validationState: "published", difficultyTier: "standard", hasProvenance: true });
  });

  it("a refused decision (decidePublication throws) NEVER reaches question.update() -- the refusal happens strictly before any write attempt", async () => {
    const hardTierNotReviewed: FakeQuestionRow = { ...aiValidatedStandardRow, difficultyTier: "hard" };
    const { fake, update } = makeFakePrisma(hardTierNotReviewed);
    const repo = new PrismaQuestionPublicationRepository(fake as unknown as PrismaClient);

    await expect(repo.decide("question-prisma-1", "publish")).rejects.toThrow(PublicationDecisionError);
    expect(update).not.toHaveBeenCalled();
  });

  it("a nonexistent question throws PersistenceError(missing_reference) and never calls update()", async () => {
    const { fake, update } = makeFakePrisma(null);
    const repo = new PrismaQuestionPublicationRepository(fake as unknown as PrismaClient);

    await expect(repo.decide("does-not-exist", "publish")).rejects.toThrow(PersistenceError);
    expect(update).not.toHaveBeenCalled();
  });

  it("findById() does not open a transaction -- it is a plain read, matching QuestionReader's own read-only shape", async () => {
    const { fake, getTransactionOptions } = makeFakePrisma(aiValidatedStandardRow);
    const repo = new PrismaQuestionPublicationRepository(fake as unknown as PrismaClient);

    const result = await repo.findById("question-prisma-1");

    expect(result).toEqual({ id: "question-prisma-1", validationState: "ai_validated", difficultyTier: "standard", hasProvenance: true });
    expect(getTransactionOptions()).toBeUndefined();
  });
});
