import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import type { MasteryEvidenceView } from "@ipmat/mastery";
import { deriveConceptDormancies, DORMANCY_MS, MS_PER_DAY, REVISION_CONSTANTS } from "@ipmat/revision-training";
import { computeTrapAssociatedFailureRecurrence } from "@ipmat/trap-lab";
import type { MasteryAttemptRecord, TrainingSystemContext } from "@ipmat/training-systems";
import { RevisionIntelligenceError, type RevisionSignal, type RevisionSignalKind } from "./types.js";

/** One fixed definition per kind. The text never varies with the data. */
export const SIGNAL_DEFINITIONS: Readonly<Record<RevisionSignalKind, string>> = {
  dormant_concept:
    "Revision's own rule (D-081): the concept has at least the minimum number of graded attempts and its most recent graded attempt is at least the dormancy interval old at the supplied evaluation time. Correctness is irrelevant.",
  recurring_trap_failure:
    "Trap Lab's own rule (D-078): at least the minimum count of DISTINCT questions carrying the same designed trap code were answered incorrectly. Aggregated across concepts; correct attempts never cancel it.",
  attempts_exceed_distinct_questions: "The concept has more attempts than distinct questions, i.e. at least one question was attempted more than once. A fact about exposure, not about performance.",
  pattern_family_without_graded_evidence:
    "The published pool offers a question of this pattern family for a concept the student has graded evidence on, but the student has no graded attempt on any question of this pattern family. Absence of evidence, not a finding about the student.",
  novelty_level_without_graded_evidence:
    "The published pool offers a question of this novelty level for a concept the student has graded evidence on, but the student has no graded attempt at this novelty level. Absence of evidence, not a finding about the student.",
  testing_mode_without_graded_evidence:
    "The published pool offers a question with this testing mode for a concept the student has graded evidence on, but the student has no graded attempt on a question with this testing mode. Absence of evidence, not a finding about the student."
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function chronologicalIds(records: readonly MasteryAttemptRecord[]): string[] {
  const ms = (r: MasteryAttemptRecord): number => {
    const parsed = r.contribution.finalizedAt ? Date.parse(r.contribution.finalizedAt) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...records].sort((a, b) => ms(a) - ms(b) || cmp(a.contribution.attemptId, b.contribution.attemptId)).map((r) => r.contribution.attemptId);
}

const isGraded = (r: MasteryAttemptRecord): boolean => r.contribution.status === "submitted" && typeof r.contribution.isCorrect === "boolean";

function signal(kind: RevisionSignalKind, dimension: RevisionSignal["dimension"], conceptName: string | null, subject: string | null, facts: RevisionSignal["facts"], attemptIds: readonly string[], explanation: string): RevisionSignal {
  return {
    id: `${kind}|${conceptName ?? "*"}|${subject ?? "*"}`,
    kind,
    dimension,
    conceptName,
    subject,
    definition: SIGNAL_DEFINITIONS[kind],
    facts,
    contributingAttemptIds: attemptIds,
    explanation
  };
}

/**
 * Derives the revision signals from the Unit 1 evidence view and the same context the existing training providers
 * consume. Pure and deterministic; the same inputs (in any order) give the same signals in the same order. No signal
 * is a verdict, score or priority, and no new threshold is introduced: every kind is either an exact count/absence or
 * a reuse of an existing provider's own, already-documented rule and constant.
 *
 * Scope: the evidence view already carries one student and one exam; records or candidates of anything else are ignored.
 */
export function deriveRevisionSignals(evidence: MasteryEvidenceView, context: TrainingSystemContext): RevisionSignal[] {
  if (context.studentId !== evidence.studentId) {
    throw new RevisionIntelligenceError("scope_mismatch", "The training context and the evidence view belong to different students.");
  }
  const records = context.attemptRecords.filter((r) => r.contribution.studentId === evidence.studentId && r.question.examCode === evidence.examCode);
  const publishedPool = context.candidates.filter((c) => c.validationState === "published" && c.question.examCode === evidence.examCode);
  const signals: RevisionSignal[] = [];

  // --- dormant_concept: Revision's own rule, reused (never re-implemented), for EVERY eligible concept ---
  const nowMs = context.now === undefined ? Number.NaN : Date.parse(context.now);
  if (Number.isFinite(nowMs)) {
    const evidenceConcepts = new Set(evidence.concepts.map((c) => c.conceptName));
    for (const dormancy of deriveConceptDormancies({ ...context, attemptRecords: records })) {
      if (!evidenceConcepts.has(dormancy.conceptName)) continue;
      if (dormancy.gradedAttemptCount < REVISION_CONSTANTS.MIN_GRADED_ATTEMPTS || nowMs - dormancy.lastGradedAtMs < DORMANCY_MS) continue;
      const gradedIds = chronologicalIds(records.filter((r) => r.question.conceptName === dormancy.conceptName && isGraded(r) && r.contribution.finalizedAt !== null && Number.isFinite(Date.parse(r.contribution.finalizedAt))));
      signals.push(
        signal(
          "dormant_concept",
          "concept",
          dormancy.conceptName,
          null,
          {
            gradedAttempts: dormancy.gradedAttemptCount,
            lastGradedAt: new Date(dormancy.lastGradedAtMs).toISOString(),
            wholeDaysSinceLastGradedAttempt: Math.floor((nowMs - dormancy.lastGradedAtMs) / MS_PER_DAY),
            minimumGradedAttempts: REVISION_CONSTANTS.MIN_GRADED_ATTEMPTS,
            dormancyDays: REVISION_CONSTANTS.DORMANCY_DAYS
          },
          gradedIds,
          `"${dormancy.conceptName}" has ${dormancy.gradedAttemptCount} graded attempts and its latest graded attempt is at least ${REVISION_CONSTANTS.DORMANCY_DAYS} days old.`
        )
      );
    }
  }

  // --- recurring_trap_failure: Trap Lab's own recurrence evidence and gate, reused ---
  for (const recurrence of computeTrapAssociatedFailureRecurrence(evidence.studentId, records, undefined)) {
    if (recurrence.distinctFailingQuestionIds.length < AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT) continue;
    const failing = new Set(recurrence.distinctFailingQuestionIds);
    const attempts = records.filter((r) => isGraded(r) && r.contribution.isCorrect === false && r.question.trapErrorTaxonomyCode === recurrence.errorTaxonomyCode && failing.has(r.contribution.questionId));
    signals.push(
      signal(
        "recurring_trap_failure",
        "error_code",
        null,
        recurrence.errorTaxonomyCode,
        {
          distinctFailingQuestions: recurrence.distinctFailingQuestionIds.length,
          failingQuestionIds: recurrence.distinctFailingQuestionIds,
          conceptsInvolved: recurrence.distinctConceptNames,
          minimumDistinctFailingQuestions: AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT
        },
        chronologicalIds(attempts),
        `${recurrence.distinctFailingQuestionIds.length} distinct questions designed around the same trap were answered incorrectly.`
      )
    );
  }

  // --- per-concept signals from the Unit 1 evidence view and the published pool ---
  for (const concept of evidence.concepts) {
    const conceptRecords = records.filter((r) => r.question.conceptName === concept.conceptName);

    const repeated = concept.questions.filter((q) => q.attempts > 1);
    if (concept.overall.attempts > concept.overall.distinctQuestions && repeated.length > 0) {
      signals.push(
        signal(
          "attempts_exceed_distinct_questions",
          "question",
          concept.conceptName,
          null,
          { attempts: concept.overall.attempts, distinctQuestions: concept.overall.distinctQuestions, repeatedQuestionIds: repeated.map((q) => q.questionId) },
          concept.overall.contributingAttemptIds,
          `${concept.overall.attempts} attempts cover only ${concept.overall.distinctQuestions} distinct questions.`
        )
      );
    }

    // Gap signals only where the student has graded evidence on the concept ("previously attempted material").
    if (concept.overall.gradedAttempts === 0) continue;
    const pool = publishedPool.filter((c) => c.question.conceptName === concept.conceptName);

    const gap = (kind: RevisionSignalKind, dimension: RevisionSignal["dimension"], values: readonly string[], bucketFor: (value: string) => { gradedAttempts: number; skippedAttempts: number } | undefined, attemptsFor: (value: string) => MasteryAttemptRecord[], label: string): void => {
      for (const value of [...new Set(values)].sort(cmp)) {
        const bucket = bucketFor(value);
        if (bucket !== undefined && bucket.gradedAttempts > 0) continue;
        signals.push(
          signal(
            kind,
            dimension,
            concept.conceptName,
            value,
            { gradedAttemptsForValue: 0, skippedAttemptsForValue: bucket?.skippedAttempts ?? 0, publishedQuestionsAvailable: pool.filter((c) => valuesOf(kind, c).includes(value)).length },
            chronologicalIds(attemptsFor(value)),
            `No graded attempt on ${label} "${value}" in "${concept.conceptName}", though the published pool offers it.`
          )
        );
      }
    };
    const valuesOf = (kind: RevisionSignalKind, c: (typeof pool)[number]): string[] =>
      kind === "pattern_family_without_graded_evidence" ? [c.question.patternFamilyName] : kind === "novelty_level_without_graded_evidence" ? [c.question.noveltyLevel] : c.question.testingModes;

    gap(
      "pattern_family_without_graded_evidence",
      "pattern_family",
      pool.flatMap((c) => valuesOf("pattern_family_without_graded_evidence", c)),
      (v) => concept.byPatternFamily[v],
      (v) => conceptRecords.filter((r) => r.question.patternFamilyName === v),
      "pattern family"
    );
    gap(
      "novelty_level_without_graded_evidence",
      "novelty_level",
      pool.flatMap((c) => valuesOf("novelty_level_without_graded_evidence", c)),
      (v) => (concept.byNoveltyLevel as Record<string, { gradedAttempts: number; skippedAttempts: number } | undefined>)[v],
      (v) => conceptRecords.filter((r) => r.question.noveltyLevel === v),
      "novelty level"
    );
    gap(
      "testing_mode_without_graded_evidence",
      "testing_mode",
      pool.flatMap((c) => valuesOf("testing_mode_without_graded_evidence", c)),
      (v) => concept.byTestingMode[v],
      (v) => conceptRecords.filter((r) => r.question.testingModes.includes(v as never)),
      "testing mode"
    );
  }

  return signals.sort((a, b) => cmp(a.conceptName ?? "", b.conceptName ?? "") || cmp(a.kind, b.kind) || cmp(a.subject ?? "", b.subject ?? ""));
}
