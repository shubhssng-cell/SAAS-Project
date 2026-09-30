import type { AttemptAutopsyEvidence } from "@ipmat/attempt";
import { deriveBehaviorSignals } from "./behaviorSignals.js";
import type { AutopsyQuestionContext, HistoricalAttemptRecord } from "./types.js";

/**
 * PHASE 4 UNIT 1 -- OBSERVATION-ONLY evidence for one finalized attempt: "what happened?", never "why?".
 *
 *   Attempt  ->  Observable Evidence   (THIS FILE)   ->  hypothesis  ->  confirmation  ->  diagnosis  ->  RepairPlan   (all later units)
 *
 * It deliberately stops before everything `buildAutopsyOutput()` adds beyond observation: no candidate error category, no taxonomy
 * lookup, no hypothesis, no label for the student. It reuses the existing contracts (`AttemptAutopsyEvidence` from `@ipmat/attempt`,
 * `AutopsyQuestionContext`/`HistoricalAttemptRecord` from this package, `deriveBehaviorSignals()` for the time ratio) and adds nothing
 * that is not already recorded. It carries NO answer key (`correctAnswer` is not a field): the verdict is the only answer-related fact.
 * It has no field for confidence, motivation, intelligence, ability, emotion, personality or intent, and must never gain one (D-005/D-006).
 *
 * EVERY field has a source, declared in `OBSERVATION_FIELD_SOURCES`:
 *   observed  a fact the system recorded (status, selected answer, elapsed time, event types/timestamps, question metadata, counts of recorded events)
 *   derived   a deterministic calculation from observed facts (time ratio, answer-change count, history counts)
 *   unknown   not available -- the value is `null` (never a guess) and its path is listed in `unknown`
 *
 * HONEST ABOUT WHAT THE REAL PRACTICE FLOW RECORDS. The student UI currently records exactly one `answer_selected` event, at submission,
 * and no `question_opened`/`answer_changed`/`hint_opened`/`solution_opened` events. One recorded selection is therefore consistent with
 * "never changed" AND with "changed but not recorded", so `answerChangeCount` is `null` (unknown) unless at least two selections were
 * recorded -- it is never reported as 0 on that basis. Hint/solution fields are counts/flags of RECORDED events, named as such.
 */

export type EvidenceSource = "observed" | "derived";

export type ObservedVerdict = "correct" | "incorrect" | "not_graded";
export type ObservedOutcome = "correct" | "incorrect" | "skipped" | "abandoned";

export interface OutcomeCounts {
  attempts: number;
  correct: number;
  incorrect: number;
  skipped: number;
  abandoned: number;
}

export interface RecentOutcome {
  attemptId: string;
  questionId: string;
  outcome: ObservedOutcome;
  /** The same time ratio as `timing.timeRatio`, for that earlier attempt; `null` when not determinable. */
  timeRatio: number | null;
}

export interface ObservationHistory {
  /** Prior finalized attempts (before this one, by finalization order) that were considered. */
  priorAttempts: number;
  onSameConcept: OutcomeCounts;
  onSamePatternFamily: OutcomeCounts;
  onSameTaxonomyCell: OutcomeCounts;
  onSameQuestion: OutcomeCounts;
  /** The last (up to `RECENT_OUTCOME_LIMIT`) prior attempts on this concept, oldest first. */
  recentOnConcept: RecentOutcome[];
}

export interface ObservationEvidence {
  identity: { studentId: string; attemptId: string; questionId: string };
  outcome: { status: "submitted" | "skipped" | "abandoned"; verdict: ObservedVerdict; selectedAnswer: string | null };
  timing: { elapsedSeconds: number | null; expectedSeconds: number | null; timeRatio: number | null };
  interaction: {
    /** How many answer selections were RECORDED (`answer_selected`/`answer_changed` events). */
    recordedSelectionCount: number;
    /** `null` (unknown) unless >= 2 selections were recorded; see the file comment. */
    answerChangeCount: number | null;
    answerChanged: boolean | null;
    hintEventsRecorded: number;
    solutionOpenedRecorded: boolean;
  };
  /** The attempt's recorded events, in order (`occurredAt`, ties keep recorded order). Types and timestamps only. */
  eventSequence: Array<{ type: string; occurredAt: string }>;
  /** `null` when the question's metadata could not be resolved (unknown, not guessed). */
  questionContext: {
    chapterName: string;
    conceptName: string;
    patternFamilyName: string;
    patternTaxonomyCellId: string;
    difficultyTier: string;
    noveltyLevel: string;
    testingModes: string[];
    combinesWithConcepts: string[];
  } | null;
  /** `null` when there were no prior attempts to describe (unknown/absent, not a zero-filled summary). */
  history: ObservationHistory | null;
  /** Dotted field path -> how its value was obtained. Identical for every evidence object; unknown values are listed in `unknown`. */
  fieldSources: Record<string, EvidenceSource>;
  /** Dotted paths whose value is unknown for THIS attempt, plus the facts this system never collects at all (`never_collected.*`). */
  unknown: string[];
}

export const RECENT_OUTCOME_LIMIT = 5;

/** The source of every field, in one place (tests assert every emitted field is covered and nothing psychological is listed). */
export const OBSERVATION_FIELD_SOURCES: Record<string, EvidenceSource> = {
  "identity.studentId": "observed",
  "identity.attemptId": "observed",
  "identity.questionId": "observed",
  "outcome.status": "observed",
  "outcome.verdict": "observed", // the graded result the attempt lifecycle recorded
  "outcome.selectedAnswer": "observed",
  "timing.elapsedSeconds": "observed", // finalizedAt - startedAt, recorded by the lifecycle
  "timing.expectedSeconds": "observed", // question metadata
  "timing.timeRatio": "derived",
  "interaction.recordedSelectionCount": "observed",
  "interaction.answerChangeCount": "derived",
  "interaction.answerChanged": "derived",
  "interaction.hintEventsRecorded": "observed",
  "interaction.solutionOpenedRecorded": "observed",
  "eventSequence": "observed",
  "questionContext.chapterName": "observed",
  "questionContext.conceptName": "observed",
  "questionContext.patternFamilyName": "observed",
  "questionContext.patternTaxonomyCellId": "observed",
  "questionContext.difficultyTier": "observed",
  "questionContext.noveltyLevel": "observed",
  "questionContext.testingModes": "observed",
  "questionContext.combinesWithConcepts": "observed",
  "history.priorAttempts": "derived",
  "history.onSameConcept": "derived",
  "history.onSamePatternFamily": "derived",
  "history.onSameTaxonomyCell": "derived",
  "history.onSameQuestion": "derived",
  "history.recentOnConcept": "derived"
};

/** Facts this system does NOT collect and therefore never reports. Listed so absence is explicit, never silently filled. */
export const NEVER_COLLECTED: string[] = ["never_collected.reasoning", "never_collected.working_steps", "never_collected.confidence", "never_collected.intent"];

function outcomeOf(evidence: AttemptAutopsyEvidence): ObservedOutcome {
  if (evidence.status === "skipped") return "skipped";
  if (evidence.status === "abandoned") return "abandoned";
  return evidence.isCorrect === true ? "correct" : "incorrect";
}

function emptyCounts(): OutcomeCounts {
  return { attempts: 0, correct: 0, incorrect: 0, skipped: 0, abandoned: 0 };
}

function countOutcomes(records: HistoricalAttemptRecord[]): OutcomeCounts {
  const counts = emptyCounts();
  for (const record of records) {
    counts.attempts += 1;
    counts[outcomeOf(record.evidence)] += 1;
  }
  return counts;
}

/** When a prior attempt finished: its last recorded event. Used only to order history deterministically, never as a claim. */
function lastEventAt(evidence: AttemptAutopsyEvidence): string {
  return evidence.eventTimeline.length === 0 ? "" : evidence.eventTimeline.reduce((latest, e) => (e.occurredAt > latest ? e.occurredAt : latest), "");
}

/**
 * Pure and deterministic: the same inputs give the same object, whatever order `priorAttempts` arrives in (they are put in a total
 * order -- last recorded event, then `attemptId` -- before anything is taken from them). Never mutates its inputs, never reads a clock,
 * never calls a model. `question === null` means the question's metadata could not be resolved; history is then omitted as well
 * (it is defined relative to the question's concept/family/cell).
 */
export function buildObservationEvidence(input: { evidence: AttemptAutopsyEvidence; question: AutopsyQuestionContext | null; priorAttempts?: HistoricalAttemptRecord[] }): ObservationEvidence {
  const { evidence, question } = input;
  const signals = deriveBehaviorSignals(evidence);

  const recordedSelectionCount = evidence.answerChangeHistory.sequence.length;
  const changeKnown = recordedSelectionCount >= 2;
  const answerChangeCount = changeKnown ? evidence.answerChangeHistory.changeCount : null;

  const eventSequence = evidence.eventTimeline.map((event, index) => ({ type: event.type, occurredAt: event.occurredAt, index })).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.index - b.index)).map(({ type, occurredAt }) => ({ type, occurredAt }));

  let history: ObservationHistory | null = null;
  const prior = [...(input.priorAttempts ?? [])]
    .filter((record) => record.evidence.attemptId !== evidence.attemptId)
    .sort((a, b) => {
      const ta = lastEventAt(a.evidence);
      const tb = lastEventAt(b.evidence);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.evidence.attemptId < b.evidence.attemptId ? -1 : a.evidence.attemptId > b.evidence.attemptId ? 1 : 0;
    });
  if (question !== null && prior.length > 0) {
    const sameConcept = prior.filter((r) => r.question.conceptName === question.conceptName);
    history = {
      priorAttempts: prior.length,
      onSameConcept: countOutcomes(sameConcept),
      onSamePatternFamily: countOutcomes(sameConcept.filter((r) => r.question.patternFamilyName === question.patternFamilyName)),
      onSameTaxonomyCell: countOutcomes(prior.filter((r) => r.question.patternTaxonomyCellId === question.patternTaxonomyCellId)),
      onSameQuestion: countOutcomes(prior.filter((r) => r.question.questionId === question.questionId)),
      recentOnConcept: sameConcept.slice(-RECENT_OUTCOME_LIMIT).map((r) => ({ attemptId: r.evidence.attemptId, questionId: r.question.questionId, outcome: outcomeOf(r.evidence), timeRatio: deriveBehaviorSignals(r.evidence).speedRatio }))
    };
  }

  const unknown: string[] = [...NEVER_COLLECTED];
  if (evidence.timeTakenSeconds === null) unknown.push("timing.elapsedSeconds");
  if (evidence.expectedTimeSeconds === null) unknown.push("timing.expectedSeconds");
  if (signals.speedRatio === null) unknown.push("timing.timeRatio");
  if (!changeKnown) unknown.push("interaction.answerChangeCount", "interaction.answerChanged");
  if (evidence.finalAnswer === null) unknown.push("outcome.selectedAnswer");
  if (question === null) unknown.push("questionContext", "history");
  else if (history === null) unknown.push("history");

  return {
    identity: { studentId: evidence.studentId, attemptId: evidence.attemptId, questionId: evidence.questionId },
    outcome: { status: evidence.status, verdict: evidence.isCorrect === true ? "correct" : evidence.isCorrect === false ? "incorrect" : "not_graded", selectedAnswer: evidence.finalAnswer },
    timing: { elapsedSeconds: evidence.timeTakenSeconds, expectedSeconds: evidence.expectedTimeSeconds, timeRatio: signals.speedRatio },
    interaction: {
      recordedSelectionCount,
      answerChangeCount,
      answerChanged: changeKnown ? answerChangeCount! >= 1 : null,
      hintEventsRecorded: evidence.hintsUsed,
      solutionOpenedRecorded: evidence.solutionOpenedAt !== null
    },
    eventSequence,
    questionContext:
      question === null
        ? null
        : {
            chapterName: question.chapterName,
            conceptName: question.conceptName,
            patternFamilyName: question.patternFamilyName,
            patternTaxonomyCellId: question.patternTaxonomyCellId,
            difficultyTier: question.difficultyTier,
            noveltyLevel: question.noveltyLevel,
            testingModes: [...question.testingModes],
            combinesWithConcepts: [...question.combinesWithConcepts]
          },
    history,
    fieldSources: { ...OBSERVATION_FIELD_SOURCES },
    unknown
  };
}
