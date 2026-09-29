import type { PhaseCurvePoint } from "@ipmat/prep-phase";
import type { PrismaClient } from "@prisma/client";
import type { PrepPhaseTemplateReader, PrepPhaseTemplateRecord } from "./types.js";

/** The ONE concrete, database-backed implementation of `PrepPhaseTemplateReader`. Read-only. */
export class PrismaPrepPhaseTemplateReader implements PrepPhaseTemplateReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findByExamId(examId: string): Promise<PrepPhaseTemplateRecord | null> {
    const row = await this.prisma.prepPhaseTemplate.findUnique({ where: { examId }, select: { examId: true, phaseCurve: true } });
    if (!row) return null;
    return { examId: row.examId, phaseCurve: toPhaseCurve(row.phaseCurve) };
  }
}

/** Defensive read of untyped persisted JSON — never trusted to already be the right shape (the same discipline `@ipmat/auth-api`'s `toPendingAutopsyView()` already applies to `evidenceUsed`). A malformed/empty stored curve becomes an empty array here; `computePrepPhase()`'s own `selectPhasePoint()` already throws on an empty curve, so this never silently produces a fabricated phase. */
function toPhaseCurve(value: unknown): PhaseCurvePoint[] {
  if (!Array.isArray(value)) return [];
  const points: PhaseCurvePoint[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { daysToExam, expectedCoverage } = entry as Record<string, unknown>;
    if (typeof daysToExam !== "number" || typeof expectedCoverage !== "object" || expectedCoverage === null) continue;
    points.push({ daysToExam, expectedCoverage: expectedCoverage as Record<string, number> });
  }
  return points;
}
