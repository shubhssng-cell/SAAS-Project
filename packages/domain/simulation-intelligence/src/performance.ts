import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import type { FinalizedSimulationEvidence } from "@ipmat/exam-simulation";
import type { RevisionIntelligence } from "@ipmat/revision-intelligence";
import type { AutopsyQuestionContext } from "@ipmat/training-systems";
import {
  SimulationIntelligenceError,
  type ComparabilityGroup,
  type DimensionBucket,
  type NotCompared,
  type OutcomeCounts,
  type PerformanceDimension,
  type QuestionExposureAcrossSimulations,
  type QuestionOutcomeKind,
  type SeriesMeasure,
  type SimulationObservation,
  type SimulationPerformance,
  type SimulationQuestionObservation
} from "./types.js";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const emptyCounts = (): OutcomeCounts => ({ appearances: 0, answered: 0, unanswered: 0, correct: 0, incorrect: 0, notGraded: 0 });

export function addOutcome(counts: OutcomeCounts, outcome: QuestionOutcomeKind): void {
  counts.appearances += 1;
  if (outcome === "unanswered") counts.unanswered += 1;
  else {
    counts.answered += 1;
    if (outcome === "correct") counts.correct += 1;
    else if (outcome === "incorrect") counts.incorrect += 1;
    else counts.notGraded += 1;
  }
}

/**
 * The finalized-only boundary. A simulation is refused unless it is a `finalized_simulation_evidence_v1` of a finalized status
 * (`submitted` or `expired`) belonging to this student and this exam. An active, abandoned or partially answered simulation can
 * never reach this layer: its evidence type does not exist (`toFinalizedSimulationEvidence` refuses it) and this guard
 * re-checks at runtime.
 */
export function assertFinalizedEvidence(sim: FinalizedSimulationEvidence, studentId: string, examCode: string): void {
  const status = (sim as { status?: string }).status;
  if (sim.contract !== "finalized_simulation_evidence_v1" || (status !== "submitted" && status !== "expired")) {
    throw new SimulationIntelligenceError("not_finalized", "Only finalized simulation evidence is accepted.");
  }
  if (sim.studentId !== studentId) throw new SimulationIntelligenceError("scope_mismatch", "A simulation of another student was supplied.");
  if (sim.examCode !== examCode) throw new SimulationIntelligenceError("scope_mismatch", "A simulation of another exam was supplied.");
}

function outcomeOf(q: FinalizedSimulationEvidence["questions"][number]): QuestionOutcomeKind {
  if (!q.answered) return "unanswered";
  if (q.isCorrect === true) return "correct";
  if (q.isCorrect === false) return "incorrect";
  return "not_graded";
}

const secondsBetween = (fromIso: string, toIso: string | null): number | null => (toIso === null ? null : Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 1000));

/** Chronological order: by finalization time, then id. The only ordering used across simulations. */
export function chronological<T extends { finalizedAt: string; simulationId: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(a.finalizedAt) - Date.parse(b.finalizedAt) || cmp(a.simulationId, b.simulationId));
}

export function toSimulationPerformance(sim: FinalizedSimulationEvidence): SimulationPerformance {
  const questions: SimulationQuestionObservation[] = [...sim.questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => ({
      position: q.position,
      sectionName: q.sectionName,
      questionId: q.questionId,
      outcome: outcomeOf(q),
      answerChangeCount: q.answerChangeCount,
      secondsToFirstAnswer: secondsBetween(sim.timing.startedAt, q.firstAnsweredAt),
      secondsToLastAnswer: secondsBetween(sim.timing.startedAt, q.lastAnsweredAt)
    }));
  return {
    simulationId: sim.simulationId,
    configVersion: sim.configVersion,
    paperSourceRef: sim.paperSourceRef,
    isHistoricalPaper: false,
    status: sim.status,
    startedAt: sim.timing.startedAt,
    finalizedAt: sim.timing.finalizedAt,
    finalizedBy: sim.timing.finalizedBy,
    allowedSeconds: sim.timing.allowedSeconds,
    elapsedSeconds: sim.timing.elapsedSeconds,
    endedByDeadline: sim.timing.finalizedBy === "deadline",
    totals: sim.totals,
    sections: sim.sections,
    questions
  };
}

// ---- aggregation per dimension that exists in the underlying contracts ----

type Accumulator = { counts: OutcomeCounts; sims: Set<string>; questions: Set<string> };

/** Values a question contributes to each dimension. Dimensions that need Question DNA are skipped when the question has none. */
function valuesFor(dimension: PerformanceDimension, q: SimulationQuestionObservation, dna: AutopsyQuestionContext | undefined): string[] {
  if (dimension === "section") return [q.sectionName];
  if (!dna) return [];
  switch (dimension) {
    case "concept":
      return [dna.conceptName];
    case "patternFamily":
      return [dna.patternFamilyName];
    case "noveltyLevel":
      return [dna.noveltyLevel];
    case "testingMode":
      return [...new Set(dna.testingModes)];
    case "difficultyTier":
      return [dna.difficultyTier];
    case "trapCode":
      return dna.trapErrorTaxonomyCode === null ? [] : [dna.trapErrorTaxonomyCode];
    default:
      return [];
  }
}

export function aggregateDimensions(performances: readonly SimulationPerformance[], dnaByQuestion: ReadonlyMap<string, AutopsyQuestionContext>, dimensions: readonly PerformanceDimension[]): { dimensions: Record<PerformanceDimension, DimensionBucket[]>; questionsWithoutDna: number } {
  const out = {} as Record<PerformanceDimension, DimensionBucket[]>;
  const missing = new Set<string>();
  for (const dimension of dimensions) {
    const acc = new Map<string, Accumulator>();
    for (const sim of performances) {
      for (const q of sim.questions) {
        const dna = dnaByQuestion.get(q.questionId);
        if (!dna && dimension !== "section") missing.add(q.questionId);
        for (const value of valuesFor(dimension, q, dna)) {
          const a = acc.get(value) ?? { counts: emptyCounts(), sims: new Set<string>(), questions: new Set<string>() };
          addOutcome(a.counts, q.outcome);
          a.sims.add(sim.simulationId);
          a.questions.add(q.questionId);
          acc.set(value, a);
        }
      }
    }
    out[dimension] = [...acc.keys()].sort(cmp).map((value) => {
      const a = acc.get(value)!;
      return { value, ...a.counts, simulationIds: [...a.sims].sort(cmp), questionIds: [...a.questions].sort(cmp) };
    });
  }
  return { dimensions: out, questionsWithoutDna: missing.size };
}

export function questionExposure(performances: readonly SimulationPerformance[]): QuestionExposureAcrossSimulations[] {
  const byQuestion = new Map<string, Array<{ simulationId: string; finalizedAt: string; outcome: QuestionOutcomeKind }>>();
  for (const sim of chronological(performances)) {
    for (const q of sim.questions) {
      const list = byQuestion.get(q.questionId) ?? [];
      list.push({ simulationId: sim.simulationId, finalizedAt: sim.finalizedAt, outcome: q.outcome });
      byQuestion.set(q.questionId, list);
    }
  }
  return [...byQuestion.keys()].sort(cmp).map((questionId) => {
    const outcomes = byQuestion.get(questionId)!;
    return { questionId, simulationIds: outcomes.map((o) => o.simulationId), outcomes };
  });
}

// ---- cross-simulation history: only within comparable groups ----

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const MEASURES: ReadonlyArray<SeriesMeasure["measure"]> = ["answered", "correct", "incorrect", "unanswered", "notGraded", "elapsedSeconds"];

function valueOf(sim: SimulationPerformance, measure: SeriesMeasure["measure"]): number {
  return measure === "elapsedSeconds" ? sim.elapsedSeconds : sim.totals[measure];
}

/**
 * Groups simulations that are genuinely comparable - the same exam (already enforced), the SAME configuration version and
 * the SAME ordered paper - and reports factual series within each group of two or more. Anything else is never compared: a
 * different paper or configuration changes what the numbers mean, and no marking scheme exists to normalise them.
 */
export function compareSimulations(performances: readonly SimulationPerformance[], paperOf: (simulationId: string) => readonly string[]): { groups: ComparabilityGroup[]; notCompared: NotCompared[] } {
  const buckets = new Map<string, SimulationPerformance[]>();
  for (const sim of performances) {
    const key = `${sim.configVersion}\n${paperOf(sim.simulationId).join(",")}`;
    const list = buckets.get(key) ?? [];
    list.push(sim);
    buckets.set(key, list);
  }
  const groups: ComparabilityGroup[] = [];
  const notCompared: NotCompared[] = [];
  for (const [key, sims] of buckets) {
    const ordered = chronological(sims);
    if (ordered.length < 2) {
      notCompared.push({ simulationId: ordered[0]!.simulationId, reason: "only_simulation_with_this_paper_and_configuration" });
      continue;
    }
    const series: SeriesMeasure[] = MEASURES.map((measure) => {
      const values = ordered.map((s) => ({ simulationId: s.simulationId, value: valueOf(s, measure) }));
      return {
        measure,
        values,
        difference: values[values.length - 1]!.value - values[0]!.value,
        description: `${measure}: ${values.map((v) => v.value).join(", then ")} (${values.map((v) => v.simulationId).join(", then ")})`
      };
    });
    groups.push({ groupId: `paper-${fnv1a(key)}`, configVersion: ordered[0]!.configVersion, paperQuestionIds: paperOf(ordered[0]!.simulationId), simulationIds: ordered.map((s) => s.simulationId), series });
  }
  groups.sort((a, b) => cmp(a.simulationIds[0]!, b.simulationIds[0]!));
  notCompared.sort((a, b) => cmp(a.simulationId, b.simulationId));
  return { groups, notCompared };
}

// ---- observations: exact facts, each traceable ----

interface ObservationInput {
  performances: readonly SimulationPerformance[];
  dnaByQuestion: ReadonlyMap<string, AutopsyQuestionContext>;
  publishedPool: readonly AutopsyQuestionContext[];
  revision: RevisionIntelligence;
}

const MIN_REPEAT = AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT;

export function deriveObservations(input: ObservationInput): SimulationObservation[] {
  const { performances, dnaByQuestion, publishedPool, revision } = input;
  const signalIds = new Set(revision.signals.map((s) => s.id));
  const link = (id: string): string[] => (signalIds.has(id) ? [id] : []);
  const out: SimulationObservation[] = [];

  // trap errors: distinct questions answered incorrectly that carry a designed trap code (the existing recurrence rule's constant is reused to say whether the existing rule's minimum is met)
  const trap = new Map<string, { questions: Set<string>; sims: Set<string>; concepts: Set<string> }>();
  for (const sim of performances) {
    for (const q of sim.questions) {
      const dna = dnaByQuestion.get(q.questionId);
      if (q.outcome !== "incorrect" || !dna || dna.trapErrorTaxonomyCode === null) continue;
      const t = trap.get(dna.trapErrorTaxonomyCode) ?? { questions: new Set<string>(), sims: new Set<string>(), concepts: new Set<string>() };
      t.questions.add(q.questionId);
      t.sims.add(sim.simulationId);
      t.concepts.add(dna.conceptName);
      trap.set(dna.trapErrorTaxonomyCode, t);
    }
  }
  for (const code of [...trap.keys()].sort(cmp)) {
    const t = trap.get(code)!;
    out.push({
      id: `trap_errors_in_simulations|*|${code}`,
      kind: "trap_errors_in_simulations",
      conceptName: null,
      subject: code,
      facts: { distinctIncorrectQuestions: t.questions.size, meetsExistingRecurrenceMinimum: t.questions.size >= MIN_REPEAT, existingRecurrenceMinimum: MIN_REPEAT, conceptsInvolved: [...t.concepts].sort(cmp) },
      simulationIds: [...t.sims].sort(cmp),
      questionIds: [...t.questions].sort(cmp),
      relatedRevisionSignalIds: link(`recurring_trap_failure|*|${code}`),
      explanation: `${t.questions.size} distinct questions designed around the same trap were answered incorrectly in finalized simulations.`
    });
  }

  // a question left unanswered in several finalized simulations
  const exposure = questionExposure(performances);
  for (const e of exposure) {
    const unanswered = e.outcomes.filter((o) => o.outcome === "unanswered");
    if (unanswered.length < MIN_REPEAT) continue;
    out.push({
      id: `question_unanswered_in_multiple_simulations|*|${e.questionId}`,
      kind: "question_unanswered_in_multiple_simulations",
      conceptName: dnaByQuestion.get(e.questionId)?.conceptName ?? null,
      subject: e.questionId,
      facts: { simulationsWhereUnanswered: unanswered.length, simulationsWhereItAppeared: e.outcomes.length, existingRepeatMinimum: MIN_REPEAT },
      simulationIds: unanswered.map((o) => o.simulationId),
      questionIds: [e.questionId],
      relatedRevisionSignalIds: [],
      explanation: `The question appeared in ${e.outcomes.length} finalized simulations and was left unanswered in ${unanswered.length}.`
    });
  }

  // simulations ended by the deadline, with how many questions were unanswered
  for (const sim of chronological(performances)) {
    if (!sim.endedByDeadline) continue;
    out.push({
      id: `simulation_ended_by_deadline|*|${sim.simulationId}`,
      kind: "simulation_ended_by_deadline",
      conceptName: null,
      subject: sim.simulationId,
      facts: { unansweredAtFinalization: sim.totals.unanswered, answered: sim.totals.answered, allowedSeconds: sim.allowedSeconds },
      simulationIds: [sim.simulationId],
      questionIds: sim.questions.filter((q) => q.outcome === "unanswered").map((q) => q.questionId),
      relatedRevisionSignalIds: [],
      explanation: `The deadline ended the simulation with ${sim.totals.unanswered} of ${sim.totals.questionCount} questions unanswered.`
    });
  }

  // sections with unanswered questions at finalization
  for (const sim of chronological(performances)) {
    for (const s of sim.sections) {
      if (s.unanswered === 0) continue;
      out.push({
        id: `section_unanswered_questions|${s.sectionName}|${sim.simulationId}`,
        kind: "section_unanswered_questions",
        conceptName: null,
        subject: `${s.sectionName}`,
        facts: { unanswered: s.unanswered, questionCount: s.questionCount, sectionName: s.sectionName },
        simulationIds: [sim.simulationId],
        questionIds: sim.questions.filter((q) => q.sectionName === s.sectionName && q.outcome === "unanswered").map((q) => q.questionId),
        relatedRevisionSignalIds: [],
        explanation: `${s.unanswered} of ${s.questionCount} questions in section "${s.sectionName}" were unanswered at finalization.`
      });
    }
  }

  // pattern families the published pool offers (for concepts that appeared in a simulation) but that no finalized simulation contained
  const simulatedConcepts = new Set<string>();
  const simulatedFamilies = new Set<string>();
  for (const sim of performances) {
    for (const q of sim.questions) {
      const dna = dnaByQuestion.get(q.questionId);
      if (!dna) continue;
      simulatedConcepts.add(dna.conceptName);
      simulatedFamilies.add(`${dna.conceptName}\n${dna.patternFamilyName}`);
    }
  }
  const poolFamilies = new Set<string>();
  for (const dna of publishedPool) if (simulatedConcepts.has(dna.conceptName)) poolFamilies.add(`${dna.conceptName}\n${dna.patternFamilyName}`);
  for (const key of [...poolFamilies].sort(cmp)) {
    if (simulatedFamilies.has(key)) continue;
    const [concept, family] = key.split("\n") as [string, string];
    out.push({
      id: `pattern_family_absent_from_simulations|${concept}|${family}`,
      kind: "pattern_family_absent_from_simulations",
      conceptName: concept,
      subject: family,
      facts: { publishedQuestionsOfThisFamily: publishedPool.filter((d) => d.conceptName === concept && d.patternFamilyName === family).length },
      simulationIds: [],
      questionIds: [],
      relatedRevisionSignalIds: link(`pattern_family_without_graded_evidence|${concept}|${family}`),
      explanation: `The published pool offers this pattern family for "${concept}", but no finalized simulation contained a question of it.`
    });
  }
  return out.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.id, b.id));
}
