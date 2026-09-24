import type { ConceptReader, ConceptRecord } from "./types.js";

/** Test double for `ConceptReader`, seeded with the concept records to return per exam id (ordered by id, matching `PrismaConceptReader`). */
export class InMemoryConceptReader implements ConceptReader {
  constructor(private readonly conceptsByExamId: ReadonlyMap<string, ConceptRecord[]> = new Map()) {}

  async findWithPublishedQuestionsByExamId(examId: string): Promise<ConceptRecord[]> {
    return [...(this.conceptsByExamId.get(examId) ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
