import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PrismaQuestionReader } from "../../src/repositories/prismaQuestionReader.js";

/** `solution_steps` is a Json column: only a non-empty array of strings is a stored solution; anything else is "none", never coerced (Product Phase 2 Unit 3). */
function readerFor(solutionSteps: unknown): PrismaQuestionReader {
  const row = { id: "q1", conceptId: "c1", options: ["A", "B"], correctAnswer: "A", solutionSteps, expectedTimeSeconds: 60, validationState: "published" };
  return new PrismaQuestionReader({ question: { findUnique: async () => row } } as unknown as PrismaClient);
}

describe("PrismaQuestionReader -- solutionSteps mapping", () => {
  it("maps an array of strings", async () => {
    expect((await readerFor(["a", "b"]).findById("q1"))?.solutionSteps).toEqual(["a", "b"]);
  });

  it.each([[[]], [null], [{ steps: ["x"] }], [["ok", 3]], ["a string"]])("treats %j as no stored solution", async (value) => {
    expect((await readerFor(value).findById("q1"))?.solutionSteps).toBeNull();
  });
});
