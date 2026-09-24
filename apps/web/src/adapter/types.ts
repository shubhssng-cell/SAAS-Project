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
  attemptId: string;
  questionId: string;
  isCorrect: boolean;
  chosenAnswer: string;
  correctAnswer: string;
  timeTakenSeconds: number;
  expectedTimeSeconds: number;
  solutionSteps: string[];
  /** Whether an autopsy hypothesis was generated for this attempt (only ever true for an incorrect, diagnosable answer). */
  hasAutopsy: boolean;
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
  getAutopsy(attemptId: string): Promise<AutopsyViewModel>;
  /** Applies the student's response to the pending hypothesis and returns the resulting recommendation — a confirmed hypothesis may (transparently, via the real domain layer) become a targeted repair recommendation. */
  respondToAutopsy(input: { attemptId: string; response: AutopsyResponse }): Promise<RecommendationViewModel>;
  getNextRecommendation(): Promise<RecommendationViewModel>;
}
