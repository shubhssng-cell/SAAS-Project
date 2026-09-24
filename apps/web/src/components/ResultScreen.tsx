import { useState } from "react";
import type { AttemptResultViewModel } from "../adapter/index.js";

export function ResultScreen({ result, onSeeWhatHappened, onContinue }: { result: AttemptResultViewModel; onSeeWhatHappened: () => void; onContinue: () => void }) {
  const [showSolution, setShowSolution] = useState(false);

  return (
    <div className="screen">
      <div className="card">
        <div className="result-banner">
          <div className={`result-icon ${result.isCorrect ? "correct" : "incorrect"}`}>{result.isCorrect ? "✓" : "✕"}</div>
          <h2 className="headline" style={{ margin: 0, fontSize: "1.35rem" }}>
            {result.isCorrect ? "Correct." : "Not quite."}
          </h2>
        </div>

        <div className="fact-row">
          <span className="fact-label">Your answer</span>
          <span className="fact-value">{result.chosenAnswer}</span>
        </div>
        {!result.isCorrect && (
          <div className="fact-row">
            <span className="fact-label">Correct answer</span>
            <span className="fact-value">{result.correctAnswer}</span>
          </div>
        )}
        <div className="fact-row">
          <span className="fact-label">Time taken</span>
          <span className="fact-value">
            {result.timeTakenSeconds}s <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>(expected {result.expectedTimeSeconds}s)</span>
          </span>
        </div>

        <button type="button" className="btn btn-secondary" style={{ marginTop: 20 }} onClick={() => setShowSolution((v) => !v)}>
          {showSolution ? "Hide solution" : "View solution"}
        </button>

        {showSolution && (
          <ol className="solution-list">
            {result.solutionSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="btn-row">
        {result.hasAutopsy ? (
          <button type="button" className="btn btn-primary" onClick={onSeeWhatHappened}>
            See what the system noticed
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onContinue}>
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
