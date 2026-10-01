import { FixtureProvider } from "@ipmat/ai";
import {
  recordAttemptEvent,
  skipAttempt,
  startAttempt,
  submitAttempt,
  toAutopsyEvidence,
  toMasteryContribution,
  type AttemptState
} from "@ipmat/attempt";
import {
  buildAutopsyOutput,
  buildRepairPlan,
  confirmHypothesis,
  generateHypothesis,
  rejectHypothesis,
  type AutopsyHypothesis,
  type AutopsyOutput,
  type RepairPlan
} from "@ipmat/autopsy";
import { computeMasteryState, type MasteryAttemptRecord } from "@ipmat/mastery";
import { orchestrateNextTrainingAction, type ActiveRepairPlanContext, type TrainingCandidateQuestion } from "@ipmat/training-orchestration";
import { CONCEPT_ID, CONCEPT_NAME, ENROLLMENT_ID, ERROR_TAXONOMY, getQuestion, QUESTION_ORDER, STUDENT_ID } from "./fixtures.js";
import { describeObservations, toRecommendationViewModel } from "./presentation.js";
import type { AttemptEvidenceViewModel, AttemptResultViewModel, HypothesisOfferViewModel, HypothesisResultViewModel, AutopsyResponse, AutopsyViewModel, DashboardViewModel, QuestionViewModel, RecommendationViewModel, TrainingRecommendationAdapter } from "./types.js";

/**
 * Fixture-backed implementation of `TrainingRecommendationAdapter`. Every
 * recommendation shown to the UI is the REAL, unmodified output of
 * `orchestrateNextTrainingAction()` (which internally reaches
 * repair-selection/adaptive-selection/the training-system providers) --
 * this file supplies only the persisted-state STAND-IN (in-memory session
 * data) that a real database would otherwise provide. When the Training
 * Recommendation Composition Layer exists, only this factory function is
 * replaced; `TrainingRecommendationAdapter` and every UI component stay
 * exactly as they are.
 *
 * Scope decision for this first vertical slice: the autopsy/confirmation
 * loop only runs for questions with a designed trap code
 * (`dna.trapErrorTaxonomyCode !== null`) -- an incorrect answer on a
 * non-trap question still counts as evidence (it feeds mastery/attempt
 * history) but does not surface a hypothesis, since `buildRepairPlan()`
 * cannot target a `null` error category. This is a product-scoping choice
 * for the first slice, not a domain-layer limitation.
 */
export function createFixtureTrainingAdapter(): TrainingRecommendationAdapter {
  let attemptCounter = 0;
  const attempts: AttemptState[] = [];
  const attemptRecords: MasteryAttemptRecord[] = [];
  const confirmedRepairPlans: RepairPlan[] = [];
  const pendingAutopsy = new Map<string, { output: AutopsyOutput; hypothesis: AutopsyHypothesis }>();
  const inProgressByQuestion = new Map<string, AttemptState>();
  const resultsByAttempt = new Map<string, AttemptResultViewModel>();

  function now(): string {
    return new Date().toISOString();
  }

  function buildCandidates(): TrainingCandidateQuestion[] {
    return QUESTION_ORDER.map((id) => {
      const q = getQuestion(id);
      return { question: q.dna, expectedTimeSeconds: q.attemptContext.expectedTimeSeconds ?? 60, validationState: "published" as const };
    });
  }

  function currentMasteryByConcept() {
    return [computeMasteryState(attemptRecords, { studentId: STUDENT_ID, conceptId: CONCEPT_ID, conceptName: CONCEPT_NAME, now: now() })];
  }

  function currentActiveRepairPlans(): ActiveRepairPlanContext[] {
    return confirmedRepairPlans.map((plan) => ({ plan }));
  }

  async function computeRecommendation(): Promise<RecommendationViewModel> {
    const result = orchestrateNextTrainingAction({
      studentId: STUDENT_ID,
      activeRepairPlans: currentActiveRepairPlans(),
      masteryByConcept: currentMasteryByConcept(),
      attemptRecords,
      candidates: buildCandidates()
    });
    return toRecommendationViewModel(result);
  }

  return {
    async getDashboard(): Promise<DashboardViewModel> {
      return {
        studentDisplayName: "there",
        questionsPracticedSoFar: attempts.length,
        recommendation: await computeRecommendation()
      };
    },

    async loadQuestion(questionId: string): Promise<QuestionViewModel> {
      const q = getQuestion(questionId);
      const attempt = startAttempt({
        id: `attempt-${STUDENT_ID}-${questionId}-${(attemptCounter += 1)}`,
        studentId: STUDENT_ID,
        questionId,
        enrollmentId: ENROLLMENT_ID,
        now: now()
      });
      inProgressByQuestion.set(questionId, attempt);

      return {
        questionId,
        chapterName: q.dna.chapterName,
        conceptName: q.dna.conceptName,
        prompt: q.prompt,
        answerFormat: q.attemptContext.answerFormat,
        options: q.attemptContext.options,
        expectedTimeSeconds: q.attemptContext.expectedTimeSeconds ?? 60,
        elapsedSeconds: 0
      };
    },

    async submitAnswer(input: { questionId: string; chosenAnswer: string; timeTakenSeconds: number }): Promise<AttemptResultViewModel> {
      const q = getQuestion(input.questionId);
      const claim = { studentId: STUDENT_ID, questionId: input.questionId };
      let attempt = inProgressByQuestion.get(input.questionId);
      if (!attempt) throw new Error(`No in-progress attempt for question "${input.questionId}" -- call loadQuestion() first.`);

      const selectedAt = new Date(Date.parse(attempt.startedAt) + input.timeTakenSeconds * 1000).toISOString();
      attempt = recordAttemptEvent(attempt, { type: "answer_selected", occurredAt: selectedAt, selectedAnswer: input.chosenAnswer }, claim);
      attempt = submitAttempt(attempt, claim, q.attemptContext, { now: selectedAt });
      inProgressByQuestion.delete(input.questionId);
      attempts.push(attempt);
      attemptRecords.push({ contribution: toMasteryContribution(attempt, q.attemptContext), question: q.dna });

      const isCorrect = attempt.isCorrect ?? false;
      const hasAutopsy = !isCorrect && q.dna.trapErrorTaxonomyCode !== null && q.hypothesisOnWrongAnswer !== null;

      if (hasAutopsy && q.hypothesisOnWrongAnswer) {
        const evidence = toAutopsyEvidence(attempt, q.attemptContext);
        const output = buildAutopsyOutput({ evidence, question: q.dna, errorTaxonomy: ERROR_TAXONOMY });
        const provider = new FixtureProvider([JSON.stringify(q.hypothesisOnWrongAnswer)]);
        const hypothesis = await generateHypothesis(provider, { autopsyOutput: output });
        pendingAutopsy.set(attempt.id, { output, hypothesis });
      }

      const result: AttemptResultViewModel = {
        status: "submitted",
        attemptId: attempt.id,
        questionId: input.questionId,
        isCorrect,
        chosenAnswer: input.chosenAnswer,
        correctAnswer: q.attemptContext.correctAnswer,
        timeTakenSeconds: attempt.timeSpentSeconds ?? input.timeTakenSeconds,
        expectedTimeSeconds: q.attemptContext.expectedTimeSeconds ?? 60,
        solutionSteps: q.solutionSteps,
        question: { prompt: q.prompt, chapterName: q.dna.chapterName, conceptName: q.dna.conceptName },
        hasAutopsy
      };
      resultsByAttempt.set(attempt.id, result);
      return result;
    },

    // Fixture-only: mirrors the real adapter's contract using the same domain skip function.
    async skipQuestion(input: { questionId: string }): Promise<AttemptResultViewModel> {
      const attempt = inProgressByQuestion.get(input.questionId);
      if (!attempt) throw new Error(`No in-progress attempt for question "${input.questionId}" -- call loadQuestion() first.`);
      const skipped = skipAttempt(attempt, { studentId: STUDENT_ID, questionId: input.questionId }, { now: now() });
      inProgressByQuestion.delete(input.questionId);
      attempts.push(skipped);
      const result: AttemptResultViewModel = {
        status: "skipped",
        attemptId: skipped.id,
        questionId: input.questionId,
        isCorrect: false,
        chosenAnswer: "",
        correctAnswer: "",
        timeTakenSeconds: skipped.timeSpentSeconds ?? 0,
        expectedTimeSeconds: getQuestion(input.questionId).attemptContext.expectedTimeSeconds ?? 60,
        solutionSteps: [],
        question: null,
        hasAutopsy: false
      };
      resultsByAttempt.set(skipped.id, result);
      return result;
    },

    async getAttemptResult(attemptId: string): Promise<AttemptResultViewModel> {
      const result = resultsByAttempt.get(attemptId);
      if (!result) throw new Error(`No result for attempt "${attemptId}".`);
      return result;
    },

    async getAttemptEvidence(attemptId: string): Promise<AttemptEvidenceViewModel> {
      // The fixture adapter has no persisted history to observe; it never invents evidence.
      throw new Error(`Attempt evidence is not available from the fixture adapter (attempt "${attemptId}").`);
    },

    async requestHypothesis(): Promise<HypothesisOfferViewModel> {
      // The fixture adapter has no model and never invents an explanation.
      return { status: "unavailable" };
    },

    async respondToHypothesis(): Promise<HypothesisResultViewModel> {
      throw new Error("The fixture adapter has no explanation to respond to.");
    },

    async getAutopsy(attemptId: string): Promise<AutopsyViewModel> {
      const pending = pendingAutopsy.get(attemptId);
      if (!pending) {
        return { attemptId, observed: [], hypothesis: null };
      }
      const observed = describeObservations(pending.output.behaviorSignals, pending.output.historicalSignals);
      return {
        attemptId,
        observed,
        hypothesis: { summary: pending.hypothesis.proposedExplanation, supportingEvidence: pending.hypothesis.supportingEvidence }
      };
    },

    async respondToAutopsy(input: { attemptId: string; response: AutopsyResponse }): Promise<RecommendationViewModel> {
      const pending = pendingAutopsy.get(input.attemptId);
      if (!pending) return computeRecommendation();
      pendingAutopsy.delete(input.attemptId);

      if (input.response === "confirmed") {
        const confirmed = confirmHypothesis(pending.hypothesis, { now: now() });
        if (confirmed.proposedErrorCategory !== null) {
          const plan = buildRepairPlan(confirmed, pending.output);
          confirmedRepairPlans.push(plan);
        }
      } else {
        rejectHypothesis(pending.hypothesis, { now: now() });
        // A rejected hypothesis produces no RepairPlan -- the student's disagreement
        // is the end of this diagnosis, exactly as docs/DECISIONS.md D-006 requires;
        // nothing here invents a second-guess.
      }

      return computeRecommendation();
    },

    async getNextRecommendation(): Promise<RecommendationViewModel> {
      return computeRecommendation();
    }
  };
}
