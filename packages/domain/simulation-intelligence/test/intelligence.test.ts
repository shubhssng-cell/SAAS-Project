import { toFinalizedSimulationEvidence } from "@ipmat/exam-simulation";
import { buildMasteryEvidenceView } from "@ipmat/mastery";
import { beforeEach, describe, expect, it } from "vitest";
import { buildExamPerformanceIntelligence, READINESS_EVIDENCE_STATUS, SimulationIntelligenceError, UNRESOLVED_READINESS_POLICY } from "../src/index.js";
import { attempt, EXAM, finalizedSimulation, intelligence, ms, PAPER, PAPER_B, question, resetCounter, STUDENT, trapWorld, unitsFor } from "./fixtures.js";

beforeEach(resetCounter);

async function twoSimsSamePaper() {
  const a = await finalizedSimulation({ id: "sim-a", questionIds: PAPER, answers: { 1: "right", 2: "wrong" }, startMs: 0 });
  const b = await finalizedSimulation({ id: "sim-b", questionIds: PAPER, answers: { 1: "right", 2: "right", 3: "wrong" }, startMs: 3_600_000 });
  return [a.evidence, b.evidence];
}

describe("the finalized-only boundary", () => {
  it("an ACTIVE simulation cannot even be exported as evidence (Unit 4's contract refuses it)", async () => {
    const { state } = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "right" } });
    expect(() => toFinalizedSimulationEvidence({ ...state, status: "in_progress", finalizedAt: null, finalizedBy: null, result: null })).toThrowError(/Only a finalized simulation/);
  });
  it("a hand-made non-finalized or malformed evidence object is refused at runtime", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "right" } });
    for (const bad of [{ ...evidence, status: "in_progress" }, { ...evidence, contract: "something_else" }, { ...evidence, status: undefined }]) {
      expect(() => intelligence([bad as never])).toThrowError(SimulationIntelligenceError);
      try { intelligence([bad as never]); } catch (e) { expect((e as SimulationIntelligenceError).code).toBe("not_finalized"); }
    }
  });
  it("accepts BOTH finalized endings: submitted by the student and expired at the deadline", async () => {
    const submitted = await finalizedSimulation({ id: "s1", questionIds: PAPER, answers: { 1: "right" } });
    const expired = await finalizedSimulation({ id: "s2", questionIds: PAPER, answers: { 1: "right" }, end: "deadline", startMs: 10_000_000 });
    const r = intelligence([submitted.evidence, expired.evidence]);
    expect(r.simulations.map((s) => [s.simulationId, s.status, s.endedByDeadline])).toEqual([["s1", "submitted", false], ["s2", "expired", true]]);
  });
  it("another student's or another exam's simulation is refused, never silently merged", async () => {
    const mine = await finalizedSimulation({ id: "mine", questionIds: PAPER, answers: { 1: "right" } });
    const theirs = await finalizedSimulation({ id: "theirs", questionIds: PAPER, answers: { 1: "right" }, studentId: "student-2" });
    const foreign = await finalizedSimulation({ id: "foreign", questionIds: PAPER, answers: { 1: "right" }, examCode: "JEE_MAIN" });
    for (const other of [theirs.evidence, foreign.evidence]) {
      expect(() => intelligence([mine.evidence, other])).toThrowError(SimulationIntelligenceError);
      try { intelligence([mine.evidence, other]); } catch (e) { expect((e as SimulationIntelligenceError).code).toBe("scope_mismatch"); }
    }
  });
  it("refuses Unit 1/2/3 outputs of another student or exam", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "right" } });
    const u = unitsFor(trapWorld().records, trapWorld().candidates);
    const base = { studentId: STUDENT, examCode: EXAM, simulations: [evidence], publishedPool: u.publishedPool, evidence: u.evidence, revision: u.revision, curriculum: u.curriculum };
    expect(() => buildExamPerformanceIntelligence({ ...base, evidence: { ...u.evidence, studentId: "x" } })).toThrow(/another student/);
    expect(() => buildExamPerformanceIntelligence({ ...base, revision: { ...u.revision, examCode: "JEE_MAIN" } })).toThrow(/another exam/);
  });
  it("no simulation at all is a valid, empty report - not an error and not a score of zero", () => {
    const r = intelligence([]);
    expect(r.simulationCount).toBe(0);
    expect(r.simulations).toEqual([]);
    expect(r.comparisons.groups).toEqual([]);
    expect(r.observations).toEqual([]);
    expect(r.concepts.length).toBeGreaterThan(0);
    expect(r.concepts[0]!.conceptMastery.simulation).toEqual({ appearances: 0, answered: 0, unanswered: 0, correct: 0, incorrect: 0, notGraded: 0 });
  });
});

describe("simulation performance view: question-level, section-level, timing, unanswered", () => {
  it("reports each question's outcome and timing facts, and never an answer key or a chosen answer", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "right", 2: "wrong" }, startMs: 0 });
    const r = intelligence([evidence]);
    const s = r.simulations[0]!;
    expect(s.questions.map((q) => [q.position, q.questionId, q.outcome])).toEqual([[1, "q-1", "correct"], [2, "q-2", "incorrect"], [3, "q-trap", "unanswered"]]);
    expect(s.questions[0]).toMatchObject({ secondsToFirstAnswer: 1, secondsToLastAnswer: 1, answerChangeCount: 0 });
    expect(s.questions[2]).toMatchObject({ secondsToFirstAnswer: null, secondsToLastAnswer: null });
    expect(s).toMatchObject({ isHistoricalPaper: false, configVersion: "fixture-v1", totals: { answered: 2, correct: 1, incorrect: 1, unanswered: 1 } });
    expect(s.sections).toEqual([expect.objectContaining({ sectionName: "Quant", answered: 2, unanswered: 1, correct: 1, incorrect: 1 })]);
    const text = JSON.stringify(r);
    for (const secret of ["chosenAnswer", "correctAnswer", "\"right\"", "\"wrong\"", "contentFingerprint", "fp-q-"]) expect(text, secret).not.toContain(secret);
  });
  it("timing evidence: elapsed vs allowed, who ended it", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "right" }, end: "deadline" });
    const s = intelligence([evidence]).simulations[0]!;
    expect(s).toMatchObject({ allowedSeconds: 600, elapsedSeconds: 600, finalizedBy: "deadline", endedByDeadline: true });
  });
  it("answer changes are counted and a same-answer repeat is not a change", async () => {
    const a = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "wrong" } });
    expect(intelligence([a.evidence]).simulations[0]!.questions[0]!.answerChangeCount).toBe(0);
  });
  it("is deterministic and independent of input order", async () => {
    const sims = await twoSimsSamePaper();
    expect(intelligence([...sims].reverse())).toEqual(intelligence(sims));
    expect(intelligence(sims)).toEqual(intelligence(sims));
  });
});

describe("multi-dimensional aggregation: only dimensions that exist in the contracts, never one number", () => {
  it("aggregates per section, concept, pattern family, novelty, testing mode, difficulty tier and trap code", async () => {
    const sims = await twoSimsSamePaper();
    const d = intelligence(sims).dimensions;
    expect(d.section).toEqual([expect.objectContaining({ value: "Quant", appearances: 6, answered: 5, unanswered: 1, correct: 3, incorrect: 2, simulationIds: ["sim-a", "sim-b"] })]);
    expect(d.concept.map((b) => [b.value, b.appearances])).toEqual([["Percentages", 6]]);
    expect(d.patternFamily.map((b) => [b.value, b.appearances, b.correct, b.incorrect, b.unanswered])).toEqual([["Reverse Percentage", 4, 2, 1, 1], ["Successive Percentage Change", 2, 1, 1, 0]]);
    expect(d.trapCode.map((b) => b.value)).toEqual(["base_confusion"]);
    expect(d.difficultyTier.map((b) => b.value)).toEqual(["standard"]);
    expect(d.noveltyLevel.map((b) => b.value)).toEqual(["standard"]);
    expect(d.testingMode.map((b) => b.value)).toEqual(["combined", "direct"]);
  });
  it("every bucket partitions its appearances into answered/unanswered and correct/incorrect/not-graded", async () => {
    const d = intelligence(await twoSimsSamePaper()).dimensions;
    for (const buckets of Object.values(d)) for (const b of buckets) {
      expect(b.answered + b.unanswered).toBe(b.appearances);
      expect(b.correct + b.incorrect + b.notGraded).toBe(b.answered);
    }
  });
  it("a question with no Question DNA (e.g. since unpublished) contributes only to the section dimension and is counted, never guessed", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: [...PAPER.slice(0, 2), "q-gone"], answers: { 1: "right", 3: "right" } });
    const r = intelligence([evidence]);
    expect(r.questionsWithoutDna).toBe(1);
    expect(r.dimensions.section[0]!.appearances).toBe(3);
    expect(r.dimensions.concept[0]!.appearances).toBe(2);
  });
  it("question exposure across simulations lists repeats chronologically", async () => {
    const r = intelligence(await twoSimsSamePaper());
    expect(r.repeatedQuestionIds).toEqual(["q-1", "q-2", "q-trap"]);
    expect(r.questionExposure.find((e) => e.questionId === "q-1")!.outcomes.map((o) => [o.simulationId, o.outcome])).toEqual([["sim-a", "correct"], ["sim-b", "correct"]]);
  });
});

describe("cross-simulation history: factual, and only between genuinely comparable simulations", () => {
  it("compares simulations of the SAME configuration and the SAME ordered paper, with factual phrasing", async () => {
    const r = intelligence(await twoSimsSamePaper());
    expect(r.comparisons.groups).toHaveLength(1);
    const g = r.comparisons.groups[0]!;
    expect(g.simulationIds).toEqual(["sim-a", "sim-b"]);
    expect(g.configVersion).toBe("fixture-v1");
    const correct = g.series.find((s) => s.measure === "correct")!;
    expect(correct.values).toEqual([{ simulationId: "sim-a", value: 1 }, { simulationId: "sim-b", value: 2 }]);
    expect(correct.difference).toBe(1);
    expect(correct.description).toBe("correct: 1, then 2 (sim-a, then sim-b)");
    expect(g.series.find((s) => s.measure === "unanswered")!.difference).toBe(-1);
    // factual language only: no interpretation of the difference
    const text = JSON.stringify(r.comparisons);
    expect(text).not.toMatch(/improv|stronger|better|worse|weaker|confiden|progress|declin/i);
  });
  it("never compares a different paper or a different configuration version", async () => {
    const a = await finalizedSimulation({ id: "a", questionIds: PAPER, answers: { 1: "right" }, startMs: 0 });
    const diffPaper = await finalizedSimulation({ id: "b", questionIds: PAPER_B, answers: { 1: "right" }, startMs: 3_600_000 });
    const diffConfig = await finalizedSimulation({ id: "c", questionIds: PAPER, answers: { 1: "right" }, startMs: 7_200_000, configVersion: "fixture-v2" });
    const r = intelligence([a.evidence, diffPaper.evidence, diffConfig.evidence]);
    expect(r.comparisons.groups).toEqual([]);
    expect(r.comparisons.notCompared.map((n) => n.simulationId)).toEqual(["a", "b", "c"]);
    expect(r.comparisons.notCompared.every((n) => n.reason === "only_simulation_with_this_paper_and_configuration")).toBe(true);
  });
  it("a reordered paper is a different paper", async () => {
    const a = await finalizedSimulation({ id: "a", questionIds: PAPER, answers: { 1: "right" }, startMs: 0 });
    const b = await finalizedSimulation({ id: "b", questionIds: [...PAPER].reverse(), answers: { 1: "right" }, startMs: 3_600_000 });
    expect(intelligence([a.evidence, b.evidence]).comparisons.groups).toEqual([]);
  });
  it("three comparable simulations give a three-point series in finalization order, whatever the input order", async () => {
    const mk = (id: string, start: number, answers: Record<number, string>) => finalizedSimulation({ id, questionIds: PAPER, answers, startMs: start }).then((x) => x.evidence);
    const sims = [await mk("c", 20_000_000, { 1: "right", 2: "right", 3: "right" }), await mk("a", 0, {}), await mk("b", 10_000_000, { 1: "right" })];
    const g = intelligence(sims).comparisons.groups[0]!;
    expect(g.simulationIds).toEqual(["a", "b", "c"]);
    expect(g.series.find((s) => s.measure === "correct")!.values.map((v) => v.value)).toEqual([0, 1, 3]);
  });
  it("a repeated simulation id is ONE piece of evidence", async () => {
    const [a] = await twoSimsSamePaper();
    expect(intelligence([a!, a!, a!]).simulationCount).toBe(1);
  });
  it("different exams never mix: another exam's simulation is refused", async () => {
    const foreign = await finalizedSimulation({ id: "f", questionIds: PAPER, answers: { 1: "right" }, examCode: "JEE_MAIN" });
    expect(() => intelligence([foreign.evidence])).toThrow(/another exam/);
  });
});

describe("observations: exact facts, each traceable, none a judgment", () => {
  it("trap errors in simulations, linked transparently to the practice-derived Unit 2 signal", async () => {
    const r = intelligence(await twoSimsSamePaper());
    const o = r.observations.find((x) => x.id === "trap_errors_in_simulations|*|base_confusion")!;
    expect(o.facts).toMatchObject({ distinctIncorrectQuestions: 2, meetsExistingRecurrenceMinimum: true, existingRecurrenceMinimum: 2 });
    expect(o.questionIds).toEqual(["q-2", "q-trap"]);
    expect(o.simulationIds).toEqual(["sim-a", "sim-b"]);
    expect(o.relatedRevisionSignalIds).toEqual(["recurring_trap_failure|*|base_confusion"]);
  });
  it("a question unanswered in several finalized simulations, using the existing repeat minimum", async () => {
    const a = await finalizedSimulation({ id: "a", questionIds: PAPER, answers: { 1: "right" }, startMs: 0 });
    const b = await finalizedSimulation({ id: "b", questionIds: PAPER, answers: { 1: "right" }, startMs: 3_600_000 });
    const o = intelligence([a.evidence, b.evidence]).observations.filter((x) => x.kind === "question_unanswered_in_multiple_simulations");
    expect(o.map((x) => x.subject)).toEqual(["q-2", "q-trap"]);
    expect(o[0]!.facts).toMatchObject({ simulationsWhereUnanswered: 2, simulationsWhereItAppeared: 2 });
    const single = intelligence([a.evidence]).observations.filter((x) => x.kind === "question_unanswered_in_multiple_simulations");
    expect(single).toEqual([]);
  });
  it("a simulation ended by the deadline, and sections left with unanswered questions", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: PAPER, answers: { 1: "right" }, end: "deadline" });
    const r = intelligence([evidence]);
    expect(r.observations.find((x) => x.kind === "simulation_ended_by_deadline")!.facts).toMatchObject({ unansweredAtFinalization: 2, answered: 1 });
    expect(r.observations.find((x) => x.kind === "section_unanswered_questions")!.facts).toMatchObject({ unanswered: 2, questionCount: 3, sectionName: "Quant" });
  });
  it("a pattern family the published pool offers but no finalized simulation contained (absence only), linked to the Unit 2 gap signal when one exists", async () => {
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: ["q-1", "q-trap", "q-3"], answers: { 1: "right" } });
    const o = intelligence([evidence]).observations.find((x) => x.kind === "pattern_family_absent_from_simulations")!;
    expect(o).toMatchObject({ conceptName: "Percentages", subject: "Successive Percentage Change", simulationIds: [], questionIds: [] });
  });
  it("observations are sorted deterministically and every one lists its sources", async () => {
    const r = intelligence(await twoSimsSamePaper());
    const keys = r.observations.map((o) => `${o.kind}|${o.id}`);
    expect(keys).toEqual([...keys].sort());
    for (const o of r.observations) expect(o.explanation.length).toBeGreaterThan(10);
  });
});

describe("the five readiness distinctions, per concept, as separate facts (docs/PRODUCT_SPEC.md section 3)", () => {
  it("reports each distinction separately, with practice and simulation as separate sources", async () => {
    const r = intelligence(await twoSimsSamePaper());
    const c = r.concepts.find((x) => x.conceptName === "Percentages")!;
    expect(c.syllabusCompletion.practice).toMatchObject({ attempts: 3, distinctQuestions: 3 });
    expect(c.syllabusCompletion.simulation).toEqual({ questionsAppeared: 3, questionsAnswered: 3 });
    expect(c.syllabusCompletion.publishedQuestionsInPool).toBe(5);
    expect(c.conceptMastery).toMatchObject({ interpretation: "none", practice: { gradedAttempts: 3, correctGradedAttempts: 1, skippedAttempts: 0 }, simulation: { appearances: 6, correct: 3, incorrect: 2, unanswered: 1 } });
    expect(c.questionPatternCoverage.patternFamilies.inPool).toEqual(["Reverse Percentage", "Successive Percentage Change"]);
    expect(c.questionPatternCoverage.noveltyLevels.withoutEvidenceInEitherSource).toEqual(["novel_representation"]);
    expect(c.advancedReadiness.aboveExamDifficultyMappingDefined).toBe(false);
    expect(c.advancedReadiness.trapQuestions.simulation.appearances).toBeGreaterThan(0);
    expect(c.performanceAxes.accuracy).toEqual({ practice: { gradedAttempts: 3, correct: 1, incorrect: 2 }, simulation: { answered: 5, correct: 3, incorrect: 2 } });
    expect(c.performanceAxes.speed).toMatchObject({ practiceTimedGradedAttempts: 3, simulationTimingAvailable: true });
  });
  it("pressure performance is read from the time_pressured testing mode only; a timed simulation is NOT counted as pressure", async () => {
    const r = intelligence(await twoSimsSamePaper());
    const p = r.concepts[0]!.performanceAxes.pressurePerformance;
    expect(p.simulationCountedAsPressure).toBe("undefined");
    expect(p.practiceTimePressuredQuestions.attempts).toBe(0);
    expect(p.simulationTimePressuredQuestions.appearances).toBe(0);
  });
  it("advanced readiness reports outcomes for EVERY tier encountered; it does not decide which tiers are 'above exam'", async () => {
    const world = trapWorld();
    world.candidates.push({ ...world.candidates[0]!, question: question("q-hard", { difficultyTier: "hard", patternFamilyName: "Reverse Percentage" }) });
    const { evidence } = await finalizedSimulation({ id: "s", questionIds: ["q-1", "q-hard", "q-trap"], answers: { 1: "right", 2: "wrong" } });
    const c = intelligence([evidence], world).concepts.find((x) => x.conceptName === "Percentages")!;
    expect(c.advancedReadiness.byDifficultyTier.map((t) => t.tier)).toEqual(["hard", "standard"]);
    expect(c.advancedReadiness.byDifficultyTier.find((t) => t.tier === "hard")!.simulation).toMatchObject({ appearances: 1, incorrect: 1 });
  });
  it("Phase 6 content and historical evidence stay separate from performance, and are optional", async () => {
    const sims = await twoSimsSamePaper();
    const without = intelligence(sims);
    expect(without.concepts.every((c) => c.examContent.contentAvailability === null && c.examContent.historicalRecordsObserved === null)).toBe(true);
    const withP6 = intelligence(sims, trapWorld(), { exam: { contentAvailability: { Percentages: { available: 9, validated: 7, published: 5 } }, historicalRecordCounts: { Percentages: 4 } } });
    const c = withP6.concepts.find((x) => x.conceptName === "Percentages")!;
    expect(c.examContent).toEqual({ contentAvailability: { available: 9, validated: 7, published: 5 }, historicalRecordsObserved: 4 });
    // availability changes nothing about observed performance
    expect(withP6.concepts.map((x) => x.conceptMastery)).toEqual(without.concepts.map((x) => x.conceptMastery));
    expect(withP6.dimensions).toEqual(without.dimensions);
  });
});

describe("bridges: read-only; Units 1-3 are unchanged and nothing is merged, reordered or fed", () => {
  it("does not mutate Unit 1, 2 or 3 outputs or the simulation evidence, and is not influenced by their key order", async () => {
    const sims = await twoSimsSamePaper();
    const world = trapWorld();
    const u = unitsFor(world.records, world.candidates);
    const before = JSON.stringify([u.evidence, u.revision, u.curriculum, sims]);
    buildExamPerformanceIntelligence({ studentId: STUDENT, examCode: EXAM, simulations: sims, publishedPool: u.publishedPool, evidence: u.evidence, revision: u.revision, curriculum: u.curriculum });
    expect(JSON.stringify([u.evidence, u.revision, u.curriculum, sims])).toBe(before);
  });
  it("Unit 1 evidence is exactly what it would be with no simulation at all", async () => {
    const world = trapWorld();
    const u = unitsFor(world.records, world.candidates);
    const direct = buildMasteryEvidenceView(world.records, { studentId: STUDENT, examCode: EXAM, conceptNames: u.curriculum.concepts.map((c) => c.conceptName) });
    expect(u.evidence).toEqual(direct);
    expect(intelligence(await twoSimsSamePaper()).bridges.unit1).toEqual({ rewritesMasteryEvidence: false, relationship: expect.any(String) });
  });
  it("Unit 2: observations link to existing practice signals; the rest are listed as having none", async () => {
    const b = intelligence(await twoSimsSamePaper()).bridges.unit2;
    expect(b.revisionIntelligenceUnchanged).toBe(true);
    expect(b.linked).toEqual([{ observationId: "trap_errors_in_simulations|*|base_confusion", signalIds: ["recurring_trap_failure|*|base_confusion"] }]);
  });
  it("Unit 3: the existing curriculum is shown, never reordered, and no priority is defined; what simulations add is unserved because existing systems read practice only", async () => {
    const r = intelligence(await twoSimsSamePaper());
    const b = r.bridges.unit3;
    expect(b).toMatchObject({ curriculumUnchanged: true, reorderingApplied: false, priorityDefined: false });
    expect(b.existingNextAction).toMatchObject({ status: "selected", actionType: "training_system_practice", providerId: "trap-lab" });
    expect(b.simulationAdds).toEqual(r.observations.map((o) => o.id));
    expect(b.unserved.every((u) => /read practice attempts only/.test(u.reason))).toBe(true);
    expect(b.unserved.find((u) => u.observationId.startsWith("trap_errors"))!.couldBeServedBy).toBe("trap-lab");
    expect(b.missingDecisions.length).toBeGreaterThan(0);
  });
});

describe("the readiness boundary: no score, verdict, probability, confidence, prediction, ability or psychological inference", () => {
  it("states readiness is undefined, cites the specification, and lists the unresolved policy", async () => {
    const r = intelligence(await twoSimsSamePaper());
    expect(r.status).toBe(READINESS_EVIDENCE_STATUS);
    expect(r.readiness).toMatchObject({ defined: false, specification: expect.stringContaining("PRODUCT_SPEC") });
    expect(r.unresolved).toEqual(UNRESOLVED_READINESS_POLICY);
    expect(r.unresolved.length).toBeGreaterThanOrEqual(8);
  });
  it("no field anywhere is a score, percentage, probability, rating, rank, category, verdict, confidence, ability or prediction", async () => {
    const r = intelligence(await twoSimsSamePaper());
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); }
    };
    walk(r);
    for (const k of keys) expect(k, k).not.toMatch(/^score$|percent|probab|likelihood|rating|^rank|category|classification|verdict$|confidence|(^|[^a-z])ability|predict|passchance|ready$|readinessLevel/i);
  });
  it("its text never states a judgment about the student or a forecast", async () => {
    const text = JSON.stringify(intelligence(await twoSimsSamePaper())).toLowerCase();
    for (const phrase of ["likely to", "will pass", "will clear", "chance of", "almost ready", "not ready", "is ready", "weak", "strong", "improved", "more confident", "motivation", "talent", "intelligent"]) expect(text, phrase).not.toContain(phrase);
  });
  it("unrelated: the report carries the student's own id but no other student's, and no enrollment id", async () => {
    const text = JSON.stringify(intelligence(await twoSimsSamePaper()));
    expect(text).not.toContain("enr-1");
    expect(text).not.toContain("student-2");
  });
});

describe("evidence recency check: practice and simulation attempts at different times do not interact", () => {
  it("adding practice attempts changes only the practice-source fields", async () => {
    const sims = await twoSimsSamePaper();
    const base = trapWorld();
    const more = { records: [...base.records, attempt(question("q-3"), { daysAgo: 1 })], candidates: base.candidates };
    const a = intelligence(sims, base);
    const b = intelligence(sims, more);
    expect(b.simulations).toEqual(a.simulations);
    expect(b.dimensions).toEqual(a.dimensions);
    expect(b.comparisons).toEqual(a.comparisons);
    expect(b.concepts.find((c) => c.conceptName === "Percentages")!.conceptMastery.simulation).toEqual(a.concepts.find((c) => c.conceptName === "Percentages")!.conceptMastery.simulation);
    void ms;
  });
});
