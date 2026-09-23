import { getEventTimeline, type AttemptState } from "@ipmat/attempt";
import { PracticeBlockLifecycleError, type PracticeBlockStatus } from "@ipmat/practice-block";
import { PersistenceError } from "./errors.js";
import type { AttemptRepository } from "./types.js";
import {
  assertAttemptBlockMembershipUnchanged,
  assertAttemptNotRegressingFromFinalized,
  assertAttemptOwnershipUnchanged,
  assertAttemptStateInternallyConsistent
} from "./validation.js";

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
  /**
   * Maps `practiceBlockId -> { status, enrollmentId, studentId }`, mirroring
   * `PrismaAttemptRepository`'s real
   * `PracticeBlock -> PracticeSession -> Enrollment -> Student` lookup
   * during `blockAllocationRequest` handling (docs/DECISIONS.md D-060,
   * security-fix addendum). `enrollmentId`/`studentId` here are the
   * AUTHORITATIVE resolved ownership facts for that block — never the
   * caller's claim — used to reject an attempt whose own
   * `enrollmentId`/`studentId` don't match. Omit to skip
   * block-existence/status/ownership checking entirely (tests that don't
   * care); a test that exercises ownership verification MUST supply this.
   */
  practiceBlocks?: Map<string, { status: PracticeBlockStatus; enrollmentId: string; studentId: string }>;
}

export class InMemoryAttemptRepository implements AttemptRepository {
  private readonly byId = new Map<string, AttemptState>();

  constructor(private readonly options: InMemoryAttemptRepositoryOptions = {}) {}

  async save(state: AttemptState, blockAllocationRequest?: { practiceBlockId: string }): Promise<AttemptState> {
    assertAttemptStateInternallyConsistent(state);

    const existing = this.byId.get(state.id);
    let resolvedBlockMembership = state.blockMembership;

    if (existing) {
      if (blockAllocationRequest) {
        throw new PersistenceError(
          "invalid_record",
          `Cannot allocate a PracticeBlock for Attempt "${state.id}": it already exists — block membership is immutable once an attempt is created.`
        );
      }
      assertAttemptOwnershipUnchanged(
        { studentId: existing.studentId, questionId: existing.questionId, enrollmentId: existing.enrollmentId, retryOfAttemptId: existing.retryOfAttemptId },
        state
      );
      assertAttemptNotRegressingFromFinalized(existing.status, state.status);
      assertAttemptBlockMembershipUnchanged(
        { practiceBlockId: existing.blockMembership?.practiceBlockId ?? null, blockSequenceNumber: existing.blockMembership?.blockSequenceNumber ?? null },
        state
      );
    } else {
      this.assertReferencesExist(state);
      const retryOf = state.retryOfAttemptId ? (this.byId.get(state.retryOfAttemptId) ?? null) : null;

      if (blockAllocationRequest) {
        resolvedBlockMembership = this.allocateBlockMembership(state, retryOf, blockAllocationRequest);
      } else {
        if (state.blockMembership !== null) {
          throw new PersistenceError(
            "invalid_record",
            `Cannot persist Attempt "${state.id}" with a pre-populated blockMembership — it must be allocated via save()'s blockAllocationRequest parameter.`
          );
        }
        if (retryOf && retryOf.blockMembership !== null) {
          throw new PersistenceError(
            "invalid_record",
            `Retry attempt "${state.id}" must inherit its retried attempt's practiceBlockId ("${retryOf.blockMembership.practiceBlockId}") — this attempt was saved with none.`
          );
        }
        resolvedBlockMembership = null;
      }
    }

    // Same canonical timeline order the Prisma-backed repository persists in — never the raw, possibly caller-reordered state.events array.
    const stored: AttemptState = { ...state, events: getEventTimeline(state), blockMembership: resolvedBlockMembership };
    this.byId.set(state.id, stored);
    return stored;
  }

  async findById(attemptId: string): Promise<AttemptState | null> {
    return this.byId.get(attemptId) ?? null;
  }

  private allocateBlockMembership(
    state: AttemptState,
    retryOf: AttemptState | null,
    blockAllocationRequest: { practiceBlockId: string }
  ): { practiceBlockId: string; blockSequenceNumber: number } {
    if (this.options.practiceBlocks) {
      const record = this.options.practiceBlocks.get(blockAllocationRequest.practiceBlockId);
      if (record === undefined) {
        throw new PersistenceError("missing_reference", `No PracticeBlock found with id "${blockAllocationRequest.practiceBlockId}".`);
      }
      if (record.status !== "active") {
        throw new PracticeBlockLifecycleError(
          "already_finalized",
          `Cannot allocate Attempt "${state.id}" to PracticeBlock "${blockAllocationRequest.practiceBlockId}": it is "${record.status}", not "active".`
        );
      }
      // AUTHORITATIVE ownership check (security-fix addendum, docs/DECISIONS.md
      // D-060) — re-derived from this fixture's own resolved ownership record,
      // regardless of whether a fast PracticeBlockReader pre-check already ran
      // one layer up. Never trusts state.studentId/state.enrollmentId as given.
      if (record.enrollmentId !== state.enrollmentId || record.studentId !== state.studentId) {
        throw new PersistenceError(
          "ownership_mismatch",
          `Cannot allocate Attempt "${state.id}" to PracticeBlock "${blockAllocationRequest.practiceBlockId}": it resolves to enrollmentId="${record.enrollmentId}"/studentId="${record.studentId}", but this attempt claims enrollmentId="${state.enrollmentId}"/studentId="${state.studentId}".`
        );
      }
    }

    if (retryOf && (retryOf.blockMembership?.practiceBlockId ?? null) !== blockAllocationRequest.practiceBlockId) {
      throw new PersistenceError(
        "invalid_record",
        `Retry attempt "${state.id}" must inherit its retried attempt's practiceBlockId ("${retryOf.blockMembership?.practiceBlockId ?? "none"}") — got "${blockAllocationRequest.practiceBlockId}".`
      );
    }

    let maxSequence = 0;
    for (const attempt of this.byId.values()) {
      if (attempt.blockMembership?.practiceBlockId === blockAllocationRequest.practiceBlockId) {
        maxSequence = Math.max(maxSequence, attempt.blockMembership.blockSequenceNumber);
      }
    }

    return { practiceBlockId: blockAllocationRequest.practiceBlockId, blockSequenceNumber: maxSequence + 1 };
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
