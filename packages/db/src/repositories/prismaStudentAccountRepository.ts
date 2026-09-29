import type { PrismaClient } from "@prisma/client";
import { PersistenceError } from "./errors.js";
import type { StudentAccountPublicRecord, StudentAccountRecord, StudentAccountRepository } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of `StudentAccountRepository`.
 * `create()` relies on the schema's `students_email_key` unique index
 * (migration `0008_authentication_foundation`) to reject a duplicate email
 * atomically — never a separate check-then-insert, which would race under
 * concurrent signups for the same address.
 */
export class PrismaStudentAccountRepository implements StudentAccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { email: string; passwordHash: string; now: string }): Promise<StudentAccountPublicRecord> {
    try {
      const row = await this.prisma.student.create({
        data: { email: input.email, passwordHash: input.passwordHash, createdAt: new Date(input.now) },
        select: { id: true, email: true, createdAt: true, onboardingCompletedAt: true }
      });
      return toPublicRecord(row, input.email);
    } catch {
      // Prisma throws a driver-level unique-constraint error (P2002) here; this
      // repository never inspects the raw error's own message (which could
      // otherwise echo back a column/constraint name), matching D-050/D-049's
      // "typed error class, fail closed" discipline.
      throw new PersistenceError("invalid_record", "A student with this email already exists.");
    }
  }

  async findByEmailWithCredentials(email: string): Promise<StudentAccountRecord | null> {
    const row = await this.prisma.student.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, createdAt: true, onboardingCompletedAt: true }
    });
    if (!row || row.email === null || row.passwordHash === null) return null;
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, createdAt: row.createdAt.toISOString(), onboardingCompletedAt: row.onboardingCompletedAt ? row.onboardingCompletedAt.toISOString() : null };
  }

  async findById(studentId: string): Promise<StudentAccountPublicRecord | null> {
    const row = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, email: true, createdAt: true, onboardingCompletedAt: true }
    });
    if (!row || row.email === null) return null;
    return toPublicRecord(row, row.email);
  }

  /**
   * Idempotent via a conditional `updateMany` (`WHERE id = ? AND
   * onboarding_completed_at IS NULL`) -- a repeat call for an
   * already-onboarded student matches zero rows and writes nothing, then
   * this re-reads and returns the (unchanged, original) current record. No
   * read-check-write race window: the conditional WHERE clause is
   * evaluated atomically by the database itself, not by a separate
   * check-then-write from this code.
   */
  async completeOnboarding(studentId: string, now: string): Promise<StudentAccountPublicRecord> {
    await this.prisma.student.updateMany({
      where: { id: studentId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date(now) }
    });
    const row = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, email: true, createdAt: true, onboardingCompletedAt: true }
    });
    if (!row || row.email === null) {
      throw new PersistenceError("missing_reference", "No such student exists.");
    }
    return toPublicRecord(row, row.email);
  }
}

function toPublicRecord(row: { id: string; email: string | null; createdAt: Date; onboardingCompletedAt: Date | null }, fallbackEmail: string): StudentAccountPublicRecord {
  return { id: row.id, email: row.email ?? fallbackEmail, createdAt: row.createdAt.toISOString(), onboardingCompletedAt: row.onboardingCompletedAt ? row.onboardingCompletedAt.toISOString() : null };
}
