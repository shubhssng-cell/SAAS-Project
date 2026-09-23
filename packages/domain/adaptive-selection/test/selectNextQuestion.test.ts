import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RepairPlan } from "@ipmat/autopsy";
import { describe, expect, it } from "vitest";
import { determineSatisfiedReasons, buildTrainingNeedContext } from "../src/trainingNeeds.js";
import { selectNextQuestion } from "../src/selectNextQuestion.js";
import type { AdaptiveSelectionResult } from "../src/types.js";
import { CONCEPT, computeMasteryFor, makeAttemptRecord, makeCandidate, makeQuestion, STUDENT } from "./fixtures.js";

/** A candidate/attempt-history pair for "Ratios," constructed so that NOTHING fires for it — no weakness, no gap, no progression match — a clean control that never enters the bucketing at all. */
function healthyControl() {
  const cellId = "cell-ratios-healthy";
  const attempts = Array.from({ length: 5 }, (_, i) =>
    makeAttemptRecord({
      isCorrect: true,
      offsetSeconds: i * 60,
      question: { conceptName: "Ratios", patternFamilyName: "Basic Ratio", patternTaxonomyCellId: cellId, difficultyTier: "standard", noveltyLevel: "standard", testingModes: ["direct"] }
    })
  );
  const candidate = makeCandidate({
    conceptName: "Ratios",
    patternFamilyName: "Basic Ratio",
    patternTaxonomyCellId: cellId,
    difficultyTier: "standard",
    noveltyLevel: "standard",
    testingModes: ["direct"]
  });
  return { attempts, candidate, mastery: computeMasteryFor(attempts, "Ratios") };
}

function asSelected(result: ReturnType<typeof selectNextQuestion>): AdaptiveSelectionResult {
  if (result.status !== "selected") throw new Error(`Expected a selection, got ${result.status}`);
  return result.result;
}

describe("selectNextQuestion — 1. accuracy weakness causes relevant candidates to rise", () => {
  it("a candidate for a low-accuracy concept outranks a healthy, no-need candidate from another concept", () => {
    const cellId = "cell-percentages-accuracy-test";
    // Alternating correct/incorrect so accuracy is genuinely low WITHOUT also creating a
    // longestIncorrectStreak >= 2 -- isolating accuracy_weakness from repeated_error (see test 4
    // for the case where both legitimately fire together).
    const weakAttempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 60, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 120, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 180, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 240, question: { patternTaxonomyCellId: cellId } })
    ];
    const weakMastery = computeMasteryFor(weakAttempts);
    expect(weakMastery.measures.accuracy).toBeCloseTo(0.4);
    expect(weakMastery.detail.errorRecurrence.longestIncorrectStreak).toBe(1);

    const weakCandidate = makeCandidate({ patternTaxonomyCellId: cellId });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [weakMastery, healthyMastery],
      attemptRecords: [...weakAttempts, ...healthyAttempts],
      candidates: [weakCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(weakCandidate.question.questionId);
    expect(result.primaryReason).toBe("accuracy_weakness");
  });
});

describe("selectNextQuestion — 2. speed weakness causes relevant candidates to rise", () => {
  it("a candidate for a concept with slow mean speedRatio outranks a healthy candidate", () => {
    const cellId = "cell-percentages-speed-test";
    const slowAttempts = Array.from({ length: 3 }, (_, i) =>
      makeAttemptRecord({ isCorrect: true, timeTakenSeconds: 130, expectedTimeSeconds: 100, offsetSeconds: i * 60, question: { patternTaxonomyCellId: cellId } })
    );
    const slowMastery = computeMasteryFor(slowAttempts);
    expect(slowMastery.measures.speedRatio).toBeCloseTo(1.3);
    expect(slowMastery.measures.accuracy).toBe(1);

    const slowCandidate = makeCandidate({ patternTaxonomyCellId: cellId });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [slowMastery, healthyMastery],
      attemptRecords: [...slowAttempts, ...healthyAttempts],
      candidates: [slowCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(slowCandidate.question.questionId);
    expect(result.primaryReason).toBe("speed_weakness");
  });
});

describe("selectNextQuestion — 3. an under-covered taxonomy cell rises appropriately", () => {
  it("a never-attempted cell outranks a healthy candidate, even when the student's OVERALL accuracy on the concept is high", () => {
    const attemptedCellId = "cell-percentages-covered";
    const uncoveredCellId = "cell-percentages-uncovered";
    const goodAttempts = Array.from({ length: 5 }, (_, i) =>
      makeAttemptRecord({ isCorrect: true, offsetSeconds: i * 60, question: { patternTaxonomyCellId: attemptedCellId } })
    );
    const mastery = computeMasteryFor(goodAttempts);
    expect(mastery.measures.accuracy).toBe(1);
    expect(mastery.detail.coverage.taxonomyCellsEncountered).not.toContain(uncoveredCellId);

    const uncoveredCandidate = makeCandidate({ patternTaxonomyCellId: uncoveredCellId });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [mastery, healthyMastery],
      attemptRecords: [...goodAttempts, ...healthyAttempts],
      candidates: [uncoveredCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(uncoveredCandidate.question.questionId);
    expect(result.primaryReason).toBe("coverage_gap");
    expect(result.coverageGapAddressed).toContain("unattempted taxonomy cell");
  });
});

describe("selectNextQuestion — 4. a repeated-error area receives appropriate priority (and outranks accuracy_weakness alone)", () => {
  it("a concept with a longest-incorrect-streak >= threshold is tagged repeated_error, which outranks accuracy_weakness even though both fire", () => {
    const cellId = "cell-percentages-repeated-error";
    const badAttempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 60, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 120, question: { patternTaxonomyCellId: cellId } })
    ];
    const mastery = computeMasteryFor(badAttempts);
    expect(mastery.detail.errorRecurrence.longestIncorrectStreak).toBe(3);
    expect(mastery.measures.accuracy).toBe(0); // accuracy_weakness ALSO genuinely fires here

    const candidate = makeCandidate({ patternTaxonomyCellId: cellId });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [mastery, healthyMastery],
      attemptRecords: [...badAttempts, ...healthyAttempts],
      candidates: [candidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(candidate.question.questionId);
    expect(result.primaryReason).toBe("repeated_error");
    expect(result.allReasonsSatisfied).toContain("accuracy_weakness");
  });
});

describe("selectNextQuestion — 5. novelty training can be selected when observable state supports it", () => {
  it("insufficient exposure to non-standard novelty content (measure stays null, not weak) surfaces a novelty_gap candidate", () => {
    const novelCellId = "cell-percentages-novel";
    const paddingCellId = "cell-percentages-padding";
    const attempts = [
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 0, question: { patternTaxonomyCellId: novelCellId, noveltyLevel: "novel_representation" } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 60, question: { patternTaxonomyCellId: novelCellId, noveltyLevel: "novel_representation" } }),
      // Padding on a DIFFERENT cell, same family, standard novelty -- keeps the family well-exposed
      // (avoiding underexposure) without adding to the novelty-specific observation count.
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 120, question: { patternTaxonomyCellId: paddingCellId, noveltyLevel: "standard" } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 180, question: { patternTaxonomyCellId: paddingCellId, noveltyLevel: "standard" } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 240, question: { patternTaxonomyCellId: paddingCellId, noveltyLevel: "standard" } })
    ];
    const mastery = computeMasteryFor(attempts);
    expect(mastery.measures.noveltyHandling).toBeNull(); // insufficient observations, never a fake "weak" conclusion
    expect(mastery.measures.accuracy).toBe(1);

    const novelCandidate = makeCandidate({ patternTaxonomyCellId: novelCellId, noveltyLevel: "novel_representation" });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [mastery, healthyMastery],
      attemptRecords: [...attempts, ...healthyAttempts],
      candidates: [novelCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(novelCandidate.question.questionId);
    expect(result.primaryReason).toBe("novelty_gap");
  });
});

describe("selectNextQuestion — 6. pressure training can be selected when observable state supports it", () => {
  it("insufficient exposure to time-pressured content surfaces a pressure_gap candidate", () => {
    const pressureCellId = "cell-percentages-pressure";
    const paddingCellId = "cell-percentages-pressure-padding";
    const attempts = [
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 0, question: { patternTaxonomyCellId: pressureCellId, testingModes: ["time_pressured"] } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 60, question: { patternTaxonomyCellId: pressureCellId, testingModes: ["time_pressured"] } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 120, question: { patternTaxonomyCellId: paddingCellId, testingModes: ["direct"] } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 180, question: { patternTaxonomyCellId: paddingCellId, testingModes: ["direct"] } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 240, question: { patternTaxonomyCellId: paddingCellId, testingModes: ["direct"] } })
    ];
    const mastery = computeMasteryFor(attempts);
    expect(mastery.measures.pressurePerformance).toBeNull();

    const pressureCandidate = makeCandidate({ patternTaxonomyCellId: pressureCellId, testingModes: ["time_pressured"] });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [mastery, healthyMastery],
      attemptRecords: [...attempts, ...healthyAttempts],
      candidates: [pressureCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(pressureCandidate.question.questionId);
    expect(result.primaryReason).toBe("pressure_gap");
  });
});

describe("selectNextQuestion — 7. appropriate difficulty progression (not just 'harder is better')", () => {
  it("a mastered standard tier (high accuracy, sufficient observations) surfaces an advanced-tier candidate as the next step -- a genuine match, not the last-resort fallback", () => {
    const masteredCellId = "cell-percentages-mastered-standard";
    const targetCellId = "cell-percentages-progression-target";
    const attempts = [
      ...Array.from({ length: 5 }, (_, i) => makeAttemptRecord({ isCorrect: true, offsetSeconds: i * 60, question: { patternTaxonomyCellId: masteredCellId, difficultyTier: "standard" } })),
      // One prior touch on the target cell so it is not ALSO tagged coverage_gap -- isolating difficulty_progression as the reason under test.
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 600, question: { patternTaxonomyCellId: targetCellId, difficultyTier: "advanced" } })
    ];
    const mastery = computeMasteryFor(attempts);

    const progressionCandidate = makeCandidate({ patternTaxonomyCellId: targetCellId, difficultyTier: "advanced" });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [mastery, healthyMastery],
      attemptRecords: [...attempts, ...healthyAttempts],
      candidates: [progressionCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(progressionCandidate.question.questionId);
    expect(result.primaryReason).toBe("difficulty_progression");
    expect(result.isFallback).toBe(false); // a REAL match, not "nothing else fired for anyone"
  });
});

describe("selectNextQuestion — 8. overused/repeated candidates are deprioritized", () => {
  it("within the same winning bucket, the less-attempted candidate wins over one already attempted >= the overuse threshold", () => {
    const cellId = "cell-percentages-overuse-test";
    const overusedQuestionId = "question-overused";
    const attempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, questionId: overusedQuestionId, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 60, questionId: overusedQuestionId, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 120, question: { patternTaxonomyCellId: cellId } })
    ];
    const mastery = computeMasteryFor(attempts);
    expect(mastery.measures.accuracy).toBe(0);

    const overusedCandidate = makeCandidate({ patternTaxonomyCellId: cellId, questionId: overusedQuestionId });
    const freshCandidate = makeCandidate({ patternTaxonomyCellId: cellId, questionId: "question-fresh" });

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [mastery],
      attemptRecords: attempts,
      candidates: [overusedCandidate, freshCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(freshCandidate.question.questionId);
  });
});

describe("selectNextQuestion — 9. already well-covered basic material does not dominate merely because it is easy", () => {
  it("a fully-covered, high-accuracy, standard-tier candidate never wins over a candidate with a real, observable need", () => {
    const { attempts: healthyAttempts, candidate: masteredEasyCandidate, mastery: healthyMastery } = healthyControl();

    const cellId = "cell-percentages-real-need";
    const needAttempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 60, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 120, question: { patternTaxonomyCellId: cellId } })
    ];
    const needMastery = computeMasteryFor(needAttempts);
    const needCandidate = makeCandidate({ patternTaxonomyCellId: cellId });

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [needMastery, healthyMastery],
      attemptRecords: [...needAttempts, ...healthyAttempts],
      candidates: [masteredEasyCandidate, needCandidate]
    });

    const result = asSelected(outcome);
    expect(result.question.questionId).not.toBe(masteredEasyCandidate.question.questionId);
    expect(result.question.questionId).toBe(needCandidate.question.questionId);
  });
});

describe("selectNextQuestion — 10. malformed Question DNA is excluded, never silently repaired", () => {
  it("a candidate missing patternTaxonomyCellId is excluded; a valid sibling candidate still wins", () => {
    const malformed = makeCandidate({ patternTaxonomyCellId: "" });
    const valid = makeCandidate();

    const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [malformed, valid] });

    const result = asSelected(outcome);
    expect(result.question.questionId).toBe(valid.question.questionId);
    expect(result.excludedMalformedCount).toBe(1);
    expect(result.candidatesConsidered).toBe(2);
  });

  it("when EVERY candidate is malformed, the outcome is an explicit no_selection, never a guessed pick", () => {
    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [makeCandidate({ questionId: "" }), makeCandidate({ difficultyTier: undefined as never })]
    });

    expect(outcome.status).toBe("no_selection");
    if (outcome.status === "no_selection") {
      expect(outcome.reason).toBe("no_structurally_valid_candidates");
      expect(outcome.excludedMalformedCount).toBe(2);
    }
  });
});

describe("selectNextQuestion — 11. missing/nullable mastery dimensions do not produce fake conclusions", () => {
  it("determineSatisfiedReasons never tags accuracy_weakness/speed_weakness when the measure is null (insufficient observations)", () => {
    const cellId = "cell-percentages-insufficient-data";
    const attempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 60, question: { patternTaxonomyCellId: cellId } })
    ]; // only 2 -- below MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT (3)
    const mastery = computeMasteryFor(attempts);
    expect(mastery.measures.accuracy).toBeNull();
    expect(mastery.measures.speedRatio).toBeNull();

    const ctx = buildTrainingNeedContext({ studentId: STUDENT, masteryByConcept: [mastery], attemptRecords: attempts, activeRepairPlans: [] });
    const candidate = makeCandidate({ patternTaxonomyCellId: cellId });
    const reasons = determineSatisfiedReasons(candidate, ctx);

    expect(reasons).not.toContain("accuracy_weakness");
    expect(reasons).not.toContain("speed_weakness");
  });
});

describe("selectNextQuestion — 12. a no-attempt (cold-start) student gets sensible, deterministic behavior", () => {
  it("with zero attempt history, selection still succeeds deterministically (every cell is a coverage_gap, never a weakness claim)", () => {
    const candidateA = makeCandidate({ patternTaxonomyCellId: "cell-cold-a", questionId: "question-cold-a" });
    const candidateB = makeCandidate({ patternTaxonomyCellId: "cell-cold-b", questionId: "question-cold-b" });

    const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [candidateA, candidateB] });

    const result = asSelected(outcome);
    expect(result.primaryReason).toBe("coverage_gap");
    expect(result.allReasonsSatisfied).not.toContain("accuracy_weakness");
    expect(result.allReasonsSatisfied).not.toContain("speed_weakness");
    // Deterministic: re-running with the same input yields the identical winner.
    const again = asSelected(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [candidateA, candidateB] }));
    expect(again.question.questionId).toBe(result.question.questionId);
  });
});

describe("selectNextQuestion — 13. no eligible candidate returns an explicit no-selection result", () => {
  it("zero candidates supplied", () => {
    const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [] });
    expect(outcome).toEqual({ status: "no_selection", reason: "no_candidates_supplied", explanation: expect.any(String), candidatesConsidered: 0, excludedMalformedCount: 0 });
  });

  it("all candidates structurally valid but none published", () => {
    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [],
      attemptRecords: [],
      candidates: [makeCandidate({}, { validationState: "draft" }), makeCandidate({}, { validationState: "ai_validated" })]
    });
    expect(outcome.status).toBe("no_selection");
    if (outcome.status === "no_selection") expect(outcome.reason).toBe("no_published_candidates");
  });
});

describe("selectNextQuestion — 14. deterministic tie-breaking", () => {
  it("two candidates tied on every dimension resolve by lexicographically smaller questionId, reproducibly", () => {
    const cellId = "cell-percentages-tie";
    const candidateZ = makeCandidate({ patternTaxonomyCellId: cellId, questionId: "question-zzz" });
    const candidateA = makeCandidate({ patternTaxonomyCellId: cellId, questionId: "question-aaa" });

    const run = () => asSelected(selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [candidateZ, candidateA] }));

    const first = run();
    const second = run();
    expect(first.question.questionId).toBe("question-aaa");
    expect(second.question.questionId).toBe("question-aaa");
  });
});

describe("selectNextQuestion — 15. output reasons exactly match the signals that caused the ranking", () => {
  it("a candidate with two simultaneous, genuine signals reports BOTH in allReasonsSatisfied, with the higher-priority one as primaryReason", () => {
    const cellId = "cell-percentages-dual-signal";
    // Alternating correct/incorrect: low accuracy WITHOUT a longestIncorrectStreak >= 2
    // (isolating accuracy_weakness from repeated_error, which is exercised separately in test 4).
    const attempts = [
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 0, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 60, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 120, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: true, offsetSeconds: 180, question: { patternTaxonomyCellId: cellId } }),
      makeAttemptRecord({ isCorrect: false, offsetSeconds: 240, question: { patternTaxonomyCellId: cellId } })
    ];
    const mastery = computeMasteryFor(attempts);
    expect(mastery.detail.errorRecurrence.longestIncorrectStreak).toBe(1);

    // A DIFFERENT, never-attempted cell in the same concept, at an "advanced" tier -- also
    // coverage_gap, and deliberately NOT "standard" so it does not also collide with the
    // difficulty_progression fallback target (no tier is mastered here, so that target
    // defaults to "standard" -- see computeProgressionTargetTier()'s own doc comment).
    const candidate = makeCandidate({ patternTaxonomyCellId: "cell-percentages-dual-signal-2", difficultyTier: "advanced" });

    const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [mastery], attemptRecords: attempts, candidates: [candidate] });
    const result = asSelected(outcome);

    expect(result.allReasonsSatisfied.sort()).toEqual(["accuracy_weakness", "coverage_gap"].sort());
    expect(result.primaryReason).toBe("accuracy_weakness"); // higher priority than coverage_gap
  });
});

describe("selectNextQuestion — 16. targeted repair (5C-2) and global selection (5C-3) remain architecturally distinct", () => {
  it("this package never depends on @ipmat/repair-selection", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@ipmat/repair-selection");
  });

  it("a confirmed RepairPlan is consumed as ONE input signal (repair_priority), not a delegation -- no repair-selection call is involved, and the plan's target concept can differ from what actually wins globally", () => {
    const plan: RepairPlan = {
      targetConceptName: CONCEPT,
      targetPatternFamilyName: "Reverse Percentage",
      targetTaxonomyCellId: "cell-repair-target",
      targetErrorCategory: "trap",
      targetErrorTaxonomyCode: "base_confusion",
      recommendedTrainingMode: "standard_practice",
      priority: "high",
      rationale: ["confirmed by student"],
      prerequisites: [],
      confirmationSource: { attemptId: "attempt-x", hypothesisConfirmedAt: "2026-09-22T10:00:00.000Z" }
    };
    const repairCandidate = makeCandidate({ conceptName: CONCEPT, patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-repair-candidate" });
    const { attempts: healthyAttempts, candidate: healthyCandidate, mastery: healthyMastery } = healthyControl();

    const outcome = selectNextQuestion({
      studentId: STUDENT,
      masteryByConcept: [healthyMastery],
      attemptRecords: healthyAttempts,
      activeRepairPlans: [plan],
      candidates: [repairCandidate, healthyCandidate]
    });

    const result = asSelected(outcome);
    expect(result.primaryReason).toBe("repair_priority");
    expect(result.question.questionId).toBe(repairCandidate.question.questionId);
    // The winning candidate need not be, and here is not, the exact targetTaxonomyCellId --
    // proving this is a global rank over supplied candidates, not a re-invocation of 5C-2's
    // exact-cell matching logic.
    expect(result.question.patternTaxonomyCellId).not.toBe(plan.targetTaxonomyCellId);
  });
});

describe("selectNextQuestion — 17/18. no composite mastery score, no hidden psychological state", () => {
  it("AdaptiveSelectionResult carries no field resembling a single score, confidence, or psychological state", () => {
    const candidate = makeQuestion();
    const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [makeCandidate({ questionId: candidate.questionId })] });
    const result = asSelected(outcome);

    const forbidden = ["score", "overallMastery", "confidence", "motivation", "emotion", "intelligence", "predictedAbility", "anxiety"];
    for (const key of Object.keys(result)) {
      expect(forbidden.some((f) => key.toLowerCase().includes(f.toLowerCase()))).toBe(false);
    }
  });
});
