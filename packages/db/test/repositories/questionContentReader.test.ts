import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { InMemoryQuestionContentReader } from "../../src/repositories/inMemoryQuestionContentReader.js";
import { PrismaQuestionContentReader } from "../../src/repositories/prismaQuestionContentReader.js";

/**
 * `QuestionContentReader` — the student-facing question DISPLAY content
 * (docs/project-memory/70_API_AND_APPLICATION_LAYER.md). Prisma-backed
 * class verified at the code level against a fake `PrismaClient` — no
 * live database has ever been reachable in this environment.
 */
describe("PrismaQuestionContentReader (query shape, no live database)", () => {
  it("selects only display fields, never an answer-bearing column, and derives answerFormat from options presence", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "q-1",
      validationState: "published",
      body: "What is 20% of 480?",
      options: ["96", "120", "80", "48"],
      expectedTimeSeconds: 90,
      chapter: { name: "Percentages" },
      concept: { name: "Percentages" }
    });
    const reader = new PrismaQuestionContentReader({ question: { findUnique } } as unknown as PrismaClient);

    const record = await reader.findPublishedById("q-1");

    expect(record).toEqual({
      id: "q-1",
      chapterName: "Percentages",
      conceptName: "Percentages",
      prompt: "What is 20% of 480?",
      answerFormat: "multiple_choice",
      options: ["96", "120", "80", "48"],
      expectedTimeSeconds: 90
    });

    const query = findUnique.mock.calls[0]?.[0] as { where: unknown; select: Record<string, unknown>; include?: unknown };
    expect(query.where).toEqual({ id: "q-1" });
    expect(query.include).toBeUndefined();
    for (const forbidden of ["correctAnswer", "groundTruthDerivation", "solutionSteps"]) {
      expect(query.select).not.toHaveProperty(forbidden);
    }
  });

  it("derives numeric_entry when options is empty/absent", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "q-2",
      validationState: "published",
      body: "Find the value.",
      options: [],
      expectedTimeSeconds: 60,
      chapter: { name: "Percentages" },
      concept: { name: "Percentages" }
    });
    const reader = new PrismaQuestionContentReader({ question: { findUnique } } as unknown as PrismaClient);
    const record = await reader.findPublishedById("q-2");
    expect(record?.answerFormat).toBe("numeric_entry");
    expect(record?.options).toBeNull();
  });

  it("returns null when the question does not exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const reader = new PrismaQuestionContentReader({ question: { findUnique } } as unknown as PrismaClient);
    expect(await reader.findPublishedById("missing")).toBeNull();
  });

  it("returns null when the question is not published, even though it exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "q-3",
      validationState: "draft",
      body: "Not yet published.",
      options: [],
      expectedTimeSeconds: 60,
      chapter: { name: "Percentages" },
      concept: { name: "Percentages" }
    });
    const reader = new PrismaQuestionContentReader({ question: { findUnique } } as unknown as PrismaClient);
    expect(await reader.findPublishedById("q-3")).toBeNull();
  });
});

describe("InMemoryQuestionContentReader", () => {
  it("returns a seeded record by id, null otherwise", async () => {
    const reader = new InMemoryQuestionContentReader([
      { id: "q-1", chapterName: "Percentages", conceptName: "Percentages", prompt: "Find 20% of 480.", answerFormat: "numeric_entry", options: null, expectedTimeSeconds: 90 }
    ]);
    expect(await reader.findPublishedById("q-1")).toMatchObject({ id: "q-1", prompt: "Find 20% of 480." });
    expect(await reader.findPublishedById("q-2")).toBeNull();
  });
});
