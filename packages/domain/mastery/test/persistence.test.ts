import { describe, expect, it } from "vitest";
import { computeMasteryState } from "../src/masteryState.js";
import { toMasteryStatePersistenceRecord } from "../src/persistence.js";
import { CONCEPT_ID, CONCEPT_NAME, percentagesTaxonomyCells, record, STUDENT_ID } from "../fixtures/attemptRecord.js";

const NOW = "2026-09-22T12:00:00.000Z";

describe("toMasteryStatePersistenceRecord — three-state model (Phase 5C-1, docs/DECISIONS.md D-043)", () => {
  it("returns null (writes nothing) when there are zero contributing attempts at all", () => {
    const result = computeMasteryState([], { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.detail.totalAttempts).toBe(0);
    expect(toMasteryStatePersistenceRecord(result)).toBeNull();
  });

  it("writes a row with per-dimension nulls once ANY attempts exist, even when every headline measure is still insufficient data", () => {
    const result = computeMasteryState([record(0, { isCorrect: true })], {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW
    });
    const persisted = toMasteryStatePersistenceRecord(result);
    expect(persisted).not.toBeNull();
    // 1 attempt is below MIN_OBSERVATIONS_FOR_COMPONENT (3) for every headline measure.
    expect(persisted?.accuracy).toBeNull();
    expect(persisted?.speedRatio).toBeNull();
    expect(persisted?.noveltyHandling).toBeNull();
    expect(persisted?.pressurePerformance).toBeNull();
    expect(persisted?.patternCoverage).toBeNull();
  });

  it("writes a mixed record: dimensions with enough data get a real number, dimensions without stay null on the SAME row", () => {
    const records = Array.from({ length: 5 }, (_, i) => record(i, { isCorrect: true, timeTakenSeconds: 60, expectedTimeSeconds: 90 }));
    const result = computeMasteryState(records, {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW,
      allTaxonomyCellsForConcept: percentagesTaxonomyCells
    });
    const persisted = toMasteryStatePersistenceRecord(result);
    expect(persisted).not.toBeNull();
    // accuracy/speedRatio/patternCoverage have >= 3 relevant observations here.
    expect(persisted?.accuracy).not.toBeNull();
    expect(persisted?.speedRatio).not.toBeNull();
    // noveltyHandling/pressurePerformance: no non-standard/pressure attempts were supplied.
    expect(persisted?.noveltyHandling).toBeNull();
    expect(persisted?.pressurePerformance).toBeNull();
  });

  it("a genuine 0% accuracy is written as the number 0, distinguishable from null (insufficient data)", () => {
    const records = Array.from({ length: 3 }, (_, i) => record(i, { isCorrect: false }));
    const result = computeMasteryState(records, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    expect(result.measures.accuracy).toBe(0);
    const persisted = toMasteryStatePersistenceRecord(result);
    expect(persisted?.accuracy).toBe(0);
    expect(persisted?.accuracy).not.toBeNull();
  });

  it("componentDetail is always included once any row is written, regardless of which headline measures are null", () => {
    const result = computeMasteryState([record(0, { isCorrect: true })], {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW
    });
    const persisted = toMasteryStatePersistenceRecord(result);
    expect(persisted?.componentDetail).toBeDefined();
    expect((persisted?.componentDetail as { totalAttempts: number }).totalAttempts).toBe(1);
  });
});
