import { PublicationDecisionError } from "@ipmat/question-engine";
import { describe, expect, it } from "vitest";
import { PersistenceError } from "../../src/repositories/errors.js";
import { InMemoryQuestionPublicationRepository } from "../../src/repositories/inMemoryQuestionPublicationRepository.js";
import { InMemoryQuestionReader } from "../../src/repositories/inMemoryQuestionReader.js";
import type { QuestionPublicationRecord } from "../../src/repositories/types.js";

/**
 * Phase 3.5 (Content Curation / Publication Workflow): proves the
 * persistence boundary for explicit human publish/reject decisions
 * against `InMemoryQuestionPublicationRepository` — the same interface
 * `PrismaQuestionPublicationRepository` implements — since no live
 * database has ever been reachable (docs/MASTER_PLAN.md "Current state").
 * Every decision goes through the SAME `decidePublication()` domain
 * function this repository shares with its Prisma counterpart; nothing
 * here re-implements or duplicates that logic.
 */

const standardAiValidated: QuestionPublicationRecord = {
  id: "question-curation-1",
  validationState: "ai_validated",
  difficultyTier: "standard",
  hasProvenance: true
};

const hardAiValidated: QuestionPublicationRecord = {
  id: "question-curation-2",
  validationState: "ai_validated",
  difficultyTier: "hard",
  hasProvenance: true
};

function newRepo(seed: QuestionPublicationRecord[] = [standardAiValidated]): InMemoryQuestionPublicationRepository {
  return new InMemoryQuestionPublicationRepository(seed);
}

describe("QuestionPublicationRepository — explicit human publish/reject decisions, never automatic", () => {
  it("an ai_validated (Standard-tier) candidate stays ai_validated until an explicit 'publish' decision is applied -- no ordinary read/seed operation moves it", async () => {
    const repo = newRepo();
    const before = await repo.findById(standardAiValidated.id);
    expect(before?.validationState).toBe("ai_validated");
  });

  it("a Hard-tier candidate at ai_validated (the pipeline's own 'review_required' territory) cannot be published -- prerequisites are checked against the REAL stored record, not any caller claim", async () => {
    const repo = newRepo([hardAiValidated]);
    await expect(repo.decide(hardAiValidated.id, "publish")).rejects.toThrow(PublicationDecisionError);

    // The refused decision must not have silently written anything.
    const after = await repo.findById(hardAiValidated.id);
    expect(after?.validationState).toBe("ai_validated");
  });

  it("a Hard-tier candidate CAN be published once it is human_reviewed", async () => {
    const repo = newRepo([{ ...hardAiValidated, validationState: "human_reviewed" }]);
    const result = await repo.decide(hardAiValidated.id, "publish");
    expect(result.validationState).toBe("published");
  });

  it("a rejected candidate can never silently return to published through this or any other operation", async () => {
    const repo = newRepo([{ ...standardAiValidated, validationState: "rejected" }]);
    await expect(repo.decide(standardAiValidated.id, "publish")).rejects.toThrow(PublicationDecisionError);
    const after = await repo.findById(standardAiValidated.id);
    expect(after?.validationState).toBe("rejected");
  });

  it("an explicit publish transition changes state correctly and preserves the question's identity", async () => {
    const repo = newRepo();
    const result = await repo.decide(standardAiValidated.id, "publish");

    expect(result.id).toBe(standardAiValidated.id);
    expect(result.validationState).toBe("published");
    expect(result.difficultyTier).toBe(standardAiValidated.difficultyTier);
    expect(result.hasProvenance).toBe(standardAiValidated.hasProvenance);
  });

  it("an explicit reject transition changes state correctly", async () => {
    const repo = newRepo();
    const result = await repo.decide(standardAiValidated.id, "reject");
    expect(result.validationState).toBe("rejected");
  });

  it("publish fails closed (and writes nothing) when provenance is missing", async () => {
    const repo = newRepo([{ ...standardAiValidated, hasProvenance: false }]);
    await expect(repo.decide(standardAiValidated.id, "publish")).rejects.toThrow(/no Provenance record/);
    expect((await repo.findById(standardAiValidated.id))?.validationState).toBe("ai_validated");
  });

  it("invalid transitions (already-terminal states) fail closed for both actions", async () => {
    const publishedRepo = newRepo([{ ...standardAiValidated, validationState: "published" }]);
    await expect(publishedRepo.decide(standardAiValidated.id, "publish")).rejects.toThrow(PublicationDecisionError);
    await expect(publishedRepo.decide(standardAiValidated.id, "reject")).rejects.toThrow(PublicationDecisionError);
  });

  it("a decision against a nonexistent question throws PersistenceError(missing_reference), never a silent no-op", async () => {
    const repo = newRepo([]);
    await expect(repo.decide("does-not-exist", "publish")).rejects.toThrow(PersistenceError);
  });

  it("there is no method on this repository that accepts a raw target ValidationState -- decide() only ever takes 'publish' | 'reject'", () => {
    const repo = newRepo();
    // @ts-expect-error -- decide() must not accept a raw ValidationState as its action.
    void repo.decide(standardAiValidated.id, "published");
  });
});

describe("InMemoryQuestionPublicationRepository — concurrent-call behavior (NOT evidence about PostgreSQL)", () => {
  /**
   * IMPORTANT SCOPE OF THIS TEST: `Promise.all([repo.decide(...), repo.decide(...)])`
   * against a single in-process `Map` is safe here ONLY because
   * `InMemoryQuestionPublicationRepository.decide()`'s body contains no
   * `await` between its read and its write -- Node runs an async function
   * with no internal `await` to completion synchronously before yielding,
   * so two calls invoked back-to-back (as `Promise.all` does) can never
   * actually interleave mid-operation. That is a genuine, correct fact
   * about THIS test double and Node's execution model.
   *
   * It is NOT evidence that `PrismaQuestionPublicationRepository` is safe
   * against two concurrent requests hitting two separate database
   * connections, which is a completely different scenario (real OS
   * threads / connections, no shared single-threaded event loop). That
   * claim rests entirely on Postgres's `Serializable` isolation semantics
   * (see `prismaQuestionPublicationRepository.ts`'s own doc comment) and
   * has not been, and cannot currently be, verified against a live
   * database. Do not read this test as proving anything about Postgres.
   */
  it("two concurrent decide() calls against the in-memory double never lose an update -- exactly one succeeds, the other correctly sees the now-terminal state", async () => {
    const repo = newRepo();

    const [publishResult, rejectResult] = await Promise.allSettled([repo.decide(standardAiValidated.id, "publish"), repo.decide(standardAiValidated.id, "reject")]);

    // Because decide() never yields mid-operation, the first call to actually run
    // (here, "publish", since Promise.all invokes executors in argument order and
    // neither has an internal await) completes entirely before the second begins --
    // so the second deterministically observes the already-terminal "published" state.
    expect(publishResult.status).toBe("fulfilled");
    expect(rejectResult.status).toBe("rejected");
    if (rejectResult.status === "rejected") {
      expect(rejectResult.reason).toBeInstanceOf(PublicationDecisionError);
    }

    const final = await repo.findById(standardAiValidated.id);
    expect(final?.validationState).toBe("published");
  });
});

describe("QuestionPublicationRepository x QuestionReader — the existing 4B publication gate is consistent with this workflow's output", () => {
  it("before publication, a QuestionReader-shaped read reports a non-published validationState (the gate @ipmat/practice-loop's startAttempt() checks would refuse it)", async () => {
    const publicationRepo = newRepo();
    const record = await publicationRepo.findById(standardAiValidated.id);
    expect(record).not.toBeNull();

    const reader = new InMemoryQuestionReader([
      {
        id: record!.id,
        conceptId: "concept-percentages",
        options: ["420", "450", "480", "500"],
        correctAnswer: "480",
        expectedTimeSeconds: 90,
        validationState: record!.validationState
      }
    ]);
    const canonical = await reader.findById(standardAiValidated.id);
    expect(canonical?.validationState).not.toBe("published");
  });

  it("after an explicit publish decision, the SAME row's QuestionReader-shaped read now satisfies the gate", async () => {
    const publicationRepo = newRepo();
    const decided = await publicationRepo.decide(standardAiValidated.id, "publish");

    const reader = new InMemoryQuestionReader([
      {
        id: decided.id,
        conceptId: "concept-percentages",
        options: ["420", "450", "480", "500"],
        correctAnswer: "480",
        expectedTimeSeconds: 90,
        validationState: decided.validationState
      }
    ]);
    const canonical = await reader.findById(standardAiValidated.id);
    expect(canonical?.validationState).toBe("published");
  });
});
