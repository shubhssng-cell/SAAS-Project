import { randomUUID } from "node:crypto";
import type { EnrollmentRepository, StudentEnrollmentRecord } from "./types.js";

/** Test double for `EnrollmentRepository` — an in-memory `Enrollment` table. */
export class InMemoryEnrollmentRepository implements EnrollmentRepository {
  private readonly byId = new Map<string, StudentEnrollmentRecord>();
  private readonly idByStudentAndExam = new Map<string, string>();

  private key(studentId: string, examId: string): string {
    return `${studentId}::${examId}`;
  }

  async create(input: { studentId: string; examId: string; now: string }): Promise<StudentEnrollmentRecord> {
    const key = this.key(input.studentId, input.examId);
    const existingId = this.idByStudentAndExam.get(key);
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (existing) return existing; // idempotent -- never moves enrolledAt, never duplicates.
    }
    const record: StudentEnrollmentRecord = { id: randomUUID(), studentId: input.studentId, examId: input.examId, enrolledAt: input.now };
    this.byId.set(record.id, record);
    this.idByStudentAndExam.set(key, record.id);
    return record;
  }

  async findByStudentAndExam(studentId: string, examId: string): Promise<StudentEnrollmentRecord | null> {
    const id = this.idByStudentAndExam.get(this.key(studentId, examId));
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }
}
