import type { QuestionContentReader, StudentQuestionRecord } from "./types.js";

/**
 * Test double for `QuestionContentReader`, seeded directly with
 * `StudentQuestionRecord`s. Shipped from this package's production `src/`
 * (the `InMemoryQuestionReader` precedent, docs/DECISIONS.md D-047).
 * `validationState` is not part of `StudentQuestionRecord` itself (it is
 * already implied by "this record was returned at all" — mirrors
 * `findPublishedById()`'s Prisma contract), so a seeded record is always
 * treated as published; a caller testing the "not published"/"not found"
 * case simply omits the id from the seed.
 */
export class InMemoryQuestionContentReader implements QuestionContentReader {
  private readonly byId = new Map<string, StudentQuestionRecord>();

  constructor(seed: StudentQuestionRecord[] = []) {
    for (const record of seed) {
      this.byId.set(record.id, record);
    }
  }

  async findPublishedById(questionId: string): Promise<StudentQuestionRecord | null> {
    return this.byId.get(questionId) ?? null;
  }
}
