import type { PrepPhaseTemplateReader, PrepPhaseTemplateRecord } from "./types.js";

/** Test double for `PrepPhaseTemplateReader`, seeded directly with records. */
export class InMemoryPrepPhaseTemplateReader implements PrepPhaseTemplateReader {
  private readonly byExamId = new Map<string, PrepPhaseTemplateRecord>();

  constructor(seed: PrepPhaseTemplateRecord[] = []) {
    for (const template of seed) {
      this.byExamId.set(template.examId, template);
    }
  }

  async findByExamId(examId: string): Promise<PrepPhaseTemplateRecord | null> {
    return this.byExamId.get(examId) ?? null;
  }
}
