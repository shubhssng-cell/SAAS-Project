import type { ExamRecord, ExamReader } from "./types.js";

/** Test double for `ExamReader`, seeded directly with records. */
export class InMemoryExamReader implements ExamReader {
  private readonly byCode = new Map<string, ExamRecord>();

  constructor(seed: ExamRecord[] = []) {
    for (const exam of seed) {
      this.byCode.set(exam.code, exam);
    }
  }

  async findByCode(code: string): Promise<ExamRecord | null> {
    return this.byCode.get(code) ?? null;
  }
}
