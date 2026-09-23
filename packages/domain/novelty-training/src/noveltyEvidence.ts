import type { MasteryAttemptRecord } from "@ipmat/training-systems";
import { NON_STANDARD_NOVELTY_LEVELS } from "./types.js";
import type { NonStandardNoveltyLevel, NoveltyDimensionExposure, NoveltyExposureEvidence } from "./types.js";

function isGraded(record: MasteryAttemptRecord): boolean {
  return record.contribution.status === "submitted" && record.contribution.isCorrect !== null;
}

function computeDimension(level: NonStandardNoveltyLevel, conceptRecords: MasteryAttemptRecord[]): NoveltyDimensionExposure {
  const questionIds = new Set<string>();
  const familyNames = new Set<string>();
  const combinedConcepts = new Set<string>();

  for (const record of conceptRecords) {
    if (record.question.noveltyLevel !== level) continue;
    questionIds.add(record.contribution.questionId);
    familyNames.add(record.question.patternFamilyName);
    if (level === "novel_combination") {
      for (const combined of record.question.combinesWithConcepts) combinedConcepts.add(combined);
    }
  }

  return {
    noveltyLevel: level,
    distinctQuestionIds: [...questionIds].sort(),
    distinctPatternFamilyNames: [...familyNames].sort(),
    combinedConceptNames: [...combinedConcepts].sort()
  };
}

/**
 * Derives novelty exposure evidence for ONE concept, ENTIRELY from this
 * student's attempt history (docs/DECISIONS.md D-058) — no `candidates`
 * parameter exists on this function at all.
 *
 * CONCEPT-SPECIFIC BASELINE INVARIANT: `standardExposureCount` counts
 * only graded attempts where `question.conceptName === conceptName` AND
 * `question.noveltyLevel === "standard"`. Standard-level exposure to any
 * OTHER concept never contributes here — a student with 12 standard
 * attempts in "Percentages" and 0 in "Ratio" has
 * `standardExposureCount("Ratio") === 0` regardless of the Percentages
 * activity.
 *
 * Only graded (submitted, `isCorrect !== null`) attempts count. Skipped
 * and abandoned attempts are excluded entirely. Correctness itself plays
 * no role in the count — a wrong answer on a non-standard-novelty
 * question is still exposure to that novelty level; this is an exposure
 * model, not an accuracy model (accuracy-based novelty judgments already
 * exist elsewhere, in `@ipmat/mastery`'s `noveltyHandling` and
 * `@ipmat/adaptive-selection`'s `novelty_gap` reason code).
 *
 * Always returns exactly the three `NON_STANDARD_NOVELTY_LEVELS`, in that
 * order, even when a level was never observed at all (zero exposure is
 * itself meaningful evidence, never omitted).
 */
export function computeNoveltyExposureEvidence(studentId: string, conceptName: string, attemptRecords: MasteryAttemptRecord[]): NoveltyExposureEvidence {
  const conceptRecords = attemptRecords.filter((r) => r.contribution.studentId === studentId && r.question.conceptName === conceptName && isGraded(r));

  const standardExposureCount = new Set(conceptRecords.filter((r) => r.question.noveltyLevel === "standard").map((r) => r.contribution.questionId)).size;

  const dimensions = NON_STANDARD_NOVELTY_LEVELS.map((level) => computeDimension(level, conceptRecords));

  return { conceptName, standardExposureCount, dimensions };
}

/**
 * Every distinct concept this student has ANY graded attempt against —
 * derived purely from `attemptRecords`, never from a candidate pool. This
 * is the set of concepts `evaluateNoveltyTraining()` considers.
 */
export function distinctConceptNames(studentId: string, attemptRecords: MasteryAttemptRecord[]): string[] {
  const names = new Set<string>();
  for (const record of attemptRecords) {
    if (record.contribution.studentId !== studentId) continue;
    if (!isGraded(record)) continue;
    names.add(record.question.conceptName);
  }
  return [...names].sort();
}
