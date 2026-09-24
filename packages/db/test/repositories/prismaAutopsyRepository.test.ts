import type { PrismaClient } from "@prisma/client";
import type { AutopsyHypothesis, AutopsyOutput } from "@ipmat/autopsy";
import { describe, expect, it, vi } from "vitest";
import { PrismaAutopsyRepository } from "../../src/repositories/prismaAutopsyRepository.js";

/**
 * docs/DECISIONS.md D-039 addendum. Code-level query-shape verification
 * against a fake `PrismaClient` (see `prismaRepairPlanRepository.test.ts`
 * for the same pattern/rationale) — proves `confirmedAt` genuinely reaches
 * both the `create` and `update` branches of the upsert, and is mapped
 * back correctly on read.
 */

const confirmedHypothesis: AutopsyHypothesis = {
  attemptId: "attempt-prisma-autopsy-1",
  proposedErrorCategory: "misconception",
  proposedExplanation: "Applied the percentage change to the wrong base quantity.",
  supportingEvidence: ["Matched the designated trap."],
  contradictoryEvidence: [],
  missingEvidence: [],
  modelConfidence: 0.7,
  confirmationRequired: true,
  confirmationStatus: "confirmed",
  studentCorrectionText: null,
  respondedAt: "2026-09-22T11:00:00.000Z",
  generationMetadata: {
    provider: "fixture",
    model: "fixture",
    promptVersion: "autopsy-hypothesis-v1",
    task: "autopsy-hypothesis",
    timestamp: "2026-09-22T10:59:00.000Z",
    latencyMs: 10,
    tokenUsage: null,
    estimatedCostUsd: null,
    success: true,
    validationOutcome: "valid",
    attempts: 1
  }
};

const output = {
  attemptFacts: { attemptId: "attempt-prisma-autopsy-1" },
  behaviorSignals: {},
  historicalSignals: null,
  candidateErrorEvidence: null
} as unknown as AutopsyOutput;

function makeFakePrisma() {
  const row = {
    id: "autopsy-row-1",
    attemptId: "attempt-prisma-autopsy-1",
    hypothesisText: confirmedHypothesis.proposedExplanation,
    errorTaxonomyId: null,
    likelyRootCause: confirmedHypothesis.proposedErrorCategory,
    evidenceUsed: {},
    confirmed: true,
    confirmedAt: new Date("2026-09-22T11:00:00.000Z"),
    studentCorrectionText: null,
    generatedByProvider: "fixture",
    promptVersion: "autopsy-hypothesis-v1",
    createdAt: new Date("2026-09-22T10:59:00.000Z")
  };
  const upsert = vi.fn().mockResolvedValue(row);
  const findUnique = vi.fn().mockResolvedValue(row);
  const fake = { autopsy: { upsert, findUnique } };
  return { fake, upsert, findUnique, row };
}

describe("PrismaAutopsyRepository — confirmedAt (docs/DECISIONS.md D-039 addendum, no live database)", () => {
  it("[C] save() writes confirmedAt in both the create and update branches", async () => {
    const { fake, upsert } = makeFakePrisma();
    const repo = new PrismaAutopsyRepository(fake as unknown as PrismaClient);

    await repo.save({ hypothesis: confirmedHypothesis, output });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ confirmed: true, confirmedAt: new Date("2026-09-22T11:00:00.000Z") }),
        update: expect.objectContaining({ confirmed: true, confirmedAt: new Date("2026-09-22T11:00:00.000Z") })
      })
    );
  });

  it("writes confirmedAt: null while still awaiting_confirmation", async () => {
    const { fake, upsert } = makeFakePrisma();
    const repo = new PrismaAutopsyRepository(fake as unknown as PrismaClient);
    const awaiting: AutopsyHypothesis = { ...confirmedHypothesis, confirmationStatus: "awaiting_confirmation", respondedAt: null };

    await repo.save({ hypothesis: awaiting, output });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ confirmedAt: null }) }));
  });

  it("read mapping returns confirmedAt as an ISO string", async () => {
    const { fake } = makeFakePrisma();
    const repo = new PrismaAutopsyRepository(fake as unknown as PrismaClient);

    const stored = await repo.findByAttemptId("attempt-prisma-autopsy-1");

    expect(stored?.confirmedAt).toBe("2026-09-22T11:00:00.000Z");
  });

  it("read mapping returns confirmedAt: null when the stored row has no confirmedAt", async () => {
    const { fake, row } = makeFakePrisma();
    row.confirmedAt = null as never;
    const repo = new PrismaAutopsyRepository(fake as unknown as PrismaClient);

    const stored = await repo.findByAttemptId("attempt-prisma-autopsy-1");

    expect(stored?.confirmedAt).toBeNull();
  });
});
