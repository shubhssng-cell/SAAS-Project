import type { AuthFailure } from "../auth/failureMapping.js";
import { jsonRequest, type FetchLike } from "../http.js";
import { createSingleFlight } from "../practice/singleFlight.js";
import type {
  AttemptResultViewModel,
  AutopsyResponse,
  AutopsyViewModel,
  DashboardViewModel,
  QuestionViewModel,
  RecommendationViewModel,
  TrainingRecommendationAdapter
} from "./types.js";

/**
 * The real, HTTP-backed `TrainingRecommendationAdapter` (Product Phase 1
 * Unit 10) -- talks to `apps/api`'s six existing practice routes through
 * the SAME shared `jsonRequest()`/`http.ts` plumbing every other
 * authenticated `apps/web` call already uses (`credentials: "include"`,
 * cookie-derived identity, never a client-chosen studentId — see
 * `apps/api/src/server.ts`'s own `resolvePracticeClaim()`, retrofitted in
 * this same unit so this adapter has a SAFE endpoint to call at all).
 *
 * This file is transport translation ONLY (HTTP DTO <-> the EXISTING
 * `TrainingRecommendationAdapter` contract every route already consumes)
 * -- it contains no recommendation/adaptive/grading/repair logic of its
 * own; every decision was already made server-side by `@ipmat/practice-api`
 * before a response ever reaches here. No UI component changes to consume
 * this adapter — it is a drop-in replacement for
 * `createFixtureTrainingAdapter()`, selected once in `App.tsx`.
 *
 * KNOWN, DISCLOSED GAPS (see PHASE_1_PLATFORM_SHELL.md's Unit 10 summary
 * for the full rationale — none of these are silently papered over):
 * - `questionsPracticedSoFar` has no real backend endpoint yet; this
 *   adapter INSTANCE counts real submitted/skipped attempts made during
 *   this session (resets on reload) — an honest count of real actions
 *   taken, never a fabricated number, mirroring the fixture adapter's own
 *   equally session-scoped `attempts.length`.
 * - `AutopsyViewModel.observed` has no real backend source
 *   (`PendingAutopsyView` never surfaces raw behavior/historical signals,
 *   by design — D-020/D-036) — always `[]` here, never invented text.
 * - `respondToAutopsy()` has no real confirm/reject endpoint yet (Unit 10
 *   is transport integration, not a new intelligence implementation) --
 *   `getAutopsyForConfirmation` already reports `pending: false` for every
 *   real attempt today (nothing populates a fresh hypothesis outside the
 *   fixture adapter's own inline AI call), so the only reachable behavior
 *   is re-resolving the next recommendation, exactly mirroring the fixture
 *   adapter's own `if (!pending) return computeRecommendation();` fallback.
 */

const MALFORMED_RESULT = "Something went wrong. Please try again.";

class PracticeApiRequestError extends Error {
  readonly failure: AuthFailure;
  constructor(failure: AuthFailure) {
    super(failure.kind === "unexpected" || failure.kind === "validation" ? failure.message : failure.kind);
    this.name = "PracticeApiRequestError";
    this.failure = failure;
  }
}

/**
 * True only for a genuine 401 from a practice call (Product Phase 1 Unit 11) -- lets a
 * route show "log in again" instead of a Retry that can never succeed. Reads the
 * transport-level failure kind only; the server remains the sole authority on whether
 * a session is valid, and this changes no auth state.
 */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof PracticeApiRequestError && error.failure.kind === "not_authenticated";
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The server always answers `/v1/recommendation` with an object whose `questionId` is a string (a
 * question to practice) or `null` (genuinely nothing to recommend). Anything else -- a non-object
 * body, a missing/odd `questionId` -- is a malformed response and is an ERROR, never quietly read
 * as "nothing available" (Product Phase 2 Unit 4).
 */
function readRecommendation(body: unknown): RecommendationViewModel {
  const value = asObject(body);
  if (!("questionId" in value) || (value.questionId !== null && (typeof value.questionId !== "string" || value.questionId === ""))) {
    throw new PracticeApiRequestError({ kind: "unexpected", message: MALFORMED_RESULT });
  }
  const questionId = typeof value.questionId === "string" ? value.questionId : null;
  const headline = typeof value.headline === "string" ? value.headline : "";
  const explanation = typeof value.explanation === "string" ? value.explanation : "";
  const modeLabel = typeof value.modeLabel === "string" ? value.modeLabel : "";
  return { questionId, headline, explanation, modeLabel };
}

function readQuestion(body: unknown): QuestionViewModel {
  const value = asObject(body);
  const options = Array.isArray(value.options) && value.options.every((o) => typeof o === "string") ? (value.options as string[]) : null;
  return {
    questionId: typeof value.questionId === "string" ? value.questionId : "",
    chapterName: typeof value.chapterName === "string" ? value.chapterName : "",
    conceptName: typeof value.conceptName === "string" ? value.conceptName : "",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    answerFormat: value.answerFormat === "numeric_entry" ? "numeric_entry" : "multiple_choice",
    options,
    expectedTimeSeconds: typeof value.expectedTimeSeconds === "number" ? value.expectedTimeSeconds : 60
  };
}

/** A result is only renderable if the server said it was a graded, submitted attempt -- anything else (missing ids, no boolean verdict, a skip) is treated as malformed, never rendered as a guess. */
function isRenderableResult(value: Record<string, unknown>): boolean {
  return (
    typeof value.attemptId === "string" &&
    value.attemptId !== "" &&
    typeof value.questionId === "string" &&
    typeof value.isCorrect === "boolean" &&
    typeof value.chosenAnswer === "string" &&
    typeof value.correctAnswer === "string"
  );
}

function readQuestionContext(value: unknown): AttemptResultViewModel["question"] {
  const q = asObject(value);
  return typeof q.prompt === "string" && q.prompt !== "" ? { prompt: q.prompt, chapterName: typeof q.chapterName === "string" ? q.chapterName : "", conceptName: typeof q.conceptName === "string" ? q.conceptName : "" } : null;
}

function readAttemptResult(body: unknown, hasAutopsy: boolean): AttemptResultViewModel {
  const value = asObject(body);
  if (!isRenderableResult(value)) {
    throw new PracticeApiRequestError({ kind: "unexpected", message: MALFORMED_RESULT });
  }
  return {
    attemptId: typeof value.attemptId === "string" ? value.attemptId : "",
    questionId: typeof value.questionId === "string" ? value.questionId : "",
    isCorrect: value.isCorrect === true,
    chosenAnswer: typeof value.chosenAnswer === "string" ? value.chosenAnswer : "",
    correctAnswer: typeof value.correctAnswer === "string" ? value.correctAnswer : "",
    timeTakenSeconds: typeof value.timeSpentSeconds === "number" ? value.timeSpentSeconds : 0,
    expectedTimeSeconds: typeof value.expectedTimeSeconds === "number" ? value.expectedTimeSeconds : 60,
    solutionSteps: Array.isArray(value.solutionSteps) ? value.solutionSteps.filter((step): step is string => typeof step === "string") : [],
    question: readQuestionContext(value.question),
    hasAutopsy
  };
}

function readPendingAutopsy(body: unknown): { pending: boolean; hypothesis: { summary: string; supportingEvidence: string[] } | null } {
  const value = asObject(body);
  const pending = value.pending === true;
  const hypothesisValue = asObject(value.hypothesis);
  const hasHypothesis = typeof hypothesisValue.summary === "string";
  const supportingEvidence = Array.isArray(hypothesisValue.supportingEvidence) ? hypothesisValue.supportingEvidence.filter((e): e is string => typeof e === "string") : [];
  return {
    pending,
    hypothesis: hasHypothesis ? { summary: hypothesisValue.summary as string, supportingEvidence } : null
  };
}

export function createApiTrainingAdapter(fetchImpl: FetchLike = fetch): TrainingRecommendationAdapter {
  const attemptIdByQuestion = new Map<string, string>();
  let questionsPracticedSoFar = 0;
  // Phase 2 Unit 2: one in-flight start / submit per question -- a duplicate call (StrictMode's double mount effect, a double click) shares the first request instead of creating a second attempt or a second submission.
  const startFlights = createSingleFlight<QuestionViewModel>();
  const submitFlights = createSingleFlight<AttemptResultViewModel>();
  // Phase 2 Unit 4: concurrent recommendation reads (StrictMode's double mount, a double activation) share one request.
  const recommendationFlights = createSingleFlight<RecommendationViewModel>();
  const fetchRecommendation = () => recommendationFlights.run("next", async () => readRecommendation(await post("/v1/recommendation")));

  async function post(path: string, body?: unknown): Promise<unknown> {
    const result = await jsonRequest(fetchImpl, "POST", path, body ?? {});
    if (!result.ok) throw new PracticeApiRequestError(result.failure);
    return result.body;
  }

  async function get(path: string): Promise<unknown> {
    const result = await jsonRequest(fetchImpl, "GET", path);
    if (!result.ok) throw new PracticeApiRequestError(result.failure);
    return result.body;
  }

  async function startAttemptFor(questionId: string): Promise<QuestionViewModel> {
    const started = asObject(await post("/v1/attempts", { questionId }));
    const attemptId = typeof started.attemptId === "string" ? started.attemptId : "";
    if (!attemptId) {
      throw new PracticeApiRequestError({ kind: "unexpected", message: "Something went wrong. Please try again." });
    }
    attemptIdByQuestion.set(questionId, attemptId);
    return readQuestion(started.question);
  }

  // `timeTakenSeconds` is deliberately NOT sent: the server derives time spent from its own attempt events (D-034).
  async function submitAttemptFor(input: { questionId: string; chosenAnswer: string }): Promise<AttemptResultViewModel> {
    const attemptId = attemptIdByQuestion.get(input.questionId);
    if (!attemptId) {
      throw new PracticeApiRequestError({ kind: "unexpected", message: "Something went wrong. Please try again." });
    }
    const submitted = await post(`/v1/attempts/${attemptId}/submit`, { questionId: input.questionId, chosenAnswer: input.chosenAnswer });
    attemptIdByQuestion.delete(input.questionId);
    questionsPracticedSoFar += 1;

    return readAttemptResult(submitted, await isAutopsyPending(attemptId));
  }

  // Whether an autopsy hypothesis is actually pending is resolved via the
  // EXISTING getAutopsyForConfirmation read (never fabricated from the submit
  // response, which carries no such signal) -- see this file's own doc comment.
  async function isAutopsyPending(attemptId: string): Promise<boolean> {
    return get(`/v1/attempts/${attemptId}/autopsy`)
      .then((body) => readPendingAutopsy(body).pending)
      .catch(() => false);
  }

  return {
    async getDashboard(): Promise<DashboardViewModel> {
      const recommendation = await fetchRecommendation();
      return { studentDisplayName: "there", questionsPracticedSoFar, recommendation };
    },

    loadQuestion(questionId: string): Promise<QuestionViewModel> {
      return startFlights.run(questionId, () => startAttemptFor(questionId));
    },

    submitAnswer(input: { questionId: string; chosenAnswer: string; timeTakenSeconds: number }): Promise<AttemptResultViewModel> {
      return submitFlights.run(input.questionId, () => submitAttemptFor(input));
    },

    async getAttemptResult(attemptId: string): Promise<AttemptResultViewModel> {
      const body = await get(`/v1/attempts/${encodeURIComponent(attemptId)}/result`);
      return readAttemptResult(body, await isAutopsyPending(attemptId));
    },

    async getAutopsy(attemptId: string): Promise<AutopsyViewModel> {
      const { hypothesis } = readPendingAutopsy(await get(`/v1/attempts/${attemptId}/autopsy`));
      return { attemptId, observed: [], hypothesis };
    },

    async respondToAutopsy(_input: { attemptId: string; response: AutopsyResponse }): Promise<RecommendationViewModel> {
      return await fetchRecommendation();
    },

    async getNextRecommendation(): Promise<RecommendationViewModel> {
      return await fetchRecommendation();
    }
  };
}
