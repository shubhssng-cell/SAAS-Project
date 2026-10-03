import type { ConceptEvidenceView } from "@ipmat/mastery";
import type { AutopsyQuestionContext } from "@ipmat/training-systems";
import {
  addOutcome,
  aggregateDimensions,
  assertFinalizedEvidence,
  chronological,
  compareSimulations,
  deriveObservations,
  emptyCounts,
  questionExposure,
  toSimulationPerformance
} from "./performance.js";
import {
  PERFORMANCE_DIMENSIONS,
  READINESS_EVIDENCE_STATUS,
  SimulationIntelligenceError,
  UNRESOLVED_READINESS_POLICY,
  type ConceptReadinessEvidence,
  type ExamPerformanceInput,
  type ExamPerformanceIntelligence,
  type OutcomeCounts,
  type PracticeCounts,
  type SimulationBridges,
  type SimulationObservation,
  type SimulationPerformance,
  type ValueCoverage
} from "./types.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(cmp);

interface SimQuestion {
  sim: SimulationPerformance;
  q: SimulationPerformance["questions"][number];
  dna: AutopsyQuestionContext;
}

function simCounts(rows: readonly SimQuestion[]): OutcomeCounts {
  const c = emptyCounts();
  for (const r of rows) addOutcome(c, r.q.outcome);
  return c;
}

interface PracticeRow {
  attempts: number;
  gradedAttempts: number;
  correctGradedAttempts: number;
  dna: AutopsyQuestionContext;
}

function practiceCounts(rows: readonly PracticeRow[]): PracticeCounts {
  return { attempts: rows.reduce((s, r) => s + r.attempts, 0), gradedAttempts: rows.reduce((s, r) => s + r.gradedAttempts, 0), correctGradedAttempts: rows.reduce((s, r) => s + r.correctGradedAttempts, 0) };
}

function coverage(inPool: readonly string[], practice: readonly string[], simulation: readonly string[]): ValueCoverage {
  const pool = uniq(inPool);
  const p = uniq(practice);
  const s = uniq(simulation);
  const either = new Set([...p, ...s]);
  return { inPool: pool, withGradedPracticeEvidence: p, withAnsweredSimulationEvidence: s, withoutEvidenceInEitherSource: pool.filter((v) => !either.has(v)) };
}

const gradedKeys = (rec: Readonly<Record<string, { gradedAttempts: number }>> | Partial<Record<string, { gradedAttempts: number } | undefined>>): string[] =>
  Object.entries(rec).filter(([, b]) => b !== undefined && b.gradedAttempts > 0).map(([k]) => k);

/**
 * Builds the traceable readiness EVIDENCE for ONE student and exam from FINALIZED simulation evidence, Units 1-3 and optional
 * Phase 6 content evidence. Pure and deterministic: the same inputs, in any order, give the same output. It reports the five
 * readiness distinctions of docs/PRODUCT_SPEC.md section 3 as separate facts per concept and computes NO score, percentage,
 * probability, category, verdict, confidence, ability or prediction. Units 1-3 are consumed unchanged and nothing is merged into
 * them, reordered or fed back.
 */
export function buildExamPerformanceIntelligence(input: ExamPerformanceInput): ExamPerformanceIntelligence {
  const { studentId, examCode, evidence, revision, curriculum } = input;
  for (const [name, owner] of [["evidence", evidence], ["revision", revision], ["curriculum", curriculum]] as const) {
    if (owner.studentId !== studentId) throw new SimulationIntelligenceError("scope_mismatch", `The ${name} of another student was supplied.`);
    if (owner.examCode !== examCode) throw new SimulationIntelligenceError("scope_mismatch", `The ${name} of another exam was supplied.`);
  }

  // finalized-only boundary; a repeated simulation id is ONE piece of evidence
  const seen = new Set<string>();
  const finalized = input.simulations.filter((s) => {
    assertFinalizedEvidence(s, studentId, examCode);
    if (seen.has(s.simulationId)) return false;
    seen.add(s.simulationId);
    return true;
  });
  const performances = chronological(finalized.map(toSimulationPerformance));
  const paperById = new Map(finalized.map((s) => [s.simulationId, [...s.questions].sort((a, b) => a.position - b.position).map((q) => q.questionId)]));

  const dnaByQuestion = new Map(input.publishedPool.map((d) => [d.questionId, d]));
  const { dimensions, questionsWithoutDna } = aggregateDimensions(performances, dnaByQuestion, PERFORMANCE_DIMENSIONS);
  const exposure = questionExposure(performances);
  const comparisons = compareSimulations(performances, (id) => paperById.get(id) ?? []);
  const observations = deriveObservations({ performances, dnaByQuestion, publishedPool: input.publishedPool, revision });

  // ---- the five distinctions, per concept ----
  const simRows: SimQuestion[] = [];
  for (const sim of performances) for (const q of sim.questions) {
    const dna = dnaByQuestion.get(q.questionId);
    if (dna) simRows.push({ sim, q, dna });
  }
  const evidenceByConcept = new Map<string, ConceptEvidenceView>(evidence.concepts.map((c) => [c.conceptName, c]));
  const conceptNames = uniq([...evidenceByConcept.keys(), ...simRows.map((r) => r.dna.conceptName)]);

  const concepts: ConceptReadinessEvidence[] = conceptNames.map((conceptName) => {
    const ev = evidenceByConcept.get(conceptName);
    const sims = simRows.filter((r) => r.dna.conceptName === conceptName);
    const pool = input.publishedPool.filter((d) => d.conceptName === conceptName);
    const practiceRows: PracticeRow[] = (ev?.questions ?? []).flatMap((e) => {
      const dna = dnaByQuestion.get(e.questionId);
      return dna ? [{ attempts: e.attempts, gradedAttempts: e.gradedAttempts, correctGradedAttempts: e.correctGradedAttempts, dna }] : [];
    });
    const answered = sims.filter((r) => r.q.outcome !== "unanswered");
    const bySim = (pred: (d: AutopsyQuestionContext) => boolean): OutcomeCounts => simCounts(sims.filter((r) => pred(r.dna)));
    const byPractice = (pred: (d: AutopsyQuestionContext) => boolean): PracticeCounts => practiceCounts(practiceRows.filter((r) => pred(r.dna)));
    const tiers = uniq([...sims.map((r) => r.dna.difficultyTier), ...practiceRows.map((r) => r.dna.difficultyTier)]);
    const overall = ev?.overall;
    const nonStandard = (d: AutopsyQuestionContext): boolean => d.noveltyLevel !== "standard";

    return {
      conceptName,
      syllabusCompletion: {
        practice: { attempts: overall?.attempts ?? 0, distinctQuestions: overall?.distinctQuestions ?? 0 },
        simulation: { questionsAppeared: new Set(sims.map((r) => r.q.questionId)).size, questionsAnswered: new Set(answered.map((r) => r.q.questionId)).size },
        publishedQuestionsInPool: pool.length
      },
      conceptMastery: {
        practice: {
          attempts: overall?.attempts ?? 0,
          gradedAttempts: overall?.gradedAttempts ?? 0,
          correctGradedAttempts: overall?.correctGradedAttempts ?? 0,
          skippedAttempts: overall?.skippedAttempts ?? 0,
          distinctQuestions: overall?.distinctQuestions ?? 0
        },
        simulation: simCounts(sims),
        interpretation: "none"
      },
      questionPatternCoverage: {
        patternFamilies: coverage(pool.map((d) => d.patternFamilyName), gradedKeys(ev?.byPatternFamily ?? {}), answered.map((r) => r.dna.patternFamilyName)),
        noveltyLevels: coverage(pool.map((d) => d.noveltyLevel), gradedKeys(ev?.byNoveltyLevel ?? {}), answered.map((r) => r.dna.noveltyLevel)),
        testingModes: coverage(pool.flatMap((d) => d.testingModes), gradedKeys(ev?.byTestingMode ?? {}), answered.flatMap((r) => r.dna.testingModes))
      },
      advancedReadiness: {
        byDifficultyTier: tiers.map((tier) => ({ tier, practice: byPractice((d) => d.difficultyTier === tier), simulation: bySim((d) => d.difficultyTier === tier) })),
        trapQuestions: { practice: byPractice((d) => d.trapErrorTaxonomyCode !== null), simulation: bySim((d) => d.trapErrorTaxonomyCode !== null) },
        nonStandardNovelty: { practice: byPractice(nonStandard), simulation: bySim(nonStandard) },
        aboveExamDifficultyMappingDefined: false
      },
      performanceAxes: {
        accuracy: {
          practice: { gradedAttempts: overall?.gradedAttempts ?? 0, correct: overall?.correctGradedAttempts ?? 0, incorrect: overall?.incorrectGradedAttempts ?? 0 },
          simulation: { answered: simCounts(sims).answered, correct: simCounts(sims).correct, incorrect: simCounts(sims).incorrect }
        },
        speed: { practiceTimedGradedAttempts: overall?.timedObservations.length ?? 0, simulationTimingAvailable: true },
        noveltyHandling: { practice: byPractice(nonStandard), simulation: bySim(nonStandard) },
        pressurePerformance: {
          practiceTimePressuredQuestions: byPractice((d) => d.testingModes.includes("time_pressured")),
          simulationTimePressuredQuestions: bySim((d) => d.testingModes.includes("time_pressured")),
          simulationCountedAsPressure: "undefined"
        }
      },
      examContent: {
        contentAvailability: input.exam?.contentAvailability?.[conceptName] ?? null,
        historicalRecordsObserved: input.exam?.historicalRecordCounts?.[conceptName] ?? null
      }
    };
  });

  // ---- bridges: read-only; nothing is merged, reordered or fed ----
  const linked = observations.filter((o) => o.relatedRevisionSignalIds.length > 0).map((o) => ({ observationId: o.id, signalIds: o.relatedRevisionSignalIds }));
  const next = curriculum.nextAction;
  const NOT_FED = "Existing training systems read practice attempts only; whether simulation evidence may feed them is an unresolved product decision.";
  const couldServe = (o: SimulationObservation): string | null => (o.kind === "trap_errors_in_simulations" && o.facts.meetsExistingRecurrenceMinimum === true ? "trap-lab" : null);
  const bridges: SimulationBridges = {
    unit1: { rewritesMasteryEvidence: false, relationship: "simulation outcomes are reported beside practice evidence per concept and merged into none" },
    unit2: { revisionIntelligenceUnchanged: true, linked, withoutExistingSignal: observations.filter((o) => o.relatedRevisionSignalIds.length === 0).map((o) => o.id) },
    unit3: {
      curriculumUnchanged: true,
      reorderingApplied: false,
      priorityDefined: false,
      existingNextAction:
        next.status === "selected"
          ? { status: "selected", actionType: next.actionType, providerId: next.providerId, questionId: next.question.questionId }
          : { status: "no_action", actionType: null, providerId: null, questionId: null },
      simulationAdds: observations.map((o) => o.id),
      unserved: observations.map((o) => ({ observationId: o.id, reason: NOT_FED, couldBeServedBy: couldServe(o) })),
      missingDecisions: [UNRESOLVED_READINESS_POLICY[4], UNRESOLVED_READINESS_POLICY[0]]
    }
  };

  return {
    status: READINESS_EVIDENCE_STATUS,
    studentId,
    examCode,
    readiness: {
      defined: false,
      specification: "docs/PRODUCT_SPEC.md section 3 (five distinctions, never one number)",
      note: "Readiness is specified only as five separate observable facts; no threshold, category, score, probability or verdict exists, so none is computed."
    },
    simulations: performances,
    simulationCount: performances.length,
    dimensions,
    questionsWithoutDna,
    questionExposure: exposure,
    repeatedQuestionIds: exposure.filter((e) => e.simulationIds.length >= 2).map((e) => e.questionId),
    comparisons: {
      groups: comparisons.groups,
      notCompared: comparisons.notCompared,
      note: "Only simulations with the same configuration version and the same ordered paper are compared; no marking scheme exists, so no score is compared."
    },
    observations,
    concepts,
    bridges,
    unresolved: UNRESOLVED_READINESS_POLICY
  };
}
