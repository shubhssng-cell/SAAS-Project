import { getEventTimeline, type AttemptState } from "@ipmat/attempt";
import { PersistenceError } from "./errors.js";
import type { AttemptRepository } from "./types.js";
import { assertAttemptNotRegressingFromFinalized, assertAttemptOwnershipUnchanged, assertAttemptStateInternallyConsistent } from "./validation.js";

/**
 * A real, exported part of `@ipmat/db`'s production surface — NOT a
 * test-only fixture — the same pattern `@ipmat/ai`'s `FixtureProvider`
 * already established (a deterministic, in-memory test double shipped
 * from the package's own `src/`, specifically so OTHER packages' tests
 * can depend on it via the package name rather than reaching into a
 * `test/` directory across a package boundary). Implements the SAME
 * `AttemptRepository` interface `PrismaAttemptRepository` does, and calls
 * the EXACT SAME shared validation functions and `getEventTimeline()`
 * export — round-trip persistence semantics tested here are the real
 * contract, not a second, hand-copied approximation of it (docs/
 * DECISIONS.md D-043/D-046).
 */
export interface InMemoryAttemptRepositoryOptions {
  /** Omit any of these three to skip that reference check entirely (the common case for tests that don't care about FK validation); supply a Set (even empty) to exercise the SAME `missing_reference` fail-closed path `PrismaAttemptRepository` exercises via real queries. */
  knownStudentIds?: Set<string>;
  knownQuestionIds?: Set<string>;
  knownEnrollmentIds?: Set<string>;
}

export class InMemoryAttemptRepository implements AttemptRepository {
  private readonly byId = new Map<string, AttemptState>();

  constructor(private readonly options: InMemoryAttemptRepositoryOptions = {}) {}

  async save(state: AttemptState): Promise<AttemptState> {
    assertAttemptStateInternallyConsistent(state);

    const existing = this.byId.get(state.id);
    if (existing) {
      assertAttemptOwnershipUnchanged(
        { studentId: existing.studentId, questionId: existing.questionId, enrollmentId: existing.enrollmentId, retryOfAttemptId: existing.retryOfAttemptId },
        state
      );
      assertAttemptNotRegressingFromFinalized(existing.status, state.status);
    } else {
      this.assertReferencesExist(state);
    }

    // Same canonical timeline order the Prisma-backed repository persists in — never the raw, possibly caller-reordered state.events array.
    const stored: AttemptState = { ...state, events: getEventTimeline(state) };
    this.byId.set(state.id, stored);
    return stored;
  }

  async findById(attemptId: string): Promise<AttemptState | null> {
    return this.byId.get(attemptId) ?? null;
  }

  private assertReferencesExist(state: AttemptState): void {
    if (this.options.knownStudentIds && !this.options.knownStudentIds.has(state.studentId)) {
      throw new PersistenceError("missing_reference", `No Student found with id "${state.studentId}".`);
    }
    if (this.options.knownQuestionIds && !this.options.knownQuestionIds.has(state.questionId)) {
      throw new PersistenceError("missing_reference", `No Question found with id "${state.questionId}".`);
    }
    if (this.options.knownEnrollmentIds && !this.options.knownEnrollmentIds.has(state.enrollmentId)) {
      throw new PersistenceError("missing_reference", `No Enrollment found with id "${state.enrollmentId}".`);
    }
    if (state.retryOfAttemptId && !this.byId.has(state.retryOfAttemptId)) {
      throw new PersistenceError("missing_reference", `No Attempt found with id "${state.retryOfAttemptId}" for retryOfAttemptId.`);
    }
  }
}
