import type { AdaptiveCurriculum } from "@ipmat/adaptive-curriculum";
import type { FinalizedSimulationEvidence } from "@ipmat/exam-simulation";
import type { ConceptEvidenceView, MasteryEvidenceView } from "@ipmat/mastery";
import type { RevisionIntelligence } from "@ipmat/revision-intelligence";
import type { AutopsyQuestionContext } from "@ipmat/training-systems";

/**
 * Exam Simulation Intelligence + Readiness EVIDENCE (Phase 7 Unit 5, docs/DECISIONS.md D-091).
 *
 * WHAT IS SPECIFIED. `docs/PRODUCT_SPEC.md` section 3 ("the five readiness distinctions") says the product must be able to
 * separately measure and report five things - syllabus completion, concept mastery, question-pattern coverage, advanced
 * readiness, and four independently tracked performance axes (speed, accuracy, novelty-handling, pressure) - as DISTINCT,
 * queryable facts per (student, concept), "not folded into one number". That is the whole of the repository's definition of
 * readiness, and this layer reports exactly those five distinctions as separate observable facts, from separate sources.
 *
 * WHAT IS NOT. No threshold, category, verdict, probability, percentage, "ready / almost ready / not ready", prediction,
 * confidence, ability or psychological inference exists in the repository, so none is produced. Which difficulty tiers count
 * as "above exam difficulty", whether a timed simulation counts as "pressure performance", what counts as having "seen"
 * material, how simulations feed practice-based systems, and how simulations of different papers compare are all UNRESOLVED
 * and are reported as such (see `UNRESOLVED_READINESS_POLICY`), never decided here.
 */

export const READINESS_EVIDENCE_STATUS = "evidence_only_readiness_unspecified" as const;

/** The decisions this layer needs and the repository has not made. Carried on every report so none can be mistaken for a default. */
export const UNRESOLVED_READINESS_POLICY = [
  "Any readiness threshold, category, score, percentage or verdict (the specification names five separate distinctions and forbids folding them into one number).",
  "Which difficulty tiers count as 'above exam difficulty' for advanced readiness (outcomes are reported for every tier instead).",
  "Whether a timed simulation counts as 'pressure performance' (pressure is read only from the question's time_pressured testing mode, never from timing).",
  "What counts as having 'seen' the material for syllabus completion (practice attempts and simulation appearances are reported separately).",
  "Whether and how finalized simulation evidence may feed practice mastery evidence, revision signals, training systems or the curriculum (it is reported beside them and merged into none).",
  "How simulations of different papers or configurations compare (they are never compared; only identical-paper, identical-configuration simulations are).",
  "The marking scheme (none exists, so no simulation score exists to compare or aggregate).",
  "Whether exam date or preparation phase should change anything (no rule exists; none is applied).",
  "Limits on how many simulations a student takes, and how many are needed for any statement."
] as const;

// ---- one finalized simulation, as observed ----

export type QuestionOutcomeKind = "correct" | "incorrect" | "unanswered" | "not_graded";

export interface OutcomeCounts {
  appearances: number;
  answered: number;
  unanswered: number;
  correct: number;
  incorrect: number;
  /** Answered, but the question's content changed after the paper was fixed, so it was not graded. */
  notGraded: number;
}

export interface SimulationQuestionObservation {
  position: number;
  sectionName: string;
  questionId: string;
  outcome: QuestionOutcomeKind;
  answerChangeCount: number;
  /** Seconds from the simulation start to the first accepted answer, or `null` when unanswered. A timing fact only. */
  secondsToFirstAnswer: number | null;
  secondsToLastAnswer: number | null;
}

export interface SimulationPerformance {
  simulationId: string;
  configVersion: string;
  paperSourceRef: string;
  isHistoricalPaper: false;
  status: "submitted" | "expired";
  startedAt: string;
  finalizedAt: string;
  finalizedBy: "student_submit" | "deadline";
  allowedSeconds: number;
  elapsedSeconds: number;
  /** True when the deadline, not the student, ended it. A fact, not a judgment. */
  endedByDeadline: boolean;
  totals: FinalizedSimulationEvidence["totals"];
  sections: FinalizedSimulationEvidence["sections"];
  questions: readonly SimulationQuestionObservation[];
}

// ---- aggregation across finalized simulations, per dimension that exists in the contracts ----

export interface DimensionBucket extends OutcomeCounts {
  value: string;
  simulationIds: readonly string[];
  questionIds: readonly string[];
}

export const PERFORMANCE_DIMENSIONS = ["section", "concept", "patternFamily", "noveltyLevel", "testingMode", "difficultyTier", "trapCode"] as const;
export type PerformanceDimension = (typeof PERFORMANCE_DIMENSIONS)[number];

export interface QuestionExposureAcrossSimulations {
  questionId: string;
  /** Chronological. */
  simulationIds: readonly string[];
  outcomes: readonly { simulationId: string; finalizedAt: string; outcome: QuestionOutcomeKind }[];
}

export interface SeriesMeasure {
  measure: "answered" | "correct" | "incorrect" | "unanswered" | "notGraded" | "elapsedSeconds";
  values: readonly { simulationId: string; value: number }[];
  /** Last value minus first value - arithmetic only. Its sign is not interpreted. */
  difference: number;
  /** Factual phrasing, e.g. "correct: 5, then 7 (sim-a, then sim-b)". Never "improved" or "stronger". */
  description: string;
}

/** Simulations are compared ONLY within a group: same exam, same configuration version, same ordered paper. */
export interface ComparabilityGroup {
  groupId: string;
  configVersion: string;
  paperQuestionIds: readonly string[];
  /** Chronological by finalization. */
  simulationIds: readonly string[];
  /** Present only for 2 or more simulations. */
  series: readonly SeriesMeasure[];
}

export interface NotCompared {
  simulationId: string;
  reason: "only_simulation_with_this_paper_and_configuration";
}

export const SIMULATION_OBSERVATION_KINDS = [
  "trap_errors_in_simulations",
  "question_unanswered_in_multiple_simulations",
  "simulation_ended_by_deadline",
  "section_unanswered_questions",
  "pattern_family_absent_from_simulations"
] as const;
export type SimulationObservationKind = (typeof SIMULATION_OBSERVATION_KINDS)[number];

/** An objective fact about finalized simulations, defined by an exact count or absence. Never a judgment about the student. */
export interface SimulationObservation {
  id: string;
  kind: SimulationObservationKind;
  conceptName: string | null;
  subject: string | null;
  facts: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  simulationIds: readonly string[];
  questionIds: readonly string[];
  /** Unit 2 signals with the same subject that already exist from PRACTICE evidence (a transparent link, never a merge). */
  relatedRevisionSignalIds: readonly string[];
  explanation: string;
}

// ---- the five readiness distinctions, per concept, as separate facts ----

export interface PracticeCounts {
  attempts: number;
  gradedAttempts: number;
  correctGradedAttempts: number;
}

export interface ConceptReadinessEvidence {
  conceptName: string;
  /** 1. "Has the student seen the material?" Two sources, never merged; what counts as 'seen' is unresolved. */
  syllabusCompletion: {
    practice: { attempts: number; distinctQuestions: number };
    simulation: { questionsAppeared: number; questionsAnswered: number };
    publishedQuestionsInPool: number;
  };
  /** 2. "Can the student apply the concept correctly, observed over attempts?" Evidence only; Unit 1 is not rewritten. */
  conceptMastery: {
    practice: PracticeCounts & { skippedAttempts: number; distinctQuestions: number };
    simulation: OutcomeCounts;
    interpretation: "none";
  };
  /** 3. "Has the student handled the known legitimate ways this concept is tested?" Values with graded evidence per source, against the published pool. */
  questionPatternCoverage: {
    patternFamilies: ValueCoverage;
    noveltyLevels: ValueCoverage;
    testingModes: ValueCoverage;
  };
  /** 4. "Can the student handle above-exam-difficulty, trap and novel-presentation versions?" Outcomes per tier, trap and novelty; which tiers are 'above exam' is unresolved. */
  advancedReadiness: {
    byDifficultyTier: readonly { tier: string; practice: Omit<PracticeCounts, "attempts"> & { attempts: number }; simulation: OutcomeCounts }[];
    trapQuestions: { practice: PracticeCounts; simulation: OutcomeCounts };
    nonStandardNovelty: { practice: PracticeCounts; simulation: OutcomeCounts };
    aboveExamDifficultyMappingDefined: false;
  };
  /** 5. Four independent axes, never blended. */
  performanceAxes: {
    accuracy: { practice: { gradedAttempts: number; correct: number; incorrect: number }; simulation: { answered: number; correct: number; incorrect: number } };
    /** Practice timing observations exist in Unit 1 evidence; simulation timing is per simulation (see `simulations`). */
    speed: { practiceTimedGradedAttempts: number; simulationTimingAvailable: true };
    noveltyHandling: { practice: PracticeCounts; simulation: OutcomeCounts };
    pressurePerformance: { practiceTimePressuredQuestions: PracticeCounts; simulationTimePressuredQuestions: OutcomeCounts; simulationCountedAsPressure: "undefined" };
  };
  /** Phase 6 content and historical evidence, kept separate from performance. */
  examContent: {
    contentAvailability: { available: number; validated: number; published: number } | null;
    /** Reviewed historical records observed for the concept (an observation of what was tested, never a forecast). */
    historicalRecordsObserved: number | null;
  };
}

export interface ValueCoverage {
  /** Values the published pool offers for this concept. */
  inPool: readonly string[];
  withGradedPracticeEvidence: readonly string[];
  withAnsweredSimulationEvidence: readonly string[];
  /** In the pool, with neither graded practice evidence nor an answered simulation question. Absence of evidence, not a finding. */
  withoutEvidenceInEitherSource: readonly string[];
}

// ---- bridges to Units 1-3: read-only, nothing is rewritten, reordered or fed ----

export interface SimulationBridges {
  unit1: { rewritesMasteryEvidence: false; relationship: "simulation outcomes are reported beside practice evidence per concept and merged into none" };
  unit2: {
    revisionIntelligenceUnchanged: true;
    /** Observations that share a subject with an existing practice-derived signal. */
    linked: readonly { observationId: string; signalIds: readonly string[] }[];
    /** Observations no existing signal covers. */
    withoutExistingSignal: readonly string[];
  };
  unit3: {
    curriculumUnchanged: true;
    reorderingApplied: false;
    priorityDefined: false;
    /** What the existing curriculum would do, verbatim facts only. */
    existingNextAction: { status: string; actionType: string | null; providerId: string | null; questionId: string | null };
    /** Observations from simulations (what simulation evidence adds). */
    simulationAdds: readonly string[];
    /** Observations no existing training system is fed, with the reason. */
    unserved: readonly { observationId: string; reason: string; couldBeServedBy: string | null }[];
    missingDecisions: readonly string[];
  };
}

export interface ExamPerformanceIntelligence {
  /** Always this marker: evidence only; readiness itself is specified only as five separate distinctions. */
  status: typeof READINESS_EVIDENCE_STATUS;
  studentId: string;
  examCode: string;
  /** Always undefined: no score, percentage, probability, category or verdict exists, and none is computed. */
  readiness: { defined: false; specification: "docs/PRODUCT_SPEC.md section 3 (five distinctions, never one number)"; note: string };
  /** Observed facts: finalized simulations only. */
  simulations: readonly SimulationPerformance[];
  simulationCount: number;
  /** Aggregates per existing dimension, across finalized simulations. */
  dimensions: Readonly<Record<PerformanceDimension, readonly DimensionBucket[]>>;
  questionsWithoutDna: number;
  questionExposure: readonly QuestionExposureAcrossSimulations[];
  repeatedQuestionIds: readonly string[];
  /** Cross-simulation history, only within comparable groups. */
  comparisons: { groups: readonly ComparabilityGroup[]; notCompared: readonly NotCompared[]; note: string };
  /** Derived signals (each traceable to simulations and questions). */
  observations: readonly SimulationObservation[];
  /** The five distinctions, per concept. */
  concepts: readonly ConceptReadinessEvidence[];
  bridges: SimulationBridges;
  unresolved: readonly string[];
}

export interface ExamPerformanceInput {
  studentId: string;
  examCode: string;
  /** FINALIZED simulation evidence only (`toFinalizedSimulationEvidence`). Anything else is refused. */
  simulations: readonly FinalizedSimulationEvidence[];
  /** Question DNA of the exam's published, eligible pool. */
  publishedPool: readonly AutopsyQuestionContext[];
  /** Unit 1, 2 and 3 outputs for the same student and exam, consumed unchanged. */
  evidence: MasteryEvidenceView;
  revision: RevisionIntelligence;
  curriculum: AdaptiveCurriculum;
  /** Optional Phase 6 content and historical evidence per concept. */
  exam?: {
    contentAvailability?: Readonly<Record<string, { available: number; validated: number; published: number }>> | null;
    historicalRecordCounts?: Readonly<Record<string, number>> | null;
  };
}

export class SimulationIntelligenceError extends Error {
  readonly code: "not_finalized" | "scope_mismatch";
  constructor(code: SimulationIntelligenceError["code"], message: string) {
    super(message);
    this.name = "SimulationIntelligenceError";
    this.code = code;
  }
}

export type { ConceptEvidenceView };
