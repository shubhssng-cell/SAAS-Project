import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_SELECTION_CONSTANTS,
  computeProgressionTargetTier,
  deriveAccumulatedEvidence,
  highestDemonstratedTier,
  selectNextQuestion,
  TRAINING_NEED_PRIORITY_ORDER,
  trailingIncorrectStreak,
  type AdaptiveSelectionResult
} from "../src/index.js";
import { STUDENT, computeMasteryFor, makeAttemptRecord, makeCandidate } from "./fixtures.js";

/**
 * Phase 3.2 -- ACCUMULATED evidence. The multi-attempt reasons (repeated_error, accuracy_weakness, speed_weakness, progression)
 * read the EXISTING mastery aggregates, recomputed from the persisted attempt records on every call; they share the ONE existing
 * minimum-observation rule. Everything asserted here is descriptive: counts, ratios, and which reasons a candidate satisfies.
 */

const MIN_OBS = MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT;

type Outcome = "w" | "c" | "cs" | "s"; // wrong, correct on pace, correct SLOW (2x expected), skipped

/** A chronological history on ONE concept: unique historical question ids, one shared family/cell so coverage is not the interesting reason. */
function history(outcomes: Outcome[], o: { tier?: "standard" | "advanced"; startOffset?: number; studentId?: string } = {}) {
  return outcomes.map((outcome, i) =>
    makeAttemptRecord({
      isCorrect: outcome === "s" ? null : outcome !== "w",
      status: outcome === "s" ? "skipped" : "submitted",
      timeTakenSeconds: outcome === "cs" ? 180 : 60,
      expectedTimeSeconds: 90,
      offsetSeconds: (o.startOffset ?? 0) + i * 100,
      questionId: `hist-${o.startOffset ?? 0}-${i}`,
      studentId: o.studentId,
      question: { patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-reverse-standard", difficultyTier: o.tier ?? "standard" }
    })
  );
}

// Candidates share the history's family/cell, so no coverage_gap/underexposure noise (history >= 3 attempts on that family).
const cand = (id: string, tier: "standard" | "advanced" = "standard", extra: Record<string, unknown> = {}) =>
  makeCandidate({ questionId: id, difficultyTier: tier, patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-reverse-standard", ...extra }, { expectedTimeSeconds: 90 });

function select(candidates: ReturnType<typeof makeCandidate>[], records: ReturnType<typeof makeAttemptRecord>[]): AdaptiveSelectionResult {
  const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [computeMasteryFor(records)], attemptRecords: records, candidates });
  if (outcome.status !== "selected") throw new Error(`expected a selection, got ${outcome.reason}`);
  return outcome.result;
}
const pool = () => [cand("Q-1"), cand("Q-2"), cand("Q-3", "advanced")];

describe("trailingIncorrectStreak -- the CURRENT run, not the longest ever", () => {
  it.each([
    [[], 0],
    [[true], 0],
    [[false], 1],
    [[true, false, false], 2],
    [[false, false, true], 0],
    [[false, false, true, false], 1],
    [[true, true, false, false, false], 3]
  ])("%j -> %i", (seq, expected) => {
    expect(trailingIncorrectStreak(seq as boolean[])).toBe(expected);
  });
});

describe("the minimum-observation rule is the EXISTING one (MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT)", () => {
  it("is 3, and adaptive-selection introduces no second minimum", () => {
    expect(MIN_OBS).toBe(3);
  });

  it("accuracy evidence is null (= no claim) below the minimum and measured at it: accuracy_weakness appears at exactly MIN_OBS graded attempts, not before", () => {
    const below = history(Array(MIN_OBS - 1).fill("w"));
    expect(computeMasteryFor(below).measures.accuracy).toBeNull();
    expect(select(pool(), below).allReasonsSatisfied).not.toContain("accuracy_weakness");

    const atMin = history(Array(MIN_OBS).fill("w"));
    expect(computeMasteryFor(atMin).measures.accuracy).toBe(0);
    expect(select(pool(), atMin).allReasonsSatisfied).toContain("accuracy_weakness");
  });

  it("speed evidence likewise: MIN_OBS - 1 slow answers make no speed claim; MIN_OBS do", () => {
    expect(select(pool(), history(Array(MIN_OBS - 1).fill("cs"))).allReasonsSatisfied).not.toContain("speed_weakness");
    expect(select(pool(), history(Array(MIN_OBS).fill("cs"))).allReasonsSatisfied).toContain("speed_weakness");
  });

  it("progression likewise: MIN_OBS - 1 correct answers on a tier demonstrate nothing; MIN_OBS do", () => {
    expect(highestDemonstratedTier(computeMasteryFor(history(Array(MIN_OBS - 1).fill("c"))))).toBeNull();
    expect(highestDemonstratedTier(computeMasteryFor(history(Array(MIN_OBS).fill("c"))))).toEqual({ tier: "standard", attempts: MIN_OBS, correct: MIN_OBS });
  });

  it("repeated_error is the one multi-attempt reason with its own, separate, EXISTING rule: 2 consecutive incorrect answers (REPEATED_ERROR_MIN_STREAK)", () => {
    expect(ADAPTIVE_SELECTION_CONSTANTS.REPEATED_ERROR_MIN_STREAK).toBe(2);
    expect(select(pool(), history(["w"])).allReasonsSatisfied).not.toContain("repeated_error");
    expect(select(pool(), history(["w", "w"])).allReasonsSatisfied).toContain("repeated_error");
  });
});

describe("CASE A -- an isolated error", () => {
  it("one incorrect answer reacts through the RECENT rule only: no accumulated reason, no durable concept-level weakness", () => {
    const records = history(["w"]);
    const result = select(pool(), records);
    expect(result.primaryReason).toBe("recent_incorrect");
    for (const accumulated of ["repeated_error", "accuracy_weakness", "speed_weakness", "prerequisite_weakness"] as const) {
      expect(result.allReasonsSatisfied).not.toContain(accumulated);
    }
    expect(computeMasteryFor(records).measures.accuracy).toBeNull();
    expect(result.accumulatedEvidence).toMatchObject({ gradedAttempts: 1, incorrectCount: 1, trailingIncorrectStreak: 1 });
  });
});

describe("CASE B -- repeated incorrect performance", () => {
  it("three incorrect answers: accumulated evidence outranks the one-attempt reaction, with the counts stated as facts", () => {
    const result = select(pool(), history(["w", "w", "w"]));
    expect(result.primaryReason).toBe("repeated_error");
    expect(result.allReasonsSatisfied).toEqual(expect.arrayContaining(["repeated_error", "accuracy_weakness", "recent_incorrect"]));
    expect(result.accumulatedEvidence).toMatchObject({ conceptName: "Percentages", gradedAttempts: 3, incorrectCount: 3, trailingIncorrectStreak: 3 });
    expect(result.explanation).toMatch(/most recent 3 graded answers on "Percentages" were all incorrect/);
  });

  it("it is more STABLE than the one-attempt reaction: one later correct answer does not erase it (accuracy evidence remains)", () => {
    const result = select(pool(), history(["w", "w", "w", "c"]));
    expect(result.primaryReason).toBe("accuracy_weakness"); // repeated_error ended (the current run is 0); the accumulated accuracy remains
    expect(result.explanation).toMatch(/3 of 4 graded answers/);
    expect(result.primaryReason).not.toBe("recent_correct_on_pace");
  });
});

describe("CASE C -- repeated slow performance (described as a time relationship, never a label)", () => {
  it("three correct-but-slow answers: speed evidence becomes actionable and states the observed ratio", () => {
    const result = select(pool(), history(["cs", "cs", "cs"]));
    expect(result.primaryReason).toBe("speed_weakness");
    expect(result.accumulatedEvidence).toMatchObject({ speedObservations: 3, gradedAttempts: 3, incorrectCount: 0 });
    expect(result.accumulatedEvidence?.meanSpeedRatio).toBeCloseTo(2, 5);
    expect(result.explanation).toMatch(/Across 3 timed attempts on "Percentages", answers took on average 2\.00x the expected time \(threshold 1\.3x\)/);
  });

  it("mixed timing does not qualify: the MEAN ratio must cross the existing threshold (slow, on-pace, on-pace)", () => {
    const result = select(pool(), history(["cs", "c", "c"]));
    expect(result.accumulatedEvidence!.meanSpeedRatio!).toBeLessThan(ADAPTIVE_SELECTION_CONSTANTS.SPEED_WEAKNESS_RATIO);
    expect(result.allReasonsSatisfied).not.toContain("speed_weakness");
  });
});

describe("CASE D -- repeated success supports progression only when the existing rule says so", () => {
  const std2 = () => cand("Q-std2", "standard");
  const adv = () => cand("Q-adv", "advanced");

  it("MIN_OBS correct on-pace answers on the standard tier make the ADVANCED tier the progression target, and the advanced question wins over basic repetition", () => {
    const records = history(Array(MIN_OBS).fill("c"));
    expect(computeProgressionTargetTier(computeMasteryFor(records))).toBe("advanced");
    const result = select([std2(), adv()], records);
    expect(result.primaryReason).toBe("difficulty_progression");
    expect(result.isFallback).toBe(false);
    expect(result.question.questionId).toBe("Q-adv");
    expect(result.accumulatedEvidence?.highestDemonstratedTier).toEqual({ tier: "standard", attempts: MIN_OBS, correct: MIN_OBS });
  });

  it("one fewer correct answer is not enough: the target stays 'standard' and the advanced question is NOT the progression pick", () => {
    const records = history(Array(MIN_OBS - 1).fill("c"));
    expect(computeProgressionTargetTier(computeMasteryFor(records))).toBe("standard");
    const result = select([std2(), adv()], records);
    expect(result.question.questionId).toBe("Q-std2"); // the standard question is the progression fit; the advanced one is not chosen
    expect(result.accumulatedEvidence?.highestDemonstratedTier).toBeNull();
  });

  it("there is no '100% mastery' shortcut: 2 of 3 correct (below the existing 0.8 tier threshold) does not progress", () => {
    const records = history(["c", "w", "c"]);
    expect(computeProgressionTargetTier(computeMasteryFor(records))).toBe("standard");
  });
});

describe("CASE E -- mixed results are not an exaggerated or permanent classification", () => {
  it("incorrect/correct/incorrect/correct: no repeated_error (the run never reaches 2); the existing accuracy threshold reports the observed proportion", () => {
    const result = select(pool(), history(["w", "c", "w", "c"]));
    expect(result.allReasonsSatisfied).not.toContain("repeated_error");
    expect(result.primaryReason).toBe("accuracy_weakness");
    expect(result.explanation).toMatch(/2 of 4 graded answers on "Percentages" were incorrect/);
  });

  it("it is not permanent: the same history followed by correct answers stops reporting it (recomputed from the history every time)", () => {
    const later = select(pool(), history(["w", "c", "w", "c", "c", "c", "c"])); // 5/7 correct ~ 0.71 >= 0.6
    expect(later.allReasonsSatisfied).not.toContain("accuracy_weakness");
    expect(select(pool(), history(["w", "c", "w", "c"]))).toEqual(select(pool(), history(["w", "c", "w", "c"]))); // and deterministic
  });

  it("two early misses followed by a long run of correct answers no longer mark the concept repeated_error (the longest-ever streak would have, forever)", () => {
    const records = history(["w", "w", "c", "c", "c", "c", "c", "c"]);
    expect(computeMasteryFor(records).detail.errorRecurrence.longestIncorrectStreak).toBe(2); // the all-time value still says 2...
    const result = select(pool(), records);
    expect(result.allReasonsSatisfied).not.toContain("repeated_error"); // ...but the current run is 0
    expect(result.allReasonsSatisfied).not.toContain("accuracy_weakness"); // 6/8 = 0.75
    expect(result.accumulatedEvidence?.trailingIncorrectStreak).toBe(0);
  });
});

describe("recent and accumulated evidence coexist without corrupting priority", () => {
  it("the fixed priority: multi-attempt measured reasons > recent problem reasons > coverage/exposure/gaps > progression > recent_correct_on_pace", () => {
    expect(TRAINING_NEED_PRIORITY_ORDER).toEqual([
      "repair_priority",
      "repeated_error",
      "prerequisite_weakness",
      "accuracy_weakness",
      "speed_weakness",
      "recent_incorrect",
      "recent_skip",
      "recent_slow",
      "coverage_gap",
      "underexposure",
      "pressure_gap",
      "novelty_gap",
      "difficulty_progression",
      "recent_correct_on_pace"
    ]);
  });

  it("three incorrect answers with the latest also incorrect: both signals are present, the accumulated one decides, the recent one stays visible", () => {
    const result = select(pool(), history(["w", "w", "w"]));
    expect(result.primaryReason).toBe("repeated_error");
    expect(result.allReasonsSatisfied).toContain("recent_incorrect");
    expect(result.recentEvidence?.signal).toBe("incorrect");
    expect(result.accumulatedEvidence?.trailingIncorrectStreak).toBe(3);
  });

  it("one recent failure does not overwrite a long successful history: five correct then one incorrect -> no accumulated weakness, the RECENT rule reacts", () => {
    const records = history(["c", "c", "c", "c", "c", "w"]);
    const result = select(pool(), records);
    expect(result.allReasonsSatisfied).not.toEqual(expect.arrayContaining(["repeated_error"]));
    expect(result.allReasonsSatisfied).not.toContain("accuracy_weakness"); // 5/6
    expect(result.primaryReason).toBe("recent_incorrect");
  });

  it("one recent success does not erase an accumulated pattern (three incorrect, then a correct answer on pace)", () => {
    const result = select(pool(), history(["w", "w", "w", "c"]));
    expect(result.recentEvidence?.signal).toBe("correct_on_pace");
    expect(["accuracy_weakness", "repeated_error"]).toContain(result.primaryReason);
    expect(result.primaryReason).not.toBe("recent_correct_on_pace");
  });
});

describe("safety, isolation and boundaries", () => {
  it("published-only and no-immediate-repeat hold inside an accumulated bucket", () => {
    const records = history(["w", "w", "w"]);
    const justAttempted = cand("hist-0-2"); // the id of the last attempted question
    const draft = makeCandidate({ questionId: "Q-draft", difficultyTier: "standard", patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-reverse-standard" }, { validationState: "ai_validated" });
    const result = select([justAttempted, draft, cand("Q-ok")], records);
    expect(result.primaryReason).toBe("repeated_error");
    expect(result.question.questionId).toBe("Q-ok");
    expect(result.excludedUnpublishedCount).toBe(1);
  });

  it("if the only published candidate is the just-attempted one it is still returned (a repeat beats nothing)", () => {
    expect(select([cand("hist-0-2")], history(["w", "w", "w"])).question.questionId).toBe("hist-0-2");
  });

  it("another student's history never contributes: three incorrect answers by someone else leave this student with no evidence", () => {
    const foreign = history(["w", "w", "w"], { studentId: "someone-else" });
    const result = select(pool(), foreign);
    expect(result.recentEvidence).toBeNull();
    expect(result.accumulatedEvidence).toBeNull();
    expect(result.primaryReason).not.toMatch(/repeated_error|accuracy_weakness|recent_/);
  });

  it("cold start fails safely: no evidence, still a valid published selection", () => {
    const result = select(pool(), []);
    expect(result.accumulatedEvidence).toBeNull();
    expect(pool().map((c) => c.question.questionId)).toContain(result.question.questionId);
  });

  it("deriveAccumulatedEvidence is descriptive only: counts and ratios, no label/score fields", () => {
    const evidence = deriveAccumulatedEvidence(computeMasteryFor(history(["w", "c", "cs"])))!;
    expect(Object.keys(evidence).sort()).toEqual(["conceptName", "gradedAttempts", "highestDemonstratedTier", "incorrectCount", "meanSpeedRatio", "speedObservations", "trailingIncorrectStreak"]);
    expect(deriveAccumulatedEvidence(undefined)).toBeNull();
  });

  it("every accumulated explanation states observations only (no inference about the student)", () => {
    const cases = [history(["w", "w", "w"]), history(["w", "c", "w", "c"]), history(["cs", "cs", "cs"])];
    for (const records of cases) {
      const explanation = select(pool(), records).explanation;
      expect(explanation).not.toMatch(/confiden|motivat|anxi|lazy|careless|weak(?!ness)|understand|intelligen|struggl|afraid|feel|slow student|bad at/i);
      expect(explanation).not.toMatch(/\bthis student\b/i);
    }
  });
});
