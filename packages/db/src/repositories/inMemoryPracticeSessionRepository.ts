import { abandonPracticeSession, completePracticeSession, type PracticeSessionState } from "@ipmat/practice-session";
import { PersistenceError } from "./errors.js";
import type { InMemoryPracticeBlockRepository } from "./inMemoryPracticeBlockRepository.js";
import type { PracticeSessionRepository } from "./types.js";

export interface InMemoryPracticeSessionRepositoryOptions {
  /** Omit to skip the `missing_reference` check entirely (tests that don't care about FK validation); supply a Set (even empty) to exercise it. */
  knownEnrollmentIds?: Set<string>;
  /**
   * Shares the SAME block store an `InMemoryPracticeBlockRepository`
   * already holds, so `complete()`/`abandon()` can re-verify "no active
   * child block" against real, evolving block state — exactly what
   * `PrismaPracticeSessionRepository` does via a real `practice_blocks`
   * count query. Omitting it means "no blocks exist" (0 active), which is
   * correct and sufficient for tests that never create a block.
   */
  blockRepository?: InMemoryPracticeBlockRepository;
}

/**
 * A real, exported part of `@ipmat/db`'s production surface, implementing
 * the SAME `PracticeSessionRepository` interface
 * `PrismaPracticeSessionRepository` does, and calling the EXACT SAME
 * `@ipmat/practice-session` pure lifecycle functions.
 */
export class InMemoryPracticeSessionRepository implements PracticeSessionRepository {
  private readonly byId = new Map<string, PracticeSessionState>();

  constructor(private readonly options: InMemoryPracticeSessionRepositoryOptions = {}) {}

  async create(input: { id: string; enrollmentId: string; now: string; sessionTimeBudgetSeconds?: number | null }): Promise<PracticeSessionState> {
    if (this.options.knownEnrollmentIds && !this.options.knownEnrollmentIds.has(input.enrollmentId)) {
      throw new PersistenceError("missing_reference", `No Enrollment found with id "${input.enrollmentId}".`);
    }

    const session: PracticeSessionState = {
      id: input.id,
      enrollmentId: input.enrollmentId,
      status: "active",
      startedAt: input.now,
      endedAt: null,
      sessionTimeBudgetSeconds: input.sessionTimeBudgetSeconds ?? null
    };
    this.byId.set(session.id, session);
    return session;
  }

  async findById(sessionId: string): Promise<PracticeSessionState | null> {
    return this.byId.get(sessionId) ?? null;
  }

  async complete(sessionId: string, input: { now: string }): Promise<PracticeSessionState> {
    return this.terminate(sessionId, "completed", input);
  }

  async abandon(sessionId: string, input: { now: string }): Promise<PracticeSessionState> {
    return this.terminate(sessionId, "abandoned", input);
  }

  private async terminate(sessionId: string, outcome: "completed" | "abandoned", input: { now: string }): Promise<PracticeSessionState> {
    const current = this.byId.get(sessionId) ?? null;

    const activeBlocks = this.options.blockRepository ? await this.options.blockRepository.findBySessionId(sessionId) : [];
    const hasActiveBlock = activeBlocks.some((block) => block.status === "active");

    const next =
      outcome === "completed"
        ? completePracticeSession(current, { now: input.now, hasActiveBlock })
        : abandonPracticeSession(current, { now: input.now, hasActiveBlock });

    this.byId.set(next.id, next);
    return next;
  }
}
