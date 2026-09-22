import { deriveBehaviorSignals } from "./behaviorSignals.js";
import { AUTOPSY_THRESHOLDS, type HistoricalAttemptRecord, type HistoricalSignals, type RepetitionCount } from "./types.js";

function toRepetitionCount(records: HistoricalAttemptRecord[]): RepetitionCount | null {
  if (records.length < AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT) return null;
  return { count: records.length, attemptIds: records.map((record) => record.evidence.attemptId) };
}

/**
 * Purely observable repetition counts across the current attempt plus
 * whatever prior attempts were supplied (Phase 5A §7) — every count is
 * "same X happened N times," never a claim about understanding. Returns
 * `null` (not a zero-filled struct) when no prior attempts were supplied
 * at all — historical evidence is either genuinely available or entirely
 * absent, never fabricated as "0 repeats" when there was nothing to
 * compare against (Phase 5A §13 regression test 2: a single failure with
 * no history must not produce any "repeated" evidence).
 */
export function deriveHistoricalSignals(
  current: HistoricalAttemptRecord,
  priorAttempts: HistoricalAttemptRecord[]
): HistoricalSignals | null {
  if (priorAttempts.length === 0) return null;

  const all: HistoricalAttemptRecord[] = [...priorAttempts, current];

  const sameConcept = all.filter((record) => record.question.conceptName === current.question.conceptName);
  const samePatternFamily = sameConcept.filter(
    (record) => record.question.patternFamilyName === current.question.patternFamilyName
  );
  const sameTaxonomyCell = all.filter(
    (record) => record.question.patternTaxonomyCellId === current.question.patternTaxonomyCellId
  );

  const conceptFailures = sameConcept.filter((record) => record.evidence.isCorrect === false);
  const patternFailures = samePatternFamily.filter((record) => record.evidence.isCorrect === false);
  const cellFailures = sameTaxonomyCell.filter((record) => record.evidence.isCorrect === false);

  const conceptSlow = sameConcept.filter((record) => {
    const signals = deriveBehaviorSignals(record.evidence);
    return signals.correctSlow || signals.incorrectSlow;
  });
  const conceptHints = sameConcept.filter((record) => record.evidence.hintsUsed > 0);
  const conceptSolutions = sameConcept.filter((record) => record.evidence.solutionOpenedAt !== null);

  const conceptNoveltyIncorrect = sameConcept.filter(
    (record) => record.question.noveltyLevel !== "standard" && record.evidence.isCorrect === false
  );

  const conceptPressureQuestions = sameConcept.filter((record) => record.question.testingModes.includes("time_pressured"));
  const conceptPressureIncorrect = conceptPressureQuestions.filter((record) => record.evidence.isCorrect === false);

  const priorOnSameQuestion = priorAttempts.filter((record) => record.question.questionId === current.question.questionId);
  const solutionOpenedAfterPriorIncorrectAttempt =
    current.evidence.solutionOpenedAt !== null && priorOnSameQuestion.some((record) => record.evidence.isCorrect === false);

  return {
    totalPriorAttempts: priorAttempts.length,
    repeatedConceptFailure: toRepetitionCount(conceptFailures),
    repeatedPatternFamilyFailure: toRepetitionCount(patternFailures),
    repeatedTaxonomyCellFailure: toRepetitionCount(cellFailures),
    repeatedSlowPerformance: toRepetitionCount(conceptSlow),
    repeatedHintUse: toRepetitionCount(conceptHints),
    repeatedSolutionOpening: toRepetitionCount(conceptSolutions),
    repeatedNoveltyDifficulty: toRepetitionCount(conceptNoveltyIncorrect),
    // null (not a count of 0) when there was no pressure-context question to evaluate at all — "when pressure context exists" (Phase 5A §7).
    repeatedPressureDifficulty: conceptPressureQuestions.length === 0 ? null : toRepetitionCount(conceptPressureIncorrect),
    solutionOpenedAfterPriorIncorrectAttempt
  };
}
