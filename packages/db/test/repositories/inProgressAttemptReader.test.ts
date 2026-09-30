import { startAttempt, type AttemptState } from "@ipmat/attempt";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { InMemoryAttemptRepository } from "../../src/repositories/inMemoryAttemptRepository.js";
import { PrismaAttemptRepository } from "../../src/repositories/prismaAttemptRepository.js";

/** Product Phase 2 Unit 5 -- `findInProgressByStudentQuestion` scoping and ordering. */

const at = (s: number) => new Date(Date.parse("2026-09-30T10:00:00.000Z") + s * 1000).toISOString();
const scope = { studentId: "s1", questionId: "q1", enrollmentId: "e1" };
const open = (id: string, startS: number, over: Partial<{ studentId: string; questionId: string; enrollmentId: string }> = {}): AttemptState =>
  startAttempt({ id, studentId: "s1", questionId: "q1", enrollmentId: "e1", now: at(startS), ...over });

describe("InMemoryAttemptRepository.findInProgressByStudentQuestion", () => {
  it("returns null when there is no attempt", async () => {
    expect(await new InMemoryAttemptRepository().findInProgressByStudentQuestion(scope)).toBeNull();
  });

  it("returns the open attempt for exactly this student + question + enrollment, and nothing else's", async () => {
    const repo = new InMemoryAttemptRepository();
    await repo.save(open("mine", 0));
    await repo.save(open("other-student", 1, { studentId: "s2" }));
    await repo.save(open("other-question", 2, { questionId: "q2" }));
    await repo.save(open("other-enrollment", 3, { enrollmentId: "e2" }));
    expect((await repo.findInProgressByStudentQuestion(scope))?.id).toBe("mine");
    expect(await repo.findInProgressByStudentQuestion({ ...scope, studentId: "s3" })).toBeNull();
  });

  it("ignores finalized attempts", async () => {
    const repo = new InMemoryAttemptRepository();
    await repo.save({ ...open("done", 0), status: "abandoned", finalizedAt: at(5), timeSpentSeconds: 5 });
    expect(await repo.findInProgressByStudentQuestion(scope)).toBeNull();
  });

  it("with several open, the newest startedAt wins; equal startedAt breaks ties by id DESC", async () => {
    const repo = new InMemoryAttemptRepository();
    await repo.save(open("a", 0));
    await repo.save(open("b", 30));
    await repo.save(open("c", 10));
    expect((await repo.findInProgressByStudentQuestion(scope))?.id).toBe("b");
    await repo.save(open("z", 30));
    expect((await repo.findInProgressByStudentQuestion(scope))?.id).toBe("z");
  });
});

describe("PrismaAttemptRepository.findInProgressByStudentQuestion (fake client -- no live database exists)", () => {
  it("queries scoped by student + question + enrollment + in_progress, newest first, and returns null for no row", async () => {
    let args: unknown;
    const prisma = {
      attempt: {
        findFirst: async (a: unknown) => {
          args = a;
          return null;
        }
      }
    } as unknown as PrismaClient;
    expect(await new PrismaAttemptRepository(prisma).findInProgressByStudentQuestion(scope)).toBeNull();
    expect(args).toMatchObject({
      where: { studentId: "s1", questionId: "q1", enrollmentId: "e1", status: "in_progress" },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }]
    });
  });
});
