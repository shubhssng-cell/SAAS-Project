import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { NoveltyTrainingProvider } from "../src/provider.js";
import { makeCandidate, makeExposureBatch, STUDENT } from "./fixtures.js";

const FORBIDDEN_PATTERNS = [/confirmed/i, /proven/i, /confus/i, /anxious/i, /confidence/i, /intelligen/i, /\bability\b/i, /predicted/i, /psycholog/i, /private reasoning/i];

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

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
 * Epistemic-boundary regression test (docs/DECISIONS.md D-058): every
 * string this provider produces must never imply confusion, anxiety,
 * confidence, intelligence, ability, prediction, or any private
 * psychological state -- only observable exposure-count language.
 */
describe("novelty-training -- epistemic language regression guard", () => {
  it("not_applicable (insufficient_evidence) contains no forbidden language", () => {
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context());
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("not_applicable (sufficient_novelty_exposure) contains no forbidden language", () => {
    const attemptRecords = [
      ...makeExposureBatch(3, { noveltyLevel: "standard" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_representation" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_combination" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_context" })
    ];
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context({ attemptRecords }));
    assertNoForbiddenLanguage(collectStrings(outcome));
  });

  it("applicable + selected contains no forbidden language, and DOES contain accepted exposure vocabulary", () => {
    const attemptRecords = makeExposureBatch(3, { noveltyLevel: "standard" });
    const candidate = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation" });
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context({ attemptRecords, candidates: [candidate] }));
    const strings = collectStrings(outcome);
    assertNoForbiddenLanguage(strings);
    expect(strings.some((s) => /limited prior exposure|underexposed|sufficient exposure/i.test(s))).toBe(true);
  });

  it("applicable but no_eligible_question contains no forbidden language", () => {
    // Force "novel_representation" to be the sole underexposed (target) dimension, then supply a
    // candidate for a DIFFERENT novelty level so it cannot match -- guarantees no_eligible_question.
    const attemptRecords = [
      ...makeExposureBatch(3, { noveltyLevel: "standard" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_combination" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_context" })
    ];
    const wrongLevelCandidate = makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_context" });
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), context({ attemptRecords, candidates: [wrongLevelCandidate] }));
    expect(outcome.status).toBe("no_eligible_question");
    assertNoForbiddenLanguage(collectStrings(outcome));
  });
});
