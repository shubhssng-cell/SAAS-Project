import type { PrismaClient } from "@prisma/client";
import type { EnrollmentRepository, StudentEnrollmentRecord } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of `EnrollmentRepository`.
 * `create()` uses Prisma's `upsert` against the schema's own
 * `students_exam_id_key`-equivalent unique constraint (`@@unique([studentId, examId])`,
 * migration `0001_init`) with an EMPTY `update` — a clean, atomic
 * "create if not exists, else return the existing row unchanged" with no
 * read-check-write race window, the same idempotency shape
 * `PrismaStudentAccountRepository.completeOnboarding()` achieves via a
 * conditional `updateMany`.
 */
export class PrismaEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { studentId: string; examId: string; now: string }): Promise<StudentEnrollmentRecord> {
    const row = await this.prisma.enrollment.upsert({
      where: { studentId_examId: { studentId: input.studentId, examId: input.examId } },
      update: {},
      create: { studentId: input.studentId, examId: input.examId, enrolledAt: new Date(input.now) }
    });
    return toRecord(row);
  }

  async findByStudentAndExam(studentId: string, examId: string): Promise<StudentEnrollmentRecord | null> {
    const row = await this.prisma.enrollment.findUnique({ where: { studentId_examId: { studentId, examId } } });
    return row ? toRecord(row) : null;
  }
}

function toRecord(row: { id: string; studentId: string; examId: string; enrolledAt: Date }): StudentEnrollmentRecord {
  return { id: row.id, studentId: row.studentId, examId: row.examId, enrolledAt: row.enrolledAt.toISOString() };
}
