import { runTrainingSystemProvider } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { PressureTrainingProvider } from "../src/provider.js";
import { makeCandidate, makeContext, makeQualifyingBlock } from "./fixtures.js";

const FORBIDDEN_PATTERNS = [
  /confirmed/i,
  /proven/i,
  /stress/i,
  /fatigu/i,
  /anxious/i,
  /confidence/i,
  /motivat/i,
  /emotion/i,
  /intelligen/i,
  /\bability\b/i,
  /predicted/i,
  /psycholog/i,
  /private reasoning/i
];

function collectStrings(value: unknown): string[] {
  const strings: string[] = [];
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") strings.push(item);
        }
      } else if (typeof v === "object" && v !== null) {
        strings.push(...collectStrings(v));
      }
    }
  }
  return strings;
}

function assertNoForbiddenLanguage(strings: string[]): void {
  for (const text of strings) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(text), `String "${text}" must not match ${pattern}`).toBe(false);
    }
  }
}

/**
 * Epistemic-boundary regression test (docs/DECISIONS.md D-005/D-034/D-038/
 * D-061): every string this provider produces must never imply stress,
 * fatigue, confidence, motivation, emotion, intelligence, ability,
 * prediction, or any private psychological state — only observable,
 * sequence-level behavior language ("short inter-attempt gaps were
 * observed," "within-block accuracy decreased," "active solving time
 * reached the configured block budget").
 */
describe("pressure-training -- epistemic language regression guard", () => {
  it("not_applicable (insufficient_evidence, no practiceBlocks) contains no forbidden language", () => {
    const outcome = runTrainingSystemProvider(new PressureTrainingProvider(), makeContext());
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("not_applicable (sufficient_blocks_no_pressure_detected) contains no forbidden language", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    const outcome = runTrainingSystemProvider(
      new PressureTrainingProvider(),
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block] })
    );
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("applicable + selected contains no forbidden language, and DOES contain accepted observational vocabulary", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    b3.block.interAttemptGapsSeconds = [3, 4];
    const candidate = makeCandidate({ conceptName: "Percentages" });
    const outcome = runTrainingSystemProvider(
      new PressureTrainingProvider(),
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block], candidates: [candidate] })
    );
    const strings = collectStrings(outcome);
    assertNoForbiddenLanguage(strings);
    expect(strings.some((s) => /short inter-attempt gaps were observed/i.test(s))).toBe(true);
  });

  it("applicable but no_eligible_question contains no forbidden language", () => {
    const b1 = makeQualifyingBlock("b1", 3, { startEpochMs: Date.parse("2026-01-01T00:00:00.000Z") });
    const b2 = makeQualifyingBlock("b2", 3, { startEpochMs: Date.parse("2026-01-02T00:00:00.000Z") });
    const b3 = makeQualifyingBlock("b3", 3, { startEpochMs: Date.parse("2026-01-03T00:00:00.000Z") });
    b3.block.interAttemptGapsSeconds = [3, 4];
    const wrongConceptCandidate = makeCandidate({ conceptName: "Ratio" });
    const outcome = runTrainingSystemProvider(
      new PressureTrainingProvider(),
      makeContext({ attemptRecords: [...b1.attempts, ...b2.attempts, ...b3.attempts], practiceBlocks: [b1.block, b2.block, b3.block], candidates: [wrongConceptCandidate] })
    );
    expect(outcome.status).toBe("no_eligible_question");
    assertNoForbiddenLanguage(collectStrings(outcome));
  });
});
