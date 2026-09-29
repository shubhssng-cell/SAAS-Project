import { describe, expect, it } from "vitest";
import { InMemoryEnrollmentRepository } from "../../src/repositories/inMemoryEnrollmentRepository.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";

describe("EnrollmentRepository (InMemory)", () => {
  it("creates an enrollment on first call", async () => {
    const repo = new InMemoryEnrollmentRepository();
    const created = await repo.create({ studentId: "student-1", examId: "exam-1", now: T0 });
    expect(created).toEqual({ id: created.id, studentId: "student-1", examId: "exam-1", enrolledAt: T0 });
  });

  it("is idempotent -- a repeat call for the same (studentId, examId) returns the SAME row, never moves enrolledAt", async () => {
    const repo = new InMemoryEnrollmentRepository();
    const first = await repo.create({ studentId: "student-1", examId: "exam-1", now: T0 });
    const second = await repo.create({ studentId: "student-1", examId: "exam-1", now: T1 });
    expect(second).toEqual(first);
    expect(second.enrolledAt).toBe(T0);
  });

  it("findByStudentAndExam returns null when no such enrollment exists", async () => {
    const repo = new InMemoryEnrollmentRepository();
    expect(await repo.findByStudentAndExam("student-1", "exam-1")).toBeNull();
  });

  it("findByStudentAndExam finds the created enrollment", async () => {
    const repo = new InMemoryEnrollmentRepository();
    const created = await repo.create({ studentId: "student-1", examId: "exam-1", now: T0 });
    expect(await repo.findByStudentAndExam("student-1", "exam-1")).toEqual(created);
  });

  it("the same student can have separate enrollments for different exams", async () => {
    const repo = new InMemoryEnrollmentRepository();
    const a = await repo.create({ studentId: "student-1", examId: "exam-a", now: T0 });
    const b = await repo.create({ studentId: "student-1", examId: "exam-b", now: T0 });
    expect(a.id).not.toBe(b.id);
    expect(await repo.findByStudentAndExam("student-1", "exam-a")).toEqual(a);
    expect(await repo.findByStudentAndExam("student-1", "exam-b")).toEqual(b);
  });

  it("different students each get their own enrollment for the same exam", async () => {
    const repo = new InMemoryEnrollmentRepository();
    const a = await repo.create({ studentId: "student-a", examId: "exam-1", now: T0 });
    const b = await repo.create({ studentId: "student-b", examId: "exam-1", now: T0 });
    expect(a.id).not.toBe(b.id);
  });
});
