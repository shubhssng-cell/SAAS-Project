import type { TrainingQuestionReader, TrainingQuestionRecord } from "./types.js";

/**
 * Test double for `TrainingQuestionReader`, seeded with already-mapped
 * records keyed by exam id. Mirrors `PrismaTrainingQuestionReader`'s
 * contract: only `published` records are returned, ordered by question id.
 * (Row-level DNA validation lives in the pure `toTrainingQuestionRecord()`,
 * tested directly — a seeded `TrainingQuestionRecord` is already well-typed.)
 */
export class InMemoryTrainingQuestionReader implements TrainingQuestionReader {
  constructor(private readonly recordsByExamId: ReadonlyMap<string, TrainingQuestionRecord[]> = new Map()) {}

  async findPublishedByExamId(examId: string): Promise<TrainingQuestionRecord[]> {
    return (this.recordsByExamId.get(examId) ?? [])
      .filter((record) => record.validationState === "published")
      .sort((a, b) => (a.question.questionId < b.question.questionId ? -1 : a.question.questionId > b.question.questionId ? 1 : 0));
  }
}
