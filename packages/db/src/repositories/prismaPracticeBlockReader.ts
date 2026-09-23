import type { PrismaClient } from "@prisma/client";
import type { PracticeBlockOwnershipRecord, PracticeBlockReader } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of `PracticeBlockReader`
 * (docs/DECISIONS.md D-060) — mirrors `PrismaQuestionReader`'s exact role:
 * read-only, used only for `@ipmat/practice-loop`'s fast, non-transactional
 * ownership pre-check before calling into `startAttempt()`. Never the
 * authoritative check (that lives inside `AttemptRepository.save()`'s own
 * transaction, which re-derives the SAME chain from scratch and never
 * trusts this pre-check's result).
 *
 * `enrollmentId`/`studentId` are resolved by a real join through
 * `PracticeBlock -> PracticeSession -> Enrollment` — never columns stored
 * redundantly on `PracticeBlock` itself.
 */
export class PrismaPracticeBlockReader implements PracticeBlockReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(practiceBlockId: string): Promise<PracticeBlockOwnershipRecord | null> {
    const row = await this.prisma.practiceBlock.findUnique({
      where: { id: practiceBlockId },
      include: { practiceSession: { include: { enrollment: true } } }
    });
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      enrollmentId: row.practiceSession.enrollment.id,
      studentId: row.practiceSession.enrollment.studentId
    };
  }
}
