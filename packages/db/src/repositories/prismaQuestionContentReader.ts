import type { PrismaClient } from "@prisma/client";
import type { QuestionContentReader, StudentQuestionRecord } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of
 * `QuestionContentReader` (docs/project-memory/70_API_AND_APPLICATION_LAYER.md).
 * Uses `select` (never `include`) so `correctAnswer`/`groundTruthDerivation`/
 * `solutionSteps` are never even loaded for this read — the same discipline
 * `PrismaTrainingQuestionReader` already established (D-020).
 */
export class PrismaQuestionContentReader implements QuestionContentReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findPublishedById(questionId: string): Promise<StudentQuestionRecord | null> {
    const row = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        validationState: true,
        body: true,
        options: true,
        expectedTimeSeconds: true,
        chapter: { select: { name: true } },
        concept: { select: { name: true } }
      }
    });
    if (!row || row.validationState !== "published") return null;

    const options = Array.isArray(row.options) && row.options.length > 0 ? row.options.map(String) : null;

    return {
      id: row.id,
      chapterName: row.chapter.name,
      conceptName: row.concept.name,
      prompt: row.body,
      answerFormat: options !== null ? "multiple_choice" : "numeric_entry",
      options,
      expectedTimeSeconds: row.expectedTimeSeconds
    };
  }
}
