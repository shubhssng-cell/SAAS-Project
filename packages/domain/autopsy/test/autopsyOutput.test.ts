import { describe, expect, it } from "vitest";
import { buildAutopsyOutput } from "../src/autopsyOutput.js";
import { buildEvidence } from "../fixtures/evidence.js";
import { errorTaxonomyFixture } from "../fixtures/errorTaxonomy.js";
import { percentagesHardNovelPressureQuestionContext, percentagesQuestionContext } from "../fixtures/questionContext.js";
import type { HistoricalAttemptRecord } from "../src/types.js";

const FORBIDDEN_PSYCHOLOGICAL_TERMS = [
  "confidence",
  "motivation",
  "emotion",
  "intelligence",
  "anxiety",
  "laziness",
  "carelessness",
  "intent"
];

describe("buildAutopsyOutput — full assembly (Phase 5A §9)", () => {
  it("assembles all sections for a normal incorrect attempt", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(output.attemptFacts).toBeDefined();
    expect(output.questionFacts).toBe(percentagesQuestionContext); // reused directly, not copied/re-derived
    expect(output.behaviorSignals).toBeDefined();
    expect(output.hintSolutionEvidence).toBeDefined();
    expect(output.historicalSignals).toBeNull(); // no priors supplied
    expect(output.candidateErrorEvidence).not.toBeNull();
  });

  it("availableEvidence/missingEvidence reflect what was actually supplied", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ hintsUsed: 1, isCorrect: true }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(output.availableEvidence).toContain("hints_used_count");
    expect(output.availableEvidence).toContain("time_taken");
    expect(output.missingEvidence.some((m) => m.includes("prior attempt history"))).toBe(true);
    expect(output.missingEvidence.some((m) => m.includes("reasoning_text"))).toBe(true);
  });

  it("missing/invalid expected time is reflected in missingEvidence", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ expectedTimeSeconds: null }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(output.missingEvidence.some((m) => m.includes("speedRatio"))).toBe(true);
  });

  it("preservation of raw evidence: attemptFacts is the exact object passed in, not a mutated/re-derived copy", () => {
    const evidence = buildEvidence({ isCorrect: false, finalAnswer: "420" });
    const originalEventCount = evidence.eventTimeline.length;
    const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });
    expect(output.attemptFacts).toBe(evidence);
    expect(evidence.eventTimeline.length).toBe(originalEventCount); // never mutated
  });

  it("does not mutate the supplied priorAttempts array or its contents", () => {
    const prior: HistoricalAttemptRecord[] = [{ evidence: buildEvidence({ isCorrect: false }), question: percentagesQuestionContext }];
    const priorSnapshot = JSON.stringify(prior);
    buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture,
      priorAttempts: prior
    });
    expect(JSON.stringify(prior)).toBe(priorSnapshot);
  });

  it("no field anywhere asserts a psychological state — no confidence score, ever", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420", hintsUsed: 2, solutionOpenedAt: "2026-09-22T10:01:00.000Z" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture,
      priorAttempts: [{ evidence: buildEvidence({ isCorrect: false }), question: percentagesQuestionContext }]
    });
    const serialized = JSON.stringify(output).toLowerCase();
    for (const term of FORBIDDEN_PSYCHOLOGICAL_TERMS) {
      expect(serialized.includes(term)).toBe(false);
    }
  });

  it("candidate error is structurally distinct from a confirmed error — no 'confirmed' key exists anywhere in the output", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
    });
    expect(JSON.stringify(output).toLowerCase().includes('"confirmed"')).toBe(false);
  });
});

describe("Phase 5A §13 regression tests", () => {
  it("1. 98% accuracy on basic questions does not become a universal diagnosis for a DIFFERENT, harder question", () => {
    // 20 correct, fast, standard-tier attempts on the SAME concept as history
    const priorSuccesses: HistoricalAttemptRecord[] = Array.from({ length: 20 }, () => ({
      evidence: buildEvidence({ isCorrect: true, timeTakenSeconds: 30, expectedTimeSeconds: 90 }),
      question: percentagesQuestionContext
    }));
    // the CURRENT attempt: a single failure on a harder, novel, pressure-context cell
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesHardNovelPressureQuestionContext,
      errorTaxonomy: errorTaxonomyFixture,
      priorAttempts: priorSuccesses
    });

    // the overwhelming success history must not manufacture a "repeated failure" or any generalized claim
    expect(output.historicalSignals?.repeatedConceptFailure).toBeNull();
    expect(output.historicalSignals?.repeatedTaxonomyCellFailure).toBeNull();
    // and there must be no field anywhere in the whole output shaped like a mastery/understanding verdict
    const keys = JSON.stringify(output).toLowerCase();
    expect(keys.includes("mastery")).toBe(false);
    expect(keys.includes("understanding")).toBe(false);
    expect(keys.includes("overallassessment")).toBe(false);
  });

  it("2. one hard-question failure does not become a confirmed error", () => {
    const output = buildAutopsyOutput({
      evidence: buildEvidence({ isCorrect: false, finalAnswer: "420" }),
      question: percentagesHardNovelPressureQuestionContext,
      errorTaxonomy: errorTaxonomyFixture
      // no priorAttempts at all
    });
    expect(output.historicalSignals).toBeNull(); // nothing "repeated" can be claimed from a single data point
    expect(output.candidateErrorEvidence).not.toBeNull();
    expect(output.candidateErrorEvidence?.qualification).toMatch(/NOT a confirmed diagnosis/);
    expect(JSON.stringify(output.candidateErrorEvidence).toLowerCase().includes('"confirmed"')).toBe(false);
  });

  it("3. A -> B -> C -> D is preserved exactly through the Autopsy layer, not collapsed to only the final answer", () => {
    const evidence = buildEvidence({
      isCorrect: false,
      finalAnswer: "500",
      answerChangeHistory: {
        initialAnswer: "420",
        finalAnswer: "500",
        changeCount: 3,
        sequence: [
          { answer: "420", occurredAt: "2026-09-22T10:00:10.000Z" },
          { answer: "480", occurredAt: "2026-09-22T10:00:20.000Z" },
          { answer: "450", occurredAt: "2026-09-22T10:00:30.000Z" },
          { answer: "500", occurredAt: "2026-09-22T10:00:40.000Z" }
        ]
      }
    });
    const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });
    expect(output.attemptFacts.answerChangeHistory.sequence.map((p) => p.answer)).toEqual(["420", "480", "450", "500"]);
    expect(output.attemptFacts.answerChangeHistory.changeCount).toBe(3);
    expect(output.behaviorSignals.multipleAnswerChanges).toBe(true);
  });

  it("4. correct but 3x expected time remains both correct AND slow in the full output", () => {
    const evidence = buildEvidence({ isCorrect: true, timeTakenSeconds: 270, expectedTimeSeconds: 90 });
    const output = buildAutopsyOutput({ evidence, question: percentagesQuestionContext, errorTaxonomy: errorTaxonomyFixture });
    expect(output.attemptFacts.isCorrect).toBe(true);
    expect(output.behaviorSignals.correctSlow).toBe(true);
    expect(output.candidateErrorEvidence).toBeNull(); // correct, so still no error evidence at all
  });
});
