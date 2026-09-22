import type { PrismaClient } from "@prisma/client";
import type { CanonicalQuestion, QuestionReader } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of `QuestionReader`.
 * Read-only, by design: this codebase's non-goals (docs/MASTER_PLAN.md)
 * explicitly exclude question generation/publication from this phase —
 * this class never writes a `Question` row, only ever loads one by id so
 * an orchestration layer (`@ipmat/practice-loop`) can gate on its REAL
 * `validationState` and grade against its REAL `correctAnswer`, neither of
 * which a caller may supply directly (docs/DECISIONS.md D-048).
 */
export class PrismaQuestionReader implements QuestionReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(questionId: string): Promise<CanonicalQuestion | null> {
    const row = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!row) {
      return null;
    }

    const options = Array.isArray(row.options) && row.options.length > 0 ? row.options.map(String) : null;

    return {
      id: row.id,
      conceptId: row.conceptId,
      options,
      correctAnswer: row.correctAnswer,
      expectedTimeSeconds: row.expectedTimeSeconds,
      validationState: row.validationState
    };
  }
}
