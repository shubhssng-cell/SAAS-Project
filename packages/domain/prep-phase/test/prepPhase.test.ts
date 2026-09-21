import { describe, expect, it } from "vitest";
import { applyCatchUp } from "../src/applyCatchUp.js";
import { computePrepPhase } from "../src/computePrepPhase.js";
import { ipmatPrepPhaseTemplate } from "../fixtures/ipmatTemplate.js";
import type { PrepPhaseInput } from "../src/types.js";

const TODAY = "2026-09-22";

describe("computePrepPhase — different enrollment dates produce different curves", () => {
  it("gives an early joiner and a late joiner different expected-coverage-at-enrollment and different enrolledLate status", () => {
    const earlyJoiner = computePrepPhase({
      examId: "ipmat-indore",
      enrollmentDate: "2026-05-01", // more than 210 days before the exam date -> before the curve even starts
      today: TODAY,
      template: ipmatPrepPhaseTemplate
    });

    const lateJoiner = computePrepPhase({
      examId: "ipmat-indore",
      enrollmentDate: "2026-12-01", // fewer than 210 days before the exam date -> the curve has already started
      today: TODAY,
      template: ipmatPrepPhaseTemplate
    });

    expect(earlyJoiner.daysToExamAtEnrollment).not.toBe(lateJoiner.daysToExamAtEnrollment);
    expect(earlyJoiner.expectedCoverageAtEnrollment).not.toEqual(lateJoiner.expectedCoverageAtEnrollment);
    expect(earlyJoiner.enrolledLate).toBe(false);
    expect(lateJoiner.enrolledLate).toBe(true);

    // Both joiners share the same "today", so the CURRENT calendar phase is
    // identical for both — what differs is how much they missed before they started.
    expect(earlyJoiner.expectedCoverageToday).toEqual(lateJoiner.expectedCoverageToday);
  });
});

describe("applyCatchUp — never mutates PrepPhaseTemplate", () => {
  it("returns an adjusted curve without changing the underlying template", () => {
    const templateSnapshotBefore = JSON.parse(JSON.stringify(ipmatPrepPhaseTemplate));
    const frozenTemplate = deepFreeze(structuredClone(ipmatPrepPhaseTemplate));

    const phase = computePrepPhase({
      examId: "ipmat-indore",
      enrollmentDate: "2026-12-01",
      today: TODAY,
      template: frozenTemplate
    });

    const result = applyCatchUp(phase, {
      studentId: "student-1",
      enrollmentId: "enrollment-1",
      priorityChapters: ["Percentages"],
      paceMultiplier: 1.5
    });

    // The template is frozen; if applyCatchUp (or computePrepPhase) tried to
    // write to it, this would throw in strict-mode ESM.
    expect(frozenTemplate).toEqual(templateSnapshotBefore);
    expect(ipmatPrepPhaseTemplate).toEqual(templateSnapshotBefore);

    expect(result.catchUpApplied).toBe(true);
    expect(result.adjustedCoverage).not.toBe(phase.expectedCoverageToday); // different reference
  });

  it("is a no-op pass-through when there is no catch-up plan", () => {
    const phase = computePrepPhase({
      examId: "ipmat-indore",
      enrollmentDate: "2026-06-01",
      today: TODAY,
      template: ipmatPrepPhaseTemplate
    });
    const result = applyCatchUp(phase, null);
    expect(result.catchUpApplied).toBe(false);
    expect(result.adjustedCoverage).toEqual(phase.expectedCoverageToday);
  });
});

describe("calendar phase and mastery are independent concepts", () => {
  it("computePrepPhase's result never includes a mastery-shaped field", () => {
    const phase = computePrepPhase({
      examId: "ipmat-indore",
      enrollmentDate: "2026-06-01",
      today: TODAY,
      template: ipmatPrepPhaseTemplate
    });
    const forbiddenKeys = ["accuracy", "masteryState", "confidence", "speedRatio", "pressurePerformance"];
    for (const key of forbiddenKeys) {
      expect(Object.keys(phase)).not.toContain(key);
    }
  });

  it("ignores mastery-shaped data smuggled into the input at the JS boundary", () => {
    // TypeScript's PrepPhaseInput type has no mastery field at all — that's
    // the primary enforcement. This test proves the *runtime* behavior is
    // also invariant, in case a caller bypasses the type system.
    const baseInput: PrepPhaseInput = {
      examId: "ipmat-indore",
      enrollmentDate: "2026-06-01",
      today: TODAY,
      template: ipmatPrepPhaseTemplate
    };

    const withLowMastery = { ...baseInput, masteryState: { accuracy: 0.05 } } as PrepPhaseInput;
    const withHighMastery = { ...baseInput, masteryState: { accuracy: 0.99 } } as PrepPhaseInput;

    expect(computePrepPhase(withLowMastery)).toEqual(computePrepPhase(withHighMastery));
  });
});

function deepFreeze<T>(value: T): T {
  Object.freeze(value);
  if (value && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      const prop = (value as Record<string, unknown>)[key];
      if (prop && typeof prop === "object" && !Object.isFrozen(prop)) {
        deepFreeze(prop);
      }
    }
  }
  return value;
}
