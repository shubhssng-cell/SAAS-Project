import type { NoveltyLevel } from "@ipmat/question-engine";
import type { MasteryAttemptRecord } from "./types.js";

/**
 * Mastery EVIDENCE view (Phase 7 Unit 1, docs/DECISIONS.md D-087).
 *
 * EVIDENCE ONLY. Nothing in this file states, labels, scores, thresholds or
 * unlocks anything: there is no "mastered", no category, no composite number,
 * no inferred mental state, no prediction, no recency/decay, no prerequisite
 * propagation, no repair/diagnosis weighting, no Revision rule and no
 * speed-to-mastery rule. It re-presents the observable per-attempt facts the
 * existing `@ipmat/mastery` input already carries, separated into the
 * dimensions a future, explicitly specified mastery model could use, with an
 * auditable list of exactly which attempts each count came from.
 *
 * Pure and derived: recomputed from the supplied records on every call, never
 * stored (the same "derive, don't cache" discipline as `MasteryState`). The
 * existing five-measure `computeMasteryState()` is unchanged; attempt counts
 * here are reported ALONGSIDE distinct-question counts, never instead of them.
 */

/** Always this value: a marker that the view makes no mastery judgment. */
export const MASTERY_EVIDENCE_STATUS = "evidence_only" as const;

/** One graded attempt's time facts, kept paired with its correctness and never interpreted. */
export interface TimedObservation {
  attemptId: string;
  isCorrect: boolean;
  observedSeconds: number;
  expectedSeconds: number | null;
}

/** Counts for one slice of one concept's evidence. Skips/abandons/ungraded are NEVER folded into graded counts. */
export interface EvidenceBucket {
  /** Every contributing attempt: gradedAttempts + skippedAttempts + abandonedAttempts + ungradedAttempts. */
  attempts: number;
  /** Submitted with a recorded correctness (true/false). The only attempts that carry a correct/incorrect observation. */
  gradedAttempts: number;
  correctGradedAttempts: number;
  incorrectGradedAttempts: number;
  skippedAttempts: number;
  abandonedAttempts: number;
  /** Submitted but with no recorded correctness - neither correct nor incorrect, kept separate. */
  ungradedAttempts: number;
  /** Distinct question ids across ALL contributing attempts (repeats collapsed). Never a substitute for `attempts`. */
  distinctQuestions: number;
  /** Distinct question ids with at least one graded attempt. */
  distinctGradedQuestions: number;
  /** Distinct question ids that were skipped at least once. */
  distinctSkippedQuestions: number;
  /** Time facts for graded attempts that recorded an observed time; correctness is kept alongside, no ratio or verdict. */
  timedObservations: TimedObservation[];
  /** Audit: every contributing attemptId, chronological (finalizedAt, then attemptId). */
  contributingAttemptIds: string[];
}

/** How often one question was encountered - repeated exposure stays visible and is never counted as breadth. */
export interface QuestionExposure {
  questionId: string;
  patternFamilyName: string;
  attempts: number;
  gradedAttempts: number;
  correctGradedAttempts: number;
  skippedAttempts: number;
  abandonedAttempts: number;
  ungradedAttempts: number;
}

export interface ConceptEvidenceView {
  conceptName: string;
  /** All of this concept's evidence. */
  overall: EvidenceBucket;
  /**
   * Evidence indexed by dimension. Each attempt appears in exactly one pattern-family bucket and exactly one
   * novelty bucket; in EVERY testing-mode bucket its question lists (modes overlap, so mode buckets do not sum
   * to `overall`). Keys are sorted; a value never encountered simply has no key (absence is not zero).
   */
  byPatternFamily: Record<string, EvidenceBucket>;
  byNoveltyLevel: Partial<Record<NoveltyLevel, EvidenceBucket>>;
  byTestingMode: Record<string, EvidenceBucket>;
  /** One entry per distinct question, ordered by question id. */
  questions: QuestionExposure[];
}

export interface EvidenceExclusions {
  /** Records whose contribution belongs to a different student. */
  otherStudent: number;
  /** Records whose question belongs to a different exam. */
  otherExam: number;
  /** Records whose concept is not in the supplied exam concept universe (only when a universe is supplied). */
  outsideConceptUniverse: number;
  /** Repeat records of an attempt id already counted: an attempt is ONE piece of evidence. */
  duplicateAttemptRecords: number;
}

export interface MasteryEvidenceView {
  /** Always "evidence_only": this view contains no mastery judgment. */
  status: typeof MASTERY_EVIDENCE_STATUS;
  studentId: string;
  examCode: string;
  /** One entry per concept, sorted by concept name. With a supplied universe, concepts without evidence appear with empty buckets. */
  concepts: ConceptEvidenceView[];
  /** How many input records were excluded and why - nothing is dropped silently. */
  excluded: EvidenceExclusions;
  /** Records that became evidence. */
  includedAttempts: number;
}

export interface EvidenceScope {
  studentId: string;
  examCode: string;
  /** Optional exam concept universe (names from the Exam Pack, supplied by the caller - never copied or redefined here). */
  conceptNames?: readonly string[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function finalizedMs(record: MasteryAttemptRecord): number {
  const parsed = record.contribution.finalizedAt ? Date.parse(record.contribution.finalizedAt) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function chronological(records: MasteryAttemptRecord[]): MasteryAttemptRecord[] {
  return [...records].sort((a, b) => finalizedMs(a) - finalizedMs(b) || cmp(a.contribution.attemptId, b.contribution.attemptId));
}

function isGraded(record: MasteryAttemptRecord): boolean {
  return record.contribution.status === "submitted" && typeof record.contribution.isCorrect === "boolean";
}

function buildBucket(records: MasteryAttemptRecord[]): EvidenceBucket {
  const ordered = chronological(records);
  const all = new Set<string>();
  const graded = new Set<string>();
  const skipped = new Set<string>();
  const bucket: EvidenceBucket = {
    attempts: 0,
    gradedAttempts: 0,
    correctGradedAttempts: 0,
    incorrectGradedAttempts: 0,
    skippedAttempts: 0,
    abandonedAttempts: 0,
    ungradedAttempts: 0,
    distinctQuestions: 0,
    distinctGradedQuestions: 0,
    distinctSkippedQuestions: 0,
    timedObservations: [],
    contributingAttemptIds: []
  };
  for (const record of ordered) {
    const { contribution } = record;
    bucket.attempts += 1;
    bucket.contributingAttemptIds.push(contribution.attemptId);
    all.add(contribution.questionId);
    if (contribution.status === "skipped") {
      bucket.skippedAttempts += 1;
      skipped.add(contribution.questionId);
    } else if (contribution.status === "abandoned") {
      bucket.abandonedAttempts += 1;
    } else if (isGraded(record)) {
      bucket.gradedAttempts += 1;
      graded.add(contribution.questionId);
      if (contribution.isCorrect === true) bucket.correctGradedAttempts += 1;
      else bucket.incorrectGradedAttempts += 1;
      const observed = contribution.timeTakenSeconds;
      if (observed !== null && Number.isFinite(observed) && observed >= 0) {
        const expected = contribution.expectedTimeSeconds;
        bucket.timedObservations.push({
          attemptId: contribution.attemptId,
          isCorrect: contribution.isCorrect === true,
          observedSeconds: observed,
          expectedSeconds: expected !== null && Number.isFinite(expected) && expected > 0 ? expected : null
        });
      }
    } else {
      bucket.ungradedAttempts += 1;
    }
  }
  bucket.distinctQuestions = all.size;
  bucket.distinctGradedQuestions = graded.size;
  bucket.distinctSkippedQuestions = skipped.size;
  return bucket;
}

function groupBy(records: MasteryAttemptRecord[], keysOf: (record: MasteryAttemptRecord) => string[]): Map<string, MasteryAttemptRecord[]> {
  const groups = new Map<string, MasteryAttemptRecord[]>();
  for (const record of records) {
    for (const key of new Set(keysOf(record))) {
      const list = groups.get(key);
      if (list) list.push(record);
      else groups.set(key, [record]);
    }
  }
  return groups;
}

function bucketsByKey(records: MasteryAttemptRecord[], keysOf: (record: MasteryAttemptRecord) => string[]): Record<string, EvidenceBucket> {
  const out: Record<string, EvidenceBucket> = {};
  for (const key of [...groupBy(records, keysOf).keys()].sort(cmp)) out[key] = buildBucket(groupBy(records, keysOf).get(key)!);
  return out;
}

function exposures(records: MasteryAttemptRecord[]): QuestionExposure[] {
  const byQuestion = groupBy(records, (record) => [record.contribution.questionId]);
  return [...byQuestion.keys()].sort(cmp).map((questionId) => {
    const mine = byQuestion.get(questionId)!;
    const bucket = buildBucket(mine);
    return {
      questionId,
      patternFamilyName: mine[0]!.question.patternFamilyName,
      attempts: bucket.attempts,
      gradedAttempts: bucket.gradedAttempts,
      correctGradedAttempts: bucket.correctGradedAttempts,
      skippedAttempts: bucket.skippedAttempts,
      abandonedAttempts: bucket.abandonedAttempts,
      ungradedAttempts: bucket.ungradedAttempts
    };
  });
}

function conceptView(conceptName: string, records: MasteryAttemptRecord[]): ConceptEvidenceView {
  const novelty = bucketsByKey(records, (record) => [record.question.noveltyLevel]);
  return {
    conceptName,
    overall: buildBucket(records),
    byPatternFamily: bucketsByKey(records, (record) => [record.question.patternFamilyName]),
    byNoveltyLevel: novelty as Partial<Record<NoveltyLevel, EvidenceBucket>>,
    byTestingMode: bucketsByKey(records, (record) => record.question.testingModes),
    questions: exposures(records)
  };
}

/**
 * Builds the evidence view for ONE student in ONE exam from attempt records. Pure and deterministic: the same
 * records in any order give the same view. Records for another student or another exam are excluded and counted,
 * never merged; a repeated attempt id is one piece of evidence.
 */
export function buildMasteryEvidenceView(records: readonly MasteryAttemptRecord[], scope: EvidenceScope): MasteryEvidenceView {
  const excluded: EvidenceExclusions = { otherStudent: 0, otherExam: 0, outsideConceptUniverse: 0, duplicateAttemptRecords: 0 };
  const universe = scope.conceptNames === undefined ? null : new Set(scope.conceptNames);
  const seen = new Set<string>();
  const kept = new Map<string, MasteryAttemptRecord[]>();
  let included = 0;

  for (const record of chronological([...records])) {
    if (record.contribution.studentId !== scope.studentId) {
      excluded.otherStudent += 1;
      continue;
    }
    if (record.question.examCode !== scope.examCode) {
      excluded.otherExam += 1;
      continue;
    }
    const concept = record.question.conceptName;
    if (universe !== null && !universe.has(concept)) {
      excluded.outsideConceptUniverse += 1;
      continue;
    }
    if (seen.has(record.contribution.attemptId)) {
      excluded.duplicateAttemptRecords += 1;
      continue;
    }
    seen.add(record.contribution.attemptId);
    included += 1;
    const list = kept.get(concept);
    if (list) list.push(record);
    else kept.set(concept, [record]);
  }

  const names = new Set<string>([...kept.keys(), ...(universe ?? [])]);
  return {
    status: MASTERY_EVIDENCE_STATUS,
    studentId: scope.studentId,
    examCode: scope.examCode,
    concepts: [...names].sort(cmp).map((name) => conceptView(name, kept.get(name) ?? [])),
    excluded,
    includedAttempts: included
  };
}
