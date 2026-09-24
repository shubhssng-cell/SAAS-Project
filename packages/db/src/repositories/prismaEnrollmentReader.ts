import type { PrismaClient } from "@prisma/client";
import type { EnrollmentReader, EnrollmentRecord } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of `EnrollmentReader`
 * (docs/project-memory/37_TRAINING_RECOMMENDATION.md §6). Read-only. This is
 * the ownership SOURCE for the Training Recommendation Composition layer —
 * it returns the persisted `studentId` as-is and never compares it against
 * anything itself; the caller performs (and fails closed on) that check.
 */
export class PrismaEnrollmentReader implements EnrollmentReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(enrollmentId: string): Promise<EnrollmentRecord | null> {
    const row = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, studentId: true, examId: true }
    });
    return row ? { id: row.id, studentId: row.studentId, examId: row.examId } : null;
  }
}
