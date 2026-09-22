import type { PatternFamilyCoverage, QuestionRefForCoverage } from "@ipmat/question-engine";
import { computePatternFamilyReadiness } from "@ipmat/question-engine";
import type { MasteryAttemptRecord, MasteryComponentDetail, PatternTaxonomyCellData } from "./types.js";

function computeSpeedRatio(record: MasteryAttemptRecord): number | null {
  const { timeTakenSeconds, expectedTimeSeconds } = record.contribution;
  if (timeTakenSeconds === null || expectedTimeSeconds === null) return null;
  if (!Number.isFinite(timeTakenSeconds) || !Number.isFinite(expectedTimeSeconds)) return null;
  if (expectedTimeSeconds <= 0) return null;
  return timeTakenSeconds / expectedTimeSeconds;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation — null below 2 observations (a single point has no spread to report). */
function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values) as number;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function sortByFinalizedAt(records: MasteryAttemptRecord[]): MasteryAttemptRecord[] {
  return [...records].sort((a, b) => {
    const aMs = a.contribution.finalizedAt ? Date.parse(a.contribution.finalizedAt) : 0;
    const bMs = b.contribution.finalizedAt ? Date.parse(b.contribution.finalizedAt) : 0;
    return aMs - bMs;
  });
}

function longestIncorrectStreak(sortedGraded: MasteryAttemptRecord[]): number {
  let longest = 0;
  let current = 0;
  for (const record of sortedGraded) {
    if (record.contribution.isCorrect === false) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * The single shared counting/statistics builder every aggregation level
 * (concept, pattern family, taxonomy cell) funnels through (Phase 5B §8) —
 * never duplicated per level. Every count/statistic here is preserved
 * regardless of whether a "headline" `MasteryComponentMeasures` field ends
 * up `null` for having too few observations (Phase 5B §8: "do not throw
 * away raw component information prematurely").
 */
export function buildComponentDetail(
  records: MasteryAttemptRecord[],
  options: { allTaxonomyCellsForConcept?: PatternTaxonomyCellData[]; questionsForCoverage?: QuestionRefForCoverage[] } = {}
): MasteryComponentDetail {
  const sorted = sortByFinalizedAt(records);
  const graded = sorted.filter((r) => r.contribution.status === "submitted");

  const speedObservations = sorted.map(computeSpeedRatio).filter((v): v is number => v !== null);

  const byTier: MasteryComponentDetail["difficultyBreakdown"]["byTier"] = {};
  const byNoveltyLevel: MasteryComponentDetail["noveltyBreakdown"]["byNoveltyLevel"] = {};
  let pressureAttempts = 0;
  let pressureCorrect = 0;
  let ordinaryAttempts = 0;
  let ordinaryCorrect = 0;

  for (const record of graded) {
    const tier = record.question.difficultyTier;
    const tierEntry = byTier[tier] ?? { attempts: 0, correct: 0 };
    tierEntry.attempts += 1;
    if (record.contribution.isCorrect) tierEntry.correct += 1;
    byTier[tier] = tierEntry;

    const novelty = record.question.noveltyLevel;
    const noveltyEntry = byNoveltyLevel[novelty] ?? { attempts: 0, correct: 0 };
    noveltyEntry.attempts += 1;
    if (record.contribution.isCorrect) noveltyEntry.correct += 1;
    byNoveltyLevel[novelty] = noveltyEntry;

    const isPressure = record.question.testingModes.includes("time_pressured");
    if (isPressure) {
      pressureAttempts += 1;
      if (record.contribution.isCorrect) pressureCorrect += 1;
    } else {
      ordinaryAttempts += 1;
      if (record.contribution.isCorrect) ordinaryCorrect += 1;
    }
  }

  const patternFamiliesEncountered = Array.from(new Set(records.map((r) => r.question.patternFamilyName)));
  const taxonomyCellsEncountered = Array.from(new Set(records.map((r) => r.question.patternTaxonomyCellId)));

  const contentCoverage: PatternFamilyCoverage[] =
    options.allTaxonomyCellsForConcept && options.questionsForCoverage
      ? patternFamiliesEncountered.map((familyName) =>
          computePatternFamilyReadiness(familyName, options.allTaxonomyCellsForConcept as PatternTaxonomyCellData[], options.questionsForCoverage as QuestionRefForCoverage[])
        )
      : [];

  const attemptTimestamps = sorted
    .map((r) => r.contribution.finalizedAt)
    .filter((t): t is string => t !== null);

  return {
    totalAttempts: records.length,
    submittedAttempts: graded.length,
    skippedAttempts: sorted.filter((r) => r.contribution.status === "skipped").length,
    abandonedAttempts: sorted.filter((r) => r.contribution.status === "abandoned").length,
    correctCount: graded.filter((r) => r.contribution.isCorrect === true).length,
    incorrectCount: graded.filter((r) => r.contribution.isCorrect === false).length,
    speedStatistics: {
      observationCount: speedObservations.length,
      meanSpeedRatio: mean(speedObservations),
      minSpeedRatio: speedObservations.length > 0 ? Math.min(...speedObservations) : null,
      maxSpeedRatio: speedObservations.length > 0 ? Math.max(...speedObservations) : null,
      stdDevSpeedRatio: stdDev(speedObservations)
    },
    accuracyStability: {
      sequence: graded.map((r) => r.contribution.isCorrect === true),
      meanAccuracy: graded.length > 0 ? graded.filter((r) => r.contribution.isCorrect === true).length / graded.length : null,
      stdDevAccuracy: stdDev(graded.map((r) => (r.contribution.isCorrect === true ? 1 : 0)))
    },
    difficultyBreakdown: { byTier },
    noveltyBreakdown: { byNoveltyLevel },
    pressureBreakdown: { pressureAttempts, pressureCorrect, ordinaryAttempts, ordinaryCorrect },
    errorRecurrence: {
      incorrectCount: graded.filter((r) => r.contribution.isCorrect === false).length,
      longestIncorrectStreak: longestIncorrectStreak(graded)
    },
    coverage: { patternFamiliesEncountered, taxonomyCellsEncountered, contentCoverage },
    contributingAttemptIds: sorted.map((r) => r.contribution.attemptId),
    earliestAttemptAt: attemptTimestamps[0] ?? null,
    latestAttemptAt: attemptTimestamps[attemptTimestamps.length - 1] ?? null
  };
}
