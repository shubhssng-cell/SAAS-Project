import { Prisma, type PrismaClient } from "@prisma/client";
import { decidePublication, type PublicationDecisionAction } from "@ipmat/question-engine";
import { PersistenceError } from "./errors.js";
import type { QuestionPublicationRecord, QuestionPublicationRepository } from "./types.js";

function toRecord(row: { id: string; validationState: QuestionPublicationRecord["validationState"]; difficultyTier: QuestionPublicationRecord["difficultyTier"]; provenanceId: string | null }): QuestionPublicationRecord {
  return {
    id: row.id,
    validationState: row.validationState,
    difficultyTier: row.difficultyTier,
    hasProvenance: row.provenanceId !== null
  };
}

/**
 * The ONE concrete, database-backed implementation of
 * `QuestionPublicationRepository`. `decide()` reads the current row and
 * writes the new `validationState` inside a Prisma interactive
 * transaction at `Serializable` isolation — the SAME fix, for the SAME
 * class of bug, `PrismaAttemptRepository` already applied (Phase 4B-1
 * review, D-046):
 *
 * - Without an explicit isolation level, Prisma/Postgres defaults to
 *   READ COMMITTED, under which a bare `findUnique` takes no row lock at
 *   all. Two concurrent `decide()` calls for the SAME question (e.g. one
 *   "publish", one "reject") could both read the same non-terminal
 *   `validationState`, both independently pass `decidePublication()`
 *   against that shared snapshot, and then both issue a blind
 *   `question.update({ where: { id } })` — whichever commits second would
 *   silently overwrite the first's already-committed terminal decision,
 *   because a plain `update()`'s `WHERE` clause only matches on `id`, not
 *   on the `validationState` it was actually read against. That is a
 *   genuine lost-update / terminal-state-reversal bug, not a hypothetical
 *   one — it exists regardless of caller authorization, since
 *   authorization and transactional correctness are orthogonal concerns.
 * - `Serializable` makes Postgres track the read (of `validationState`)
 *   against the write (of `validationState`) as a real dependency: if two
 *   concurrent `Serializable` transactions read-then-write the same row
 *   in a way that creates a cycle (this exact "read A, decide, write B"
 *   pattern on both sides — Postgres's canonical write-skew case), one of
 *   them is aborted with a serialization-failure error (SQLSTATE 40001)
 *   rather than silently applying a lost update. The invariant this
 *   protects — once `published` or `rejected`, no later concurrent
 *   decision may silently change it — holds for every combination
 *   (publish/publish, reject/reject, publish/reject, reject/publish):
 *   whichever transaction commits first wins; the other is guaranteed to
 *   abort, never to silently apply a stale decision on top.
 * - The existing DB-level CHECK constraint
 *   (`questions_published_requires_provenance`, migration `0001_init`)
 *   is a SEPARATE, narrower invariant (provenance presence) and does not
 *   by itself protect against this terminal-state race — it correctly
 *   remains as defense-in-depth for the provenance rule specifically
 *   (evaluated against the row's actual state at commit time, so it would
 *   still reject a publish based on stale `hasProvenance` data even if
 *   application logic somehow let one through), not a substitute for the
 *   isolation-level fix above.
 * - Like every other Prisma repository in this codebase, this has never
 *   been exercised against a live database (none has ever been reachable
 *   in this environment) — it is correct by construction against
 *   documented Postgres/Prisma transaction semantics, the same honest
 *   caveat `PrismaAttemptRepository` already states.
 */
export class PrismaQuestionPublicationRepository implements QuestionPublicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(questionId: string): Promise<QuestionPublicationRecord | null> {
    const row = await this.prisma.question.findUnique({ where: { id: questionId } });
    return row ? toRecord(row) : null;
  }

  async decide(questionId: string, action: PublicationDecisionAction): Promise<QuestionPublicationRecord> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.question.findUnique({ where: { id: questionId } });
        if (!row) {
          throw new PersistenceError("missing_reference", `No Question found with id "${questionId}".`);
        }

        const nextValidationState = decidePublication(action, {
          currentValidationState: row.validationState,
          difficultyTier: row.difficultyTier,
          hasProvenance: row.provenanceId !== null
        });

        const updated = await tx.question.update({ where: { id: questionId }, data: { validationState: nextValidationState } });
        return toRecord(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }
}
