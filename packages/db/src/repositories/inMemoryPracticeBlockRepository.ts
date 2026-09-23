import { abandonPracticeBlock, completePracticeBlock, createPracticeBlock, type PracticeBlockState } from "@ipmat/practice-block";
import { PersistenceError } from "./errors.js";
import type { PracticeBlockOwnershipRecord, PracticeBlockReader, PracticeBlockRepository } from "./types.js";

export interface InMemoryPracticeBlockRepositoryOptions {
  /** Omit to skip the `missing_reference` check entirely (tests that don't care about FK validation); supply a Set (even empty) to exercise it. */
  knownPracticeSessionIds?: Set<string>;
  /** True unless the caller asserts otherwise — the ONE fact this in-memory double cannot look up itself without a reference to `InMemoryPracticeSessionRepository` (kept independent on purpose, mirroring the two domain packages' own decoupling). Supply a function to check a real, evolving session's status. */
  isSessionActive?: (practiceSessionId: string) => boolean;
  /**
   * Resolves a `PracticeSession`'s REAL ownership chain
   * (`practiceSessionId -> { enrollmentId, studentId }`) — mirroring the
   * real `PracticeSession -> Enrollment -> Student` join
   * `PrismaPracticeBlockReader`/`PrismaAttemptRepository` perform
   * (security-fix addendum, docs/DECISIONS.md D-060). Required for any
   * test that exercises ownership verification (security tests A-H);
   * omitting it means `findOwnershipById()` cannot report real
   * `enrollmentId`/`studentId` (returned as empty strings), so a test
   * relying on this in-memory double for ownership checks MUST supply it.
   */
  resolveSessionOwnership?: (practiceSessionId: string) => { enrollmentId: string; studentId: string } | undefined;
}

/**
 * A real, exported part of `@ipmat/db`'s production surface (the same
 * `FixtureProvider`-in-`@ipmat/ai` pattern already used throughout this
 * codebase), implementing the SAME `PracticeBlockRepository` interface
 * `PrismaPracticeBlockRepository` does, and calling the EXACT SAME
 * `@ipmat/practice-block` pure lifecycle functions.
 *
 * Deliberately does NOT implement `PracticeBlockReader` directly —
 * `PracticeBlockRepository.findById()` returns the full `PracticeBlockState`
 * while `PracticeBlockReader.findById()` returns the narrower, ownership-
 * resolved `PracticeBlockOwnershipRecord` (security-fix addendum, docs/
 * DECISIONS.md D-060); a single method can't honestly satisfy both return
 * shapes at once now that ownership fields exist. `findOwnershipById()`
 * below is the internal method `InMemoryPracticeBlockReader` (the actual
 * `PracticeBlockReader` implementation) delegates to — mirroring how
 * `PrismaPracticeBlockRepository`/`PrismaPracticeBlockReader` are two
 * separate classes for production code.
 */
export class InMemoryPracticeBlockRepository implements PracticeBlockRepository {
  private readonly byId = new Map<string, PracticeBlockState>();

  constructor(private readonly options: InMemoryPracticeBlockRepositoryOptions = {}) {}

  async create(input: {
    id: string;
    practiceSessionId: string;
    now: string;
    targetQuestionCount?: number | null;
    blockTimeBudgetSeconds?: number | null;
  }): Promise<PracticeBlockState> {
    if (this.options.knownPracticeSessionIds && !this.options.knownPracticeSessionIds.has(input.practiceSessionId)) {
      throw new PersistenceError("missing_reference", `No PracticeSession found with id "${input.practiceSessionId}".`);
    }

    let maxSequence = 0;
    for (const block of this.byId.values()) {
      if (block.practiceSessionId === input.practiceSessionId) {
        maxSequence = Math.max(maxSequence, block.sequenceNumber);
      }
    }

    const sessionIsActive = this.options.isSessionActive ? this.options.isSessionActive(input.practiceSessionId) : true;

    const block = createPracticeBlock({
      id: input.id,
      practiceSessionId: input.practiceSessionId,
      sequenceNumber: maxSequence + 1,
      now: input.now,
      sessionIsActive,
      targetQuestionCount: input.targetQuestionCount,
      blockTimeBudgetSeconds: input.blockTimeBudgetSeconds
    });

    this.byId.set(block.id, block);
    return block;
  }

  async findById(blockId: string): Promise<PracticeBlockState | null> {
    return this.byId.get(blockId) ?? null;
  }

  async findOwnershipById(practiceBlockId: string): Promise<PracticeBlockOwnershipRecord | null> {
    const block = this.byId.get(practiceBlockId);
    if (!block) return null;
    const ownership = this.options.resolveSessionOwnership?.(block.practiceSessionId);
    return { id: block.id, status: block.status, enrollmentId: ownership?.enrollmentId ?? "", studentId: ownership?.studentId ?? "" };
  }

  async findBySessionId(practiceSessionId: string): Promise<PracticeBlockState[]> {
    return [...this.byId.values()].filter((block) => block.practiceSessionId === practiceSessionId).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async complete(blockId: string, input: { now: string }): Promise<PracticeBlockState> {
    return this.terminate(blockId, "completed", input);
  }

  async abandon(blockId: string, input: { now: string }): Promise<PracticeBlockState> {
    return this.terminate(blockId, "abandoned", input);
  }

  private async terminate(blockId: string, outcome: "completed" | "abandoned", input: { now: string }): Promise<PracticeBlockState> {
    const current = this.byId.get(blockId) ?? null;
    const next = outcome === "completed" ? completePracticeBlock(current, { now: input.now }) : abandonPracticeBlock(current, { now: input.now });
    this.byId.set(next.id, next);
    return next;
  }
}

/**
 * A minimal, standalone `PracticeBlockReader` adapter over an existing
 * `InMemoryPracticeBlockRepository`, so `@ipmat/practice-loop` tests can
 * depend on the narrower `PracticeBlockReader` interface directly (the same
 * `PracticeBlockReader`-mirrors-`QuestionReader` role `PrismaPracticeBlockReader`
 * plays for production code) without exposing the wider repository surface.
 */
export class InMemoryPracticeBlockReader implements PracticeBlockReader {
  constructor(private readonly repository: InMemoryPracticeBlockRepository) {}

  async findById(practiceBlockId: string): Promise<PracticeBlockOwnershipRecord | null> {
    return this.repository.findOwnershipById(practiceBlockId);
  }
}
