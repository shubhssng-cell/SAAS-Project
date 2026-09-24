import type { PrismaClient } from "@prisma/client";
import type { ConceptReader, ConceptRecord } from "./types.js";

/**
 * The ONE concrete, database-backed implementation of `ConceptReader`
 * (docs/project-memory/37_TRAINING_RECOMMENDATION.md §6). Read-only.
 * Resolves concepts through the persisted `Question.conceptId -> Concept`
 * relationship (`questionsPrimary` on `Concept`) — every returned id/name is
 * a real row, never an invented name.
 */
export class PrismaConceptReader implements ConceptReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findWithPublishedQuestionsByExamId(examId: string): Promise<ConceptRecord[]> {
    const rows = await this.prisma.concept.findMany({
      where: { questionsPrimary: { some: { examId, validationState: "published" } } },
      orderBy: { id: "asc" },
      select: { id: true, name: true, chapterId: true }
    });
    return rows.map((row) => ({ id: row.id, name: row.name, chapterId: row.chapterId }));
  }
}
