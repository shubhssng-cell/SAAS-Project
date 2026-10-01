/**
 * The application-facing contract every UI component depends on. Nothing
 * here is a decision engine's own shape (never `TrainingSystemOutcome`,
 * never `RepairPlan` in raw form) — every field is either a plain student
 * -facing string the adapter authored, or a plain fact (an id, a number,
 * a boolean) a UI component can render without knowing anything about
 * repair-selection/adaptive-selection/training-systems.
 *
 * This interface is the seam the eventual real Training Recommendation
 * Composition Layer will implement instead of `createFixtureTrainingAdapter()`
 * (see fixtureAdapter.ts) — no UI component may be changed when that swap
 * happens; only the factory call in App.tsx changes.
 */

export type AnswerFormat = "multiple_choice" | "numeric_entry";

export interface QuestionViewModel {
  questionId: string;
  chapterName: string;
  conceptName: string;
  prompt: string;
  answerFormat: AnswerFormat;
  options: string[] | null;
  expectedTimeSeconds: number;
  /** Seconds already elapsed on the SERVER's attempt clock when the question was (re)opened -- 0 for a fresh attempt, larger when a reload resumed an open one. Display seed only; never sent back as a duration. */
  elapsedSeconds: number;
}

export interface RecommendationViewModel {
  /** `null` only for the genuine "nothing to recommend right now" state. */
  questionId: string | null;
  headline: string;
  explanation: string;
  /** A short, plain-language tag for the training mode this question serves — e.g. "Confirmed repair", "Coverage", "Recurring mistake". Never a provider id. */
  modeLabel: string;
}

export interface DashboardViewModel {
  studentDisplayName: string;
  questionsPracticedSoFar: number;
  recommendation: RecommendationViewModel;
}

export interface AttemptResultViewModel {
  /**
   * The attempt's terminal state as the SERVER reported it. `"skipped"` is a different thing from an incorrect
   * answer: no answer was submitted, nothing was graded, and `isCorrect`/`chosenAnswer`/`correctAnswer` carry
   * no meaning (`false`/`""`/`""`) -- UI must branch on `status` before reading them.
   */
  status: "submitted" | "skipped";
  attemptId: string;
  questionId: string;
  isCorrect: boolean;
  chosenAnswer: string;
  correctAnswer: string;
  timeTakenSeconds: number;
  expectedTimeSeconds: number;
  /** The authored worked solution from the server; `[]` when none is stored (the UI then offers no solution control -- nothing is invented). */
  solutionSteps: string[];
  /** The question the student answered, as returned with the result (`null` if the server did not supply it). */
  question: { prompt: string; chapterName: string; conceptName: string } | null;
  /** Whether an autopsy hypothesis was generated for this attempt (only ever true for an incorrect, diagnosable answer). */
  hasAutopsy: boolean;
}

/**
 * Phase 4 Unit 1 -- what the system OBSERVED about a finalized attempt (server-authored sentences plus the numbers behind them).
 * Observation only: no diagnosis, no cause, no label for the student. `notRecorded` names what this flow does not record.
 */
export interface AttemptEvidenceViewModel {
  attemptId: string;
  observations: string[];
  notRecorded: string[];
}

/**
 * Phase 4 Unit 2 -- a POSSIBLE explanation (a hypothesis, never a fact) for an incorrect attempt. `token` is opaque and only echoed back with the
 * student's response. `not_applicable` = nothing to explain; `unavailable` = none could be offered (the result and Continue are unaffected).
 */
export type HypothesisOfferViewModel =
  | { status: "ready"; summary: string; supportingEvidence: string[]; token: string }
  /** The student already answered this explanation: the stored outcome (shown again after a reload or a restart). */
  | { status: "answered"; result: HypothesisResultViewModel }
  | { status: "not_applicable" | "unavailable" };

export type HypothesisResponseInput = { type: "confirmed" } | { type: "rejected" } | { type: "corrected"; correctedExplanation: string };

/**
 * What the student's response produced, as PERSISTED (Phase 4 Unit 3). `corrected` carries their own words exactly. `diagnosisState`:
 * `confirmed` = recorded as a confirmed explanation; `not_confirmed` = rejected (not a diagnosis); `awaiting_diagnosis` = the student's
 * correction was recorded but is not a confirmed diagnosis. `repairPlan` is the safe practice focus, only for a confirmed explanation.
 */
export interface HypothesisResultViewModel {
  status: "confirmed" | "rejected" | "corrected";
  studentCorrectionText: string | null;
  diagnosisState: "confirmed" | "not_confirmed" | "awaiting_diagnosis";
  repairPlan: { conceptName: string; patternFamilyName: string } | null;
}

export interface AutopsyViewModel {
  attemptId: string;
  /** Plain-language OBSERVED facts only — never a claim about why. */
  observed: string[];
  /** The system's proposed explanation — always presented as a hypothesis, never as settled fact. `null` only if something upstream prevented diagnosis (should not normally happen when `hasAutopsy` was true). */
  hypothesis: { summary: string; supportingEvidence: string[] } | null;
}

export type AutopsyResponse = "confirmed" | "rejected";

export interface TrainingRecommendationAdapter {
  getDashboard(): Promise<DashboardViewModel>;
  loadQuestion(questionId: string): Promise<QuestionViewModel>;
  submitAnswer(input: { questionId: string; chosenAnswer: string; timeTakenSeconds: number }): Promise<AttemptResultViewModel>;
  /** Re-reads the result of an already-submitted attempt from the server (e.g. after a page refresh). Rejects when the result is unavailable. */
  /** Skips the question's in-progress attempt (server-side terminal `skipped` state) and returns the skipped outcome. Rejects on failure; a skipped attempt can never be submitted afterwards. */
  skipQuestion(input: { questionId: string }): Promise<AttemptResultViewModel>;
  getAttemptResult(attemptId: string): Promise<AttemptResultViewModel>;
  /** Phase 4 Unit 1: the observation-only evidence for a FINALIZED attempt. Rejects (never guesses) when it is unavailable, e.g. before submission. */
  getAttemptEvidence(attemptId: string): Promise<AttemptEvidenceViewModel>;
  /** Phase 4 Unit 2: asks for ONE possible explanation for a finalized, incorrect attempt. Never invents one: it resolves `unavailable` instead. */
  requestHypothesis(attemptId: string): Promise<HypothesisOfferViewModel>;
  /** Phase 4 Unit 2: answers the offered explanation (confirm / reject / correct in the student's own words). Rejects when it could not be recorded. */
  respondToHypothesis(input: { attemptId: string; token: string; response: HypothesisResponseInput }): Promise<HypothesisResultViewModel>;
  getAutopsy(attemptId: string): Promise<AutopsyViewModel>;
  /** Applies the student's response to the pending hypothesis and returns the resulting recommendation — a confirmed hypothesis may (transparently, via the real domain layer) become a targeted repair recommendation. */
  respondToAutopsy(input: { attemptId: string; response: AutopsyResponse }): Promise<RecommendationViewModel>;
  getNextRecommendation(): Promise<RecommendationViewModel>;
}
