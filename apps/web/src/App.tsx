import { useEffect, useMemo, useState } from "react";
import { createFixtureTrainingAdapter, type AttemptResultViewModel, type AutopsyViewModel, type DashboardViewModel, type QuestionViewModel, type RecommendationViewModel } from "./adapter/index.js";
import { AutopsyCard } from "./components/AutopsyCard.js";
import { Dashboard } from "./components/Dashboard.js";
import { NextTrainingCard } from "./components/NextTrainingCard.js";
import { QuestionPlayer } from "./components/QuestionPlayer.js";
import { ResultScreen } from "./components/ResultScreen.js";

type Screen =
  | { kind: "loading" }
  | { kind: "dashboard"; dashboard: DashboardViewModel }
  | { kind: "question"; question: QuestionViewModel }
  | { kind: "result"; result: AttemptResultViewModel }
  | { kind: "autopsy"; result: AttemptResultViewModel; autopsy: AutopsyViewModel }
  | { kind: "next"; recommendation: RecommendationViewModel };

/**
 * Owns the ONLY flow/session state in this app. Every training decision
 * shown here comes from `adapter.*` calls -- App.tsx never inspects
 * evidence, evaluates applicability, or picks a question itself. Swapping
 * `createFixtureTrainingAdapter()` for a real, persistence-backed
 * implementation of the same `TrainingRecommendationAdapter` interface is
 * the only change needed once the Training Recommendation Composition
 * Layer exists -- no component below this file changes.
 */
export function App() {
  const adapter = useMemo(() => createFixtureTrainingAdapter(), []);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    adapter.getDashboard().then((dashboard) => setScreen({ kind: "dashboard", dashboard }));
  }, [adapter]);

  async function startQuestion(questionId: string) {
    const question = await adapter.loadQuestion(questionId);
    setScreen({ kind: "question", question });
  }

  async function refreshDashboard() {
    const dashboard = await adapter.getDashboard();
    setScreen({ kind: "dashboard", dashboard });
  }

  async function handleAnswerSubmit(questionId: string, chosenAnswer: string, timeTakenSeconds: number) {
    const result = await adapter.submitAnswer({ questionId, chosenAnswer, timeTakenSeconds });
    setScreen({ kind: "result", result });
  }

  async function handleSeeWhatHappened(result: AttemptResultViewModel) {
    const autopsy = await adapter.getAutopsy(result.attemptId);
    setScreen({ kind: "autopsy", result, autopsy });
  }

  async function handleAutopsyResponse(attemptId: string, response: "confirmed" | "rejected") {
    const recommendation = await adapter.respondToAutopsy({ attemptId, response });
    setScreen({ kind: "next", recommendation });
  }

  async function handleContinueAfterResult() {
    const recommendation = await adapter.getNextRecommendation();
    setScreen({ kind: "next", recommendation });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="wordmark">
          IPMAT AI
          <small>Training</small>
        </div>
      </header>

      <main className="app-main">
        {screen.kind === "loading" && <p className="loading-text">Loading your dashboard…</p>}

        {screen.kind === "dashboard" && <Dashboard dashboard={screen.dashboard} onStart={() => startQuestion(screen.dashboard.recommendation.questionId ?? "q-reverse-1")} />}

        {screen.kind === "question" && (
          <QuestionPlayer question={screen.question} onSubmit={(answer, seconds) => handleAnswerSubmit(screen.question.questionId, answer, seconds)} />
        )}

        {screen.kind === "result" && (
          <ResultScreen result={screen.result} onSeeWhatHappened={() => handleSeeWhatHappened(screen.result)} onContinue={handleContinueAfterResult} />
        )}

        {screen.kind === "autopsy" && <AutopsyCard autopsy={screen.autopsy} onRespond={(response) => handleAutopsyResponse(screen.autopsy.attemptId, response)} />}

        {screen.kind === "next" && (
          <NextTrainingCard
            recommendation={screen.recommendation}
            onContinue={() => (screen.recommendation.questionId ? startQuestion(screen.recommendation.questionId) : refreshDashboard())}
          />
        )}
      </main>
    </div>
  );
}
