import { describe, expect, it } from "vitest";
import {
  classifyTrend,
  compareAttemptsChronologically,
  deriveTrendEvidence,
  selectNextQuestion,
  TREND_CONSTANTS,
  TREND_KINDS,
  TRAINING_NEED_PRIORITY_ORDER,
  type AdaptiveSelectionResult
} from "../src/index.js";
import { STUDENT, computeMasteryFor, makeAttemptRecord, makeCandidate } from "./fixtures.js";

/**
 * Phase 3.3 -- TREND evidence: the last 3 graded answers on a concept vs. the graded answers before them. Descriptive counts and runs only;
 * these tests pin the window/threshold boundaries, the order/skip/tie rules, and how trend interacts with recent + accumulated evidence.
 */

type Outcome = "w" | "c" | "s"; // wrong, correct, skipped

function history(outcomes: Outcome[], o: { studentId?: string; concept?: string; tier?: "standard" | "advanced"; startOffset?: number } = {}) {
  return outcomes.map((outcome, i) =>
    makeAttemptRecord({
      isCorrect: outcome === "s" ? null : outcome === "c",
      status: outcome === "s" ? "skipped" : "submitted",
      offsetSeconds: (o.startOffset ?? 0) + i * 100,
      questionId: `th-${o.startOffset ?? 0}-${o.studentId ?? "me"}-${i}`,
      studentId: o.studentId,
      question: { conceptName: o.concept ?? "Percentages", patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-reverse-standard", difficultyTier: o.tier ?? "standard" }
    })
  );
}
const cand = (id: string, tier: "standard" | "advanced" = "standard") =>
  makeCandidate({ questionId: id, difficultyTier: tier, patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-reverse-standard" }, { expectedTimeSeconds: 90 });
const pool = () => [cand("Q-1"), cand("Q-2"), cand("Q-adv", "advanced")];

function select(candidates: ReturnType<typeof cand>[], records: ReturnType<typeof history>): AdaptiveSelectionResult {
  const outcome = selectNextQuestion({ studentId: STUDENT, masteryByConcept: [computeMasteryFor(records)], attemptRecords: records, candidates });
  if (outcome.status !== "selected") throw new Error(`expected a selection, got ${outcome.reason}`);
  return outcome.result;
}
const kindOf = (outcomes: Outcome[]) => deriveTrendEvidence(STUDENT, "Percentages", history(outcomes))?.kind ?? null;

describe("the window and classification rules (boundaries)", () => {
  it("fixed, centralized constants", () => {
    expect(TREND_CONSTANTS).toEqual({ TREND_RECENT_WINDOW: 3, TREND_MIN_EARLIER_OBSERVATIONS: 1, TREND_MIN_EARLIER_FOR_CHANGE: 2 });
    expect(TREND_KINDS).toEqual(["improving", "deteriorating", "persistent_difficulty", "sustained_success"]);
  });

  it("cold start and insufficient history make no trend claim", () => {
    expect(deriveTrendEvidence(STUDENT, "Percentages", [])).toBeNull();
    expect(kindOf(["c"])).toBeNull();
    expect(kindOf(["c", "c", "c"])).toBeNull(); // a window but nothing earlier to compare with
    expect(kindOf(["w", "w", "w"])).toBeNull();
    expect(kindOf(["c", "c"])).toBeNull();
  });

  it("CASE A improvement: wrong wrong correct correct correct", () => {
    const t = deriveTrendEvidence(STUDENT, "Percentages", history(["w", "w", "c", "c", "c"]))!;
    expect(t).toMatchObject({ kind: "improving", recentCorrect: 3, recentIncorrect: 0, earlierGraded: 2, earlierCorrect: 0 });
  });

  it("CASE B deterioration: correct correct correct wrong wrong", () => {
    const t = deriveTrendEvidence(STUDENT, "Percentages", history(["c", "c", "c", "w", "w"]))!;
    expect(t).toMatchObject({ kind: "deteriorating", recentCorrect: 1, earlierGraded: 2, earlierCorrect: 2 });
    expect(t.currentStreak).toEqual({ outcome: "incorrect", length: 2 });
    expect(t.previousStreak).toEqual({ outcome: "correct", length: 3 });
  });

  it("CASE C persistent difficulty: wrong wrong correct wrong wrong -- one success does not undo it", () => {
    expect(kindOf(["w", "w", "c", "w", "w"])).toBe("persistent_difficulty");
  });

  it("CASE D sustained success: four correct in a row (a run, not a one-off)", () => {
    expect(kindOf(["c", "c", "c", "c"])).toBe("sustained_success");
    expect(kindOf(["c", "c", "w", "c", "c", "c"])).toBe("sustained_success"); // earlier 2/3 is not poor, so this is a run, not a recovery
  });

  it("CASE E old failure, current recovery: wrong x3 then correct x3 is improving, and the old facts are preserved", () => {
    const t = deriveTrendEvidence(STUDENT, "Percentages", history(["w", "w", "w", "c", "c", "c"]))!;
    expect(t.kind).toBe("improving");
    expect(t.earlierCorrect).toBe(0);
    expect(t.earlierGraded).toBe(3);
    expect(t.previousStreak).toEqual({ outcome: "incorrect", length: 3 });
  });

  it("classifyTrend boundaries: earlier 0.6 is not 'poor'; 0.8 is 'strong'; 2 of 3 recent is not a full recovery", () => {
    expect(classifyTrend({ correct: 3, total: 3 }, { correct: 3, total: 5 })).toBe("sustained_success"); // earlier exactly 0.6 is not < 0.6
    expect(classifyTrend({ correct: 3, total: 3 }, { correct: 2, total: 5 })).toBe("improving");
    expect(classifyTrend({ correct: 2, total: 3 }, { correct: 0, total: 4 })).toBeNull(); // a temporary success is not recovery, 0.67 is not persistent
    expect(classifyTrend({ correct: 1, total: 3 }, { correct: 4, total: 5 })).toBe("deteriorating"); // earlier exactly 0.8 is strong
    expect(classifyTrend({ correct: 1, total: 3 }, { correct: 3, total: 5 })).toBeNull(); // earlier 0.6 is not strong
    expect(classifyTrend({ correct: 2, total: 3 }, { correct: 5, total: 5 })).toBeNull(); // recent 0.67 is not below 0.6
    expect(classifyTrend({ correct: 3, total: 3 }, { correct: 0, total: 1 })).toBe("sustained_success"); // one earlier point supports no CHANGE claim
    expect(classifyTrend({ correct: 0, total: 3 }, { correct: 1, total: 1 })).toBeNull();
    expect(classifyTrend({ correct: 2, total: 2 }, { correct: 0, total: 5 })).toBeNull(); // the recent window must be full
  });

  it("the evidence is descriptive only: counts and runs, no label or score fields", () => {
    expect(Object.keys(deriveTrendEvidence(STUDENT, "Percentages", history(["w", "c", "c", "c"]))!).sort()).toEqual([
      "conceptName",
      "currentStreak",
      "earlierCorrect",
      "earlierGraded",
      "gradedAttempts",
      "kind",
      "lastGradedTier",
      "previousStreak",
      "recentCorrect",
      "recentIncorrect",
      "recentWindowSize"
    ]);
  });
});

describe("streak semantics: CURRENT run, graded attempts only", () => {
  it("currentStreak is the trailing run, not the longest ever; previousStreak is the run before it", () => {
    const t = deriveTrendEvidence(STUDENT, "Percentages", history(["w", "w", "w", "w", "c", "c"]))!;
    expect(t.currentStreak).toEqual({ outcome: "correct", length: 2 }); // the longest-ever run (4 incorrect) does not stand in for current state
    expect(t.previousStreak).toEqual({ outcome: "incorrect", length: 4 });
  });

  it("an all-same history has no previous streak", () => {
    expect(deriveTrendEvidence(STUDENT, "Percentages", history(["c", "c", "c", "c"]))!.previousStreak).toBeNull();
  });

  it("skipped attempts are not graded: they neither join the window nor break a streak", () => {
    const withSkips = deriveTrendEvidence(STUDENT, "Percentages", history(["w", "w", "s", "c", "s", "c", "s", "c"]))!;
    expect(withSkips).toMatchObject({ kind: "improving", gradedAttempts: 5, currentStreak: { outcome: "correct", length: 3 } });
    expect(withSkips.kind).toBe(deriveTrendEvidence(STUDENT, "Percentages", history(["w", "w", "c", "c", "c"]))!.kind);
  });

  it("abandoned attempts are ignored as well", () => {
    const records = [...history(["w", "w", "c", "c"]), makeAttemptRecord({ isCorrect: null, status: "abandoned", offsetSeconds: 350 }), ...history(["c"], { startOffset: 1000 })];
    expect(deriveTrendEvidence(STUDENT, "Percentages", records)!.gradedAttempts).toBe(5);
  });
});

describe("ordering is total and deterministic", () => {
  it("order is finalizedAt ascending regardless of input order", () => {
    const records = history(["w", "w", "c", "c", "c"]);
    const shuffled = [records[3]!, records[0]!, records[4]!, records[2]!, records[1]!];
    expect(deriveTrendEvidence(STUDENT, "Percentages", shuffled)).toEqual(deriveTrendEvidence(STUDENT, "Percentages", records));
  });

  it("equal timestamps tie-break by attemptId, so either input order yields the same evidence -- and the same order mastery uses", () => {
    const a = makeAttemptRecord({ isCorrect: false, offsetSeconds: 500, questionId: "tie-a" });
    const b = makeAttemptRecord({ isCorrect: true, offsetSeconds: 500, questionId: "tie-b" });
    expect(a.contribution.finalizedAt).toBe(b.contribution.finalizedAt);
    const base = history(["c", "c", "c"], { startOffset: -1000 });
    expect(deriveTrendEvidence(STUDENT, "Percentages", [...base, a, b])).toEqual(deriveTrendEvidence(STUDENT, "Percentages", [...base, b, a]));
    expect([b, a].sort(compareAttemptsChronologically)[0]).toBe(a); // fixture attempt ids are allocated in increasing order
    expect(computeMasteryFor([...base, a, b]).detail.accuracyStability.sequence).toEqual(computeMasteryFor([...base, b, a]).detail.accuracyStability.sequence);
  });
});

describe("isolation", () => {
  it("another student's attempts and another concept's attempts never contribute", () => {
    const foreign = history(["w", "w", "c", "c", "c"], { studentId: "someone-else" });
    const otherConcept = history(["w", "w", "c", "c", "c"], { concept: "Ratio" });
    expect(deriveTrendEvidence(STUDENT, "Percentages", [...foreign, ...otherConcept])).toBeNull();
    expect(deriveTrendEvidence(STUDENT, "Ratio", [...foreign, ...otherConcept])?.kind).toBe("improving");
  });
});

describe("selection: recent vs accumulated vs trend, with an explicit priority", () => {
  it("the new reasons sit at fixed, documented positions", () => {
    const o = TRAINING_NEED_PRIORITY_ORDER;
    expect(o.indexOf("repeated_error")).toBeLessThan(o.indexOf("recent_deterioration"));
    expect(o.indexOf("recent_deterioration")).toBeLessThan(o.indexOf("accuracy_weakness"));
    expect(o.indexOf("speed_weakness")).toBeLessThan(o.indexOf("recent_improvement"));
    expect(o.indexOf("recent_improvement")).toBeLessThan(o.indexOf("recent_incorrect"));
  });

  it("improvement: an old poor run followed by 3 correct answers stops reporting accuracy_weakness (mean 0.5) but keeps every old fact visible", () => {
    const records = history(["w", "w", "w", "c", "c", "c"]);
    expect(computeMasteryFor(records).measures.accuracy).toBe(0.5); // the accumulated mean alone WOULD still say weakness
    const result = select(pool(), records);
    expect(result.allReasonsSatisfied).not.toContain("accuracy_weakness");
    expect(result.primaryReason).toBe("recent_improvement");
    expect(result.trendEvidence).toMatchObject({ kind: "improving", earlierGraded: 3, earlierCorrect: 0 });
    expect(result.accumulatedEvidence).toMatchObject({ gradedAttempts: 6, incorrectCount: 3 }); // not erased
    expect(result.explanation).toMatch(/last 3 graded answers were all correct, compared with 0 of 3 earlier ones, so this moves you forward gradually/);
    expect(result.question.questionId).toBe("Q-adv"); // smallest step up
  });

  it("a recent success does NOT erase accumulated evidence when it is not a full run", () => {
    expect(select(pool(), history(["w", "w", "w", "c"])).primaryReason).toBe("accuracy_weakness");
    const partial = select(pool(), history(["w", "w", "c", "w", "c", "c"])); // recent [w,c,c] = 2/3 -> no trend claim; accumulated (3/6) stays
    expect(partial.trendEvidence?.kind).toBeNull();
    expect(partial.allReasonsSatisfied).toContain("accuracy_weakness");
  });

  it("deterioration without a trailing error run: strong older history, then w c w -> recent_deterioration at a steady difficulty", () => {
    const records = history(["c", "c", "c", "c", "w", "c", "w"]);
    const result = select([cand("Q-1"), cand("Q-adv", "advanced")], records);
    expect(result.allReasonsSatisfied).not.toContain("repeated_error");
    expect(result.trendEvidence?.kind).toBe("deteriorating");
    expect(result.primaryReason).toBe("recent_deterioration");
    expect(result.question.questionId).toBe("Q-1"); // never harder than the last graded tier
    expect(result.explanation).toMatch(/1 of your last 3 graded answers were correct, compared with 4 of 4 earlier ones, so this keeps the difficulty steady/);
  });

  it("deterioration with a trailing error run: repeated_error still wins (existing behavior preserved), trend is exposed alongside", () => {
    const result = select(pool(), history(["c", "c", "c", "w", "w"]));
    expect(result.primaryReason).toBe("repeated_error");
    expect(result.allReasonsSatisfied).toContain("recent_deterioration");
    expect(result.trendEvidence?.kind).toBe("deteriorating");
  });

  it("a recent failure does not overwrite strong recent history: c c c c c w is not deteriorating", () => {
    const result = select(pool(), history(["c", "c", "c", "c", "c", "w"]));
    expect(result.trendEvidence?.kind).toBeNull();
    expect(result.primaryReason).toBe("recent_incorrect");
  });

  it("persistent difficulty: w w c w w keeps the accumulated reasons (no improvement claim from one success)", () => {
    const result = select(pool(), history(["w", "w", "c", "w", "w"]));
    expect(result.trendEvidence?.kind).toBe("persistent_difficulty");
    expect(result.allReasonsSatisfied).toEqual(expect.arrayContaining(["repeated_error", "accuracy_weakness"]));
  });

  it("nothing is forced: improvement on an advanced tier with only an easier question offered falls through, and a thin pool still yields an answer", () => {
    const records = history(["w", "w", "w", "c", "c", "c"], { tier: "advanced" });
    const result = select([cand("Q-1", "standard")], records);
    expect(result.primaryReason).not.toBe("recent_improvement");
    expect(result.question.questionId).toBe("Q-1");
  });

  it("safety: published-only, no immediate repeat, student isolation, cold start all hold with trend evidence present", () => {
    const records = history(["w", "w", "w", "c", "c", "c"]);
    const draft = makeCandidate({ questionId: "Q-draft", difficultyTier: "advanced", patternFamilyName: "Reverse Percentage", patternTaxonomyCellId: "cell-reverse-standard" }, { validationState: "ai_validated" });
    const justAttempted = cand("th-0-me-5", "advanced");
    const result = select([draft, justAttempted, cand("Q-ok", "advanced")], records);
    expect(result.excludedUnpublishedCount).toBe(1);
    expect(result.question.questionId).toBe("Q-ok");

    const foreign = select(pool(), history(["w", "w", "w", "c", "c", "c"], { studentId: "someone-else" }));
    expect(foreign.trendEvidence).toBeNull();
    expect(select(pool(), []).trendEvidence).toBeNull();
  });

  it("deterministic, and no answer-bearing field exists on the trend evidence", () => {
    const records = history(["w", "w", "w", "c", "c", "c"]);
    expect(select(pool(), records)).toEqual(select(pool(), records));
    expect(JSON.stringify(select(pool(), records).trendEvidence)).not.toMatch(/correctAnswer|solution|explanation|reasoning/i);
  });

  it("explanations state observations only", () => {
    const texts = [history(["w", "w", "w", "c", "c", "c"]), history(["c", "c", "c", "c", "w", "c", "w"])].map((r) => select(pool(), r).explanation);
    for (const text of texts) expect(text).not.toMatch(/confiden|motivat|anxi|lazy|careless|understand|intelligen|struggl|afraid|feel|bad at|naturally/i);
  });
});

describe("no immediate repeat applies to trend reasons", () => {
  it("the just-attempted question never satisfies a trend reason, so a harder alternative is not forced by it (nothing is forced)", () => {
    const records = history(["c", "c", "c", "c", "w", "c", "w"]); // last graded: standard, id th-0-me-6
    const result = select([cand("th-0-me-6"), cand("Q-adv", "advanced")], records);
    expect(result.trendEvidence?.kind).toBe("deteriorating");
    expect(result.primaryReason).not.toBe("recent_deterioration"); // the only non-harder candidate is the one just attempted
    expect(result.allReasonsSatisfied).not.toContain("recent_deterioration");
  });
});
