import type { PrismaClient } from "@prisma/client";
import { toMasteryStatePersistenceRecord, type MasteryStateResult } from "@ipmat/mastery";
import { asJson } from "./json.js";
import type { MasteryStateRepository, StoredMasteryState } from "./types.js";
import { assertValidMasteryStateRecord } from "./validation.js";

/**
 * `save()` performs exactly one write (`masteryState.upsert`) — there is no
 * FK resolution step here at all (unlike Autopsy/RepairPlan), so there is
 * no multi-step write sequence that could leave a partially written row;
 * no transaction is needed here.
 */
export class PrismaMasteryStateRepository implements MasteryStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(result: MasteryStateResult): Promise<StoredMasteryState | null> {
    const record = toMasteryStatePersistenceRecord(result);
    if (record === null) {
      // Zero contributing attempts — nothing has been computed yet, so nothing is written.
      // See @ipmat/mastery/src/persistence.ts for the full three-state model.
      return null;
    }

    assertValidMasteryStateRecord(record);

    const row = await this.prisma.masteryState.upsert({
      where: { studentId_conceptId: { studentId: record.studentId, conceptId: record.conceptId } },
      create: {
        studentId: record.studentId,
        conceptId: record.conceptId,
        accuracy: record.accuracy,
        speedRatio: record.speedRatio,
        noveltyHandling: record.noveltyHandling,
        pressurePerformance: record.pressurePerformance,
        patternCoverage: record.patternCoverage,
        componentDetail: asJson(record.componentDetail),
        computedAt: new Date(record.computedAt)
      },
      update: {
        accuracy: record.accuracy,
        speedRatio: record.speedRatio,
        noveltyHandling: record.noveltyHandling,
        pressurePerformance: record.pressurePerformance,
        patternCoverage: record.patternCoverage,
        componentDetail: asJson(record.componentDetail),
        computedAt: new Date(record.computedAt)
      }
    });

    return toStoredMasteryState(row);
  }

  async findByStudentAndConcept(studentId: string, conceptId: string): Promise<StoredMasteryState | null> {
    const row = await this.prisma.masteryState.findUnique({ where: { studentId_conceptId: { studentId, conceptId } } });
    return row ? toStoredMasteryState(row) : null;
  }
}

function toStoredMasteryState(row: {
  id: string;
  studentId: string;
  conceptId: string;
  accuracy: number | null;
  speedRatio: number | null;
  noveltyHandling: number | null;
  pressurePerformance: number | null;
  patternCoverage: number | null;
  componentDetail: unknown;
  computedAt: Date;
}): StoredMasteryState {
  return {
    id: row.id,
    studentId: row.studentId,
    conceptId: row.conceptId,
    accuracy: row.accuracy,
    speedRatio: row.speedRatio,
    noveltyHandling: row.noveltyHandling,
    pressurePerformance: row.pressurePerformance,
    patternCoverage: row.patternCoverage,
    componentDetail: row.componentDetail as Record<string, unknown>,
    computedAt: row.computedAt.toISOString()
  };
}
