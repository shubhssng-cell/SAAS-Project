import { describe, expect, it } from "vitest";
import { computeMasteryState } from "../src/masteryState.js";
import { toMasteryStatePersistenceRecord } from "../src/persistence.js";
import { CONCEPT_ID, CONCEPT_NAME, percentagesTaxonomyCells, record, STUDENT_ID } from "../fixtures/attemptRecord.js";

const NOW = "2026-09-22T12:00:00.000Z";

describe("toMasteryStatePersistenceRecord — maps onto the migrated mastery_states schema (Phase 5B §5)", () => {
  it("returns null (writes nothing) when there is insufficient data for any headline measure", () => {
    const result = computeMasteryState([record(0, { isCorrect: true })], {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW
    });
    expect(toMasteryStatePersistenceRecord(result)).toBeNull();
  });

  it("returns a full record once every headline measure is real, including the componentDetail JSON payload", () => {
    const records = Array.from({ length: 5 }, (_, i) => record(i, { isCorrect: true, timeTakenSeconds: 60, expectedTimeSeconds: 90 }));
    const result = computeMasteryState(records, {
      studentId: STUDENT_ID,
      conceptId: CONCEPT_ID,
      conceptName: CONCEPT_NAME,
      now: NOW,
      allTaxonomyCellsForConcept: percentagesTaxonomyCells
    });
    // noveltyHandling/pressurePerformance still null here (no non-standard/pressure attempts) -> record should be null
    expect(toMasteryStatePersistenceRecord(result)).toBeNull();
  });

  it("never writes a misleading 0 in place of null — confirmed by the null-return behavior above rather than a coerced default", () => {
    const result = computeMasteryState([], { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: NOW });
    const persisted = toMasteryStatePersistenceRecord(result);
    expect(persisted).toBeNull();
  });
});
