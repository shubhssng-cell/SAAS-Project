import { useState } from "react";
import type { AttemptResultViewModel } from "../adapter/index.js";
import { Button, Card, Screen } from "../design/index.js";

export function ResultScreen({ result, onSeeWhatHappened, onContinue }: { result: AttemptResultViewModel; onSeeWhatHappened: () => void; onContinue: () => void }) {
  const [showSolution, setShowSolution] = useState(false);

  return (
    <Screen>
      <Card>
        <div className="result-banner">
          <div className={`result-icon ${result.isCorrect ? "correct" : "incorrect"}`}>{result.isCorrect ? "✓" : "✕"}</div>
          <h2 className="headline headline-compact">{result.isCorrect ? "Correct." : "Not quite."}</h2>
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

        <Button variant="secondary" className="solution-toggle" onClick={() => setShowSolution((v) => !v)}>
          {showSolution ? "Hide solution" : "View solution"}
        </Button>

        {showSolution && (
          <ol className="solution-list">
            {result.solutionSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
      </Card>

      <div className="btn-row">
        {result.hasAutopsy ? (
          <Button onClick={onSeeWhatHappened}>See what the system noticed</Button>
        ) : (
          <Button onClick={onContinue}>Continue</Button>
        )}
      </div>
    </Screen>
  );
}
