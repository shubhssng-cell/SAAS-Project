import type { PrismaClient } from "@prisma/client";
import type { ExamRecord, ExamReader } from "./types.js";

/** The ONE concrete, database-backed implementation of `ExamReader`. Read-only. */
export class PrismaExamReader implements ExamReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCode(code: string): Promise<ExamRecord | null> {
    const row = await this.prisma.exam.findUnique({ where: { code }, select: { id: true, code: true, examDateRule: true } });
    return row ? { id: row.id, code: row.code, examDateRule: row.examDateRule } : null;
  }
}
