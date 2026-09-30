import { describe, expect, it } from "vitest";
import { buildEvidence } from "../fixtures/evidence.js";
import { percentagesHardNovelPressureQuestionContext, percentagesQuestionContext, ratioQuestionContext } from "../fixtures/questionContext.js";
import { NEVER_COLLECTED, OBSERVATION_FIELD_SOURCES, RECENT_OUTCOME_LIMIT, buildObservationEvidence } from "../src/observationEvidence.js";
import type { HistoricalAttemptRecord } from "../src/types.js";

/**
 * Phase 4 Unit 1 -- OBSERVATION-ONLY evidence. These tests pin what is reported, where each field comes from (observed / derived /
 * unknown), that an unknown stays unknown, and that nothing diagnostic, answer-bearing or psychological can appear.
 */

const q = percentagesQuestionContext;
const sel = (answer: string, at: string) => ({ answer, occurredAt: at });
const prior = (overrides: Parameters<typeof buildEvidence>[0], question = q, endedAt = "2026-09-22T09:00:00.000Z"): HistoricalAttemptRecord => ({
  evidence: buildEvidence({ eventTimeline: [{ type: "answer_submitted", occurredAt: endedAt, payload: null }], ...overrides }),
  question
});

describe("outcome and timing (observed / derived)", () => {
  it("correct attempt: verdict, selected answer, elapsed, expected and the derived ratio", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence({ isCorrect: true, finalAnswer: "480", timeTakenSeconds: 120, expectedTimeSeconds: 90 }), question: q });
    expect(e.outcome).toEqual({ status: "submitted", verdict: "correct", selectedAnswer: "480" });
    expect(e.timing).toEqual({ elapsedSeconds: 120, expectedSeconds: 90, timeRatio: 120 / 90 });
  });

  it("incorrect attempt", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }), question: q });
    expect(e.outcome).toEqual({ status: "submitted", verdict: "incorrect", selectedAnswer: "420" });
  });

  it("skipped attempt: not graded, no selected answer, status carried through", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence({ status: "skipped", skipped: true, isCorrect: null, finalAnswer: null, answerChangeHistory: { initialAnswer: null, finalAnswer: null, changeCount: 0, sequence: [] } }), question: q });
    expect(e.outcome).toEqual({ status: "skipped", verdict: "not_graded", selectedAnswer: null });
    expect(e.unknown).toContain("outcome.selectedAnswer");
  });

  it("abandoned attempt is reported as such, never as incorrect", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence({ status: "abandoned", isCorrect: null, finalAnswer: null }), question: q });
    expect(e.outcome.status).toBe("abandoned");
    expect(e.outcome.verdict).toBe("not_graded");
  });

  it("a time ratio is DERIVED only when both times are valid; otherwise it is null and listed as unknown (never 0 or 1)", () => {
    for (const bad of [{ timeTakenSeconds: null }, { expectedTimeSeconds: null }, { expectedTimeSeconds: 0 }, { timeTakenSeconds: Number.NaN }]) {
      const e = buildObservationEvidence({ evidence: buildEvidence(bad), question: q });
      expect(e.timing.timeRatio).toBeNull();
      expect(e.unknown).toContain("timing.timeRatio");
    }
    expect(buildObservationEvidence({ evidence: buildEvidence({ timeTakenSeconds: null }), question: q }).unknown).toContain("timing.elapsedSeconds");
  });
});

describe("interaction: what the practice flow does and does not record", () => {
  it("ONE recorded selection is NOT evidence of 'no change': the change count is unknown, never 0", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence(), question: q });
    expect(e.interaction.recordedSelectionCount).toBe(1);
    expect(e.interaction.answerChangeCount).toBeNull();
    expect(e.interaction.answerChanged).toBeNull();
    expect(e.unknown).toEqual(expect.arrayContaining(["interaction.answerChangeCount", "interaction.answerChanged"]));
  });

  it("two or more recorded selections make the change count a derived fact", () => {
    const history = { initialAnswer: "A", finalAnswer: "C", changeCount: 2, sequence: [sel("A", "2026-09-22T10:00:10.000Z"), sel("B", "2026-09-22T10:00:20.000Z"), sel("C", "2026-09-22T10:00:30.000Z")] };
    const e = buildObservationEvidence({ evidence: buildEvidence({ answerChangeHistory: history, finalAnswer: "C" }), question: q });
    expect(e.interaction).toMatchObject({ recordedSelectionCount: 3, answerChangeCount: 2, answerChanged: true });
    expect(e.unknown).not.toContain("interaction.answerChangeCount");
  });

  it("hint and solution fields are counts/flags of RECORDED events, reported as recorded", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence({ hintsUsed: 2, solutionOpenedAt: "2026-09-22T10:01:00.000Z" }), question: q });
    expect(e.interaction).toMatchObject({ hintEventsRecorded: 2, solutionOpenedRecorded: true });
    const none = buildObservationEvidence({ evidence: buildEvidence(), question: q });
    expect(none.interaction).toMatchObject({ hintEventsRecorded: 0, solutionOpenedRecorded: false });
  });

  it("the event sequence is ordered deterministically (time, ties in recorded order) and carries types and timestamps only", () => {
    const evidence = buildEvidence({
      eventTimeline: [
        { type: "answer_submitted", occurredAt: "2026-09-22T10:01:30.000Z", payload: { selectedAnswer: "480" } },
        { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z", payload: null },
        { type: "answer_selected", occurredAt: "2026-09-22T10:01:30.000Z", payload: { selectedAnswer: "480" } }
      ]
    });
    const e = buildObservationEvidence({ evidence, question: q });
    expect(e.eventSequence).toEqual([
      { type: "question_opened", occurredAt: "2026-09-22T10:00:00.000Z" },
      { type: "answer_submitted", occurredAt: "2026-09-22T10:01:30.000Z" },
      { type: "answer_selected", occurredAt: "2026-09-22T10:01:30.000Z" }
    ]);
    expect(JSON.stringify(e.eventSequence)).not.toContain("selectedAnswer");
  });
});

describe("question context and history", () => {
  it("copies the existing question metadata; an unresolved question is null (unknown) and takes history with it", () => {
    const withQ = buildObservationEvidence({ evidence: buildEvidence(), question: q, priorAttempts: [prior({ isCorrect: false })] });
    expect(withQ.questionContext).toMatchObject({ conceptName: q.conceptName, patternFamilyName: q.patternFamilyName, patternTaxonomyCellId: q.patternTaxonomyCellId, difficultyTier: q.difficultyTier });
    const without = buildObservationEvidence({ evidence: buildEvidence(), question: null, priorAttempts: [prior({ isCorrect: false })] });
    expect(without.questionContext).toBeNull();
    expect(without.history).toBeNull();
    expect(without.unknown).toEqual(expect.arrayContaining(["questionContext", "history"]));
  });

  it("no prior attempts: history is null (absent), never a zero-filled summary", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence(), question: q });
    expect(e.history).toBeNull();
    expect(e.unknown).toContain("history");
  });

  it("counts prior outcomes at concept, family, cell and question level (multiple priors, mixed outcomes)", () => {
    const sameQuestion = { questionId: q.questionId };
    const priors = [
      prior({ isCorrect: false }, q, "2026-09-20T10:00:00.000Z"),
      prior({ isCorrect: true }, q, "2026-09-21T10:00:00.000Z"),
      prior({ status: "skipped", skipped: true, isCorrect: null, finalAnswer: null }, q, "2026-09-21T11:00:00.000Z"),
      prior({ isCorrect: false }, percentagesHardNovelPressureQuestionContext, "2026-09-21T12:00:00.000Z"), // same concept, different cell/family
      prior({ isCorrect: false }, ratioQuestionContext, "2026-09-21T13:00:00.000Z") // another concept
    ];
    const current = buildEvidence({ questionId: sameQuestion.questionId });
    const e = buildObservationEvidence({ evidence: current, question: q, priorAttempts: priors });
    expect(e.history?.priorAttempts).toBe(5);
    expect(e.history?.onSameConcept).toEqual({ attempts: 4, correct: 1, incorrect: 2, skipped: 1, abandoned: 0 });
    expect(e.history?.onSameTaxonomyCell.attempts).toBe(3);
    expect(e.history?.onSameQuestion.attempts).toBe(3);
    expect(e.history?.onSamePatternFamily.attempts).toBeGreaterThanOrEqual(3);
  });

  it("the current attempt never counts itself, and history order does not depend on the order priors are supplied", () => {
    const priors = [prior({ isCorrect: true }, q, "2026-09-20T10:00:00.000Z"), prior({ isCorrect: false }, q, "2026-09-21T10:00:00.000Z"), prior({ isCorrect: true }, q, "2026-09-22T08:00:00.000Z")];
    const self: HistoricalAttemptRecord = { evidence: buildEvidence({ attemptId: "the-current" }), question: q };
    const current = buildEvidence({ attemptId: "the-current" });
    const a = buildObservationEvidence({ evidence: current, question: q, priorAttempts: [...priors, self] });
    const b = buildObservationEvidence({ evidence: current, question: q, priorAttempts: [priors[2]!, self, priors[0]!, priors[1]!] });
    expect(a).toEqual(b);
    expect(a.history?.priorAttempts).toBe(3);
    expect(a.history?.recentOnConcept.map((r) => r.outcome)).toEqual(["correct", "incorrect", "correct"]);
  });

  it(`recent outcomes are the last ${RECENT_OUTCOME_LIMIT} on the concept, oldest first`, () => {
    const priors = Array.from({ length: 8 }, (_, i) => prior({ isCorrect: i % 2 === 0, attemptId: `p${i}` }, q, `2026-09-2${i}T10:00:00.000Z`));
    const e = buildObservationEvidence({ evidence: buildEvidence(), question: q, priorAttempts: priors });
    expect(e.history?.recentOnConcept.map((r) => r.attemptId)).toEqual(["p3", "p4", "p5", "p6", "p7"]);
  });
});

describe("field sources, unknowns, determinism and purity", () => {
  const collectPaths = (value: unknown, prefix = ""): string[] => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
    return Object.entries(value as object).flatMap(([k, v]) => collectPaths(v, prefix ? `${prefix}.${k}` : k));
  };

  it("every emitted field (other than the source table and the unknown list) has a declared source of 'observed' or 'derived'", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence(), question: q, priorAttempts: [prior({ isCorrect: false })] });
    const { fieldSources: _s, unknown: _u, ...rest } = e;
    void _s;
    void _u;
    const declared = new Set(Object.keys(OBSERVATION_FIELD_SOURCES));
    for (const path of collectPaths(rest)) {
      const covered = declared.has(path) || [...declared].some((d) => path === d || path.startsWith(`${d}.`) || path.startsWith(`${d}[`));
      expect(covered, path).toBe(true);
    }
    expect(Object.values(OBSERVATION_FIELD_SOURCES).every((s) => s === "observed" || s === "derived")).toBe(true);
    expect(e.fieldSources).toEqual(OBSERVATION_FIELD_SOURCES);
  });

  it("what is never collected is listed explicitly, every time", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence(), question: q });
    for (const item of NEVER_COLLECTED) expect(e.unknown).toContain(item);
  });

  it("deterministic and pure: identical input -> identical output, and inputs are not mutated", () => {
    const evidence = buildEvidence({ hintsUsed: 1 });
    const priors = [prior({ isCorrect: false }), prior({ isCorrect: true })];
    const before = JSON.stringify({ evidence, priors });
    const a = buildObservationEvidence({ evidence, question: q, priorAttempts: priors });
    const b = buildObservationEvidence({ evidence, question: q, priorAttempts: priors });
    expect(a).toEqual(b);
    expect(JSON.stringify({ evidence, priors })).toBe(before);
  });

  it("NO diagnosis, hypothesis, repair, answer key or psychological field exists anywhere in the object", () => {
    const e = buildObservationEvidence({ evidence: buildEvidence({ isCorrect: false, finalAnswer: "420", hintsUsed: 1 }), question: q, priorAttempts: [prior({ isCorrect: false }), prior({ isCorrect: false })] });
    const text = JSON.stringify(e);
    expect(text).not.toMatch(/correctAnswer|expectedAnswer|groundTruth|solutionSteps|candidateError|errorCategory|hypothesis|diagnos|repair|trap/i);
    // The explicit `unknown` list names confidence/intent ONLY to state they are never collected; everything else must be free of them.
    const { unknown: _unknown, ...observed } = e;
    void _unknown;
    expect(JSON.stringify(observed)).not.toMatch(/confiden|motivat|anxi|lazy|careless|intelligen|ability|emotion|personality|intent|afraid|feel|understand|confus|unsure|guess/i);
    const keys = collectPaths(e).join(" ").toLowerCase();
    for (const banned of ["confidence", "motivation", "emotion", "intelligence", "ability", "personality", "hypothesis", "diagnosis", "correctanswer"]) {
      expect(keys.includes(banned)).toBe(false);
    }
    expect(Object.keys(e).sort()).toEqual(["eventSequence", "fieldSources", "history", "identity", "interaction", "outcome", "questionContext", "timing", "unknown"]);
  });
});
