import { Prisma, type PrismaClient } from "@prisma/client";
import { getEventTimeline, type AttemptEventRecord, type AttemptState } from "@ipmat/attempt";
import { PersistenceError } from "./errors.js";
import { asJson } from "./json.js";
import type { AttemptRepository } from "./types.js";
import { assertAttemptNotRegressingFromFinalized, assertAttemptOwnershipUnchanged, assertAttemptStateInternallyConsistent } from "./validation.js";

/**
 * The Phase 4B-1 persistence boundary for `@ipmat/attempt`. `save()`
 * performs a real multi-write sequence (upsert the `attempts` row, delete
 * its existing `attempt_events` rows, recreate them from `state.events`) —
 * unlike every Phase 5C-1 repository (each of which performs exactly one
 * write). This entire sequence, INCLUDING the preflight read that decides
 * whether ownership/finalization checks apply, runs inside ONE Prisma
 * interactive transaction at `Serializable` isolation (Phase 4B-1 review
 * finding — see docs/DECISIONS.md D-046's addendum):
 *
 * - Without the transaction at all, a crash between the delete and the
 *   recreate could leave an attempt with zero persisted events despite a
 *   real event history — the "partially written logical object" a
 *   transaction exists to prevent.
 * - Without `Serializable` isolation AND without the preflight read being
 *   INSIDE the same transaction, two concurrent `save()` calls for the
 *   same existing attempt could both read the SAME pre-write snapshot,
 *   both pass `assertAttemptNotRegressingFromFinalized()` against that
 *   stale snapshot, and then both commit — silently letting the
 *   last-committing write clobber the first (e.g., two concurrent
 *   `submitAttempt()` calls both finalizing "against" an `in_progress`
 *   snapshot that was already about to become stale). `Serializable`
 *   makes Postgres itself detect this as a genuine conflict and abort the
 *   losing transaction with a serialization-failure error, rather than
 *   silently applying a lost update — a real correctness property, not
 *   just documented as deferred, though (like every other piece of Prisma
 *   code in this codebase) it has never been exercised against a live
 *   database to confirm it empirically; it is correct by construction
 *   against documented Postgres/Prisma transaction semantics.
 */
export class PrismaAttemptRepository implements AttemptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(state: AttemptState): Promise<AttemptState> {
    assertAttemptStateInternallyConsistent(state);

    // Computed once, OUTSIDE the transaction — pure, deterministic, and
    // read-only w.r.t. the database, so there is nothing here a concurrent
    // transaction could race against.
    const timeline = getEventTimeline(state);

    await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.attempt.findUnique({ where: { id: state.id } });

        if (existing) {
          assertAttemptOwnershipUnchanged(
            {
              studentId: existing.studentId,
              questionId: existing.questionId,
              enrollmentId: existing.enrollmentId,
              retryOfAttemptId: existing.retryOfAttemptId
            },
            state
          );
          assertAttemptNotRegressingFromFinalized(existing.status, state.status);
        } else {
          await this.assertReferencesExist(tx, state);
        }

        await tx.attempt.upsert({
          where: { id: state.id },
          create: {
            id: state.id,
            studentId: state.studentId,
            questionId: state.questionId,
            enrollmentId: state.enrollmentId,
            retryOfAttemptId: state.retryOfAttemptId,
            status: state.status,
            startedAt: new Date(state.startedAt),
            submittedAt: state.submittedAt ? new Date(state.submittedAt) : null,
            finalizedAt: state.finalizedAt ? new Date(state.finalizedAt) : null,
            timeSpentSeconds: state.timeSpentSeconds,
            chosenAnswer: state.chosenAnswer,
            isCorrect: state.isCorrect,
            hintsUsed: state.hintsUsed,
            solutionOpenedAt: state.solutionOpenedAt ? new Date(state.solutionOpenedAt) : null
          },
          // retryOfAttemptId is deliberately NOT included here — it is
          // immutable once a row exists (validated above by
          // assertAttemptOwnershipUnchanged, which now checks it
          // alongside studentId/questionId/enrollmentId), so an update
          // never needs to, and never does, touch it.
          update: {
            status: state.status,
            submittedAt: state.submittedAt ? new Date(state.submittedAt) : null,
            finalizedAt: state.finalizedAt ? new Date(state.finalizedAt) : null,
            timeSpentSeconds: state.timeSpentSeconds,
            chosenAnswer: state.chosenAnswer,
            isCorrect: state.isCorrect,
            hintsUsed: state.hintsUsed,
            solutionOpenedAt: state.solutionOpenedAt ? new Date(state.solutionOpenedAt) : null
          }
        });

        await tx.attemptEvent.deleteMany({ where: { attemptId: state.id } });

        // Written with an explicit, write-order-preserving id
        // (`${attemptId}:${zero-padded index}`) instead of letting Prisma's
        // `@default(uuid())` assign a random one, specifically so
        // findById()'s read-back ordering has a fully deterministic
        // secondary sort key for events that share the EXACT same
        // `occurredAt` (the domain layer permits equal-but-never-decreasing
        // timestamps — see @ipmat/attempt's assertTimestampIsCoherent()).
        // `ORDER BY occurred_at ASC` alone is not guaranteed to preserve
        // insertion order for tied values; this closes that gap without a
        // schema change, rather than silently relying on unspecified
        // database tie-break behavior.
        for (let i = 0; i < timeline.length; i++) {
          const event = timeline[i];
          if (!event) continue;
          await tx.attemptEvent.create({
            data: {
              id: `${state.id}:${String(i).padStart(6, "0")}`,
              attemptId: state.id,
              eventType: event.type,
              occurredAt: new Date(event.occurredAt),
              payload: event.payload === null ? Prisma.DbNull : asJson(event.payload)
            }
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const saved = await this.findById(state.id);
    if (!saved) {
      throw new Error(`internal: Attempt "${state.id}" vanished immediately after being saved`);
    }
    return saved;
  }

  async findById(attemptId: string): Promise<AttemptState | null> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } }
    });
    return row ? toAttemptState(row) : null;
  }

  private async assertReferencesExist(tx: Prisma.TransactionClient, state: AttemptState): Promise<void> {
    const [student, question, enrollment] = await Promise.all([
      tx.student.findUnique({ where: { id: state.studentId } }),
      tx.question.findUnique({ where: { id: state.questionId } }),
      tx.enrollment.findUnique({ where: { id: state.enrollmentId } })
    ]);
    if (!student) throw new PersistenceError("missing_reference", `No Student found with id "${state.studentId}".`);
    if (!question) throw new PersistenceError("missing_reference", `No Question found with id "${state.questionId}".`);
    if (!enrollment) throw new PersistenceError("missing_reference", `No Enrollment found with id "${state.enrollmentId}".`);

    if (state.retryOfAttemptId) {
      const retryOf = await tx.attempt.findUnique({ where: { id: state.retryOfAttemptId } });
      if (!retryOf) {
        throw new PersistenceError("missing_reference", `No Attempt found with id "${state.retryOfAttemptId}" for retryOfAttemptId.`);
      }
    }
  }
}

function toAttemptState(row: {
  id: string;
  studentId: string;
  questionId: string;
  enrollmentId: string;
  retryOfAttemptId: string | null;
  status: string;
  startedAt: Date;
  submittedAt: Date | null;
  finalizedAt: Date | null;
  timeSpentSeconds: number | null;
  chosenAnswer: string | null;
  isCorrect: boolean | null;
  hintsUsed: number;
  solutionOpenedAt: Date | null;
  events: Array<{ eventType: string; occurredAt: Date; payload: unknown }>;
}): AttemptState {
  const events: AttemptEventRecord[] = row.events.map((event) => ({
    type: event.eventType as AttemptEventRecord["type"],
    occurredAt: event.occurredAt.toISOString(),
    payload: (event.payload as Record<string, unknown> | null) ?? null
  }));

  return {
    id: row.id,
    studentId: row.studentId,
    questionId: row.questionId,
    enrollmentId: row.enrollmentId,
    retryOfAttemptId: row.retryOfAttemptId,
    status: row.status as AttemptState["status"],
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    chosenAnswer: row.chosenAnswer,
    isCorrect: row.isCorrect,
    hintsUsed: row.hintsUsed,
    solutionOpenedAt: row.solutionOpenedAt ? row.solutionOpenedAt.toISOString() : null,
    timeSpentSeconds: row.timeSpentSeconds,
    events
  };
}
