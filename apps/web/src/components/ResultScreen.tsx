import { useState } from "react";
import type { AttemptResultViewModel } from "../adapter/index.js";
import { Button, Card, Screen } from "../design/index.js";

export function ResultScreen({ result, onSeeWhatHappened, onContinue }: { result: AttemptResultViewModel; onSeeWhatHappened: () => void; onContinue: () => void }) {
  const [showSolution, setShowSolution] = useState(false);
  // Solution steps are the server's authored worked solution. When none is stored the list is empty, and a "View solution" control that reveals nothing would be a control that does nothing -- so none is offered.
  const hasSolution = result.solutionSteps.length > 0;

  return (
    <Screen>
      <Card>
        <div className="result-banner">
          <div className={`result-icon ${result.isCorrect ? "correct" : "incorrect"}`} aria-hidden="true">
            {result.isCorrect ? "✓" : "✕"}
          </div>
          <h1 className="headline headline-compact">{result.isCorrect ? "Correct." : "Not quite."}</h1>
        </div>

        {result.question && (
          <div className="result-question">
            <p className="question-topic">
              {result.question.chapterName} &middot; {result.question.conceptName}
            </p>
            <p className="prompt-text">{result.question.prompt}</p>
          </div>
        )}

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
            {result.timeTakenSeconds}s <span className="fact-value-note">(expected {result.expectedTimeSeconds}s)</span>
          </span>
        </div>

        {hasSolution && (
          <>
            <Button variant="secondary" className="solution-toggle" aria-expanded={showSolution} aria-controls="solution-steps" onClick={() => setShowSolution((v) => !v)}>
              {showSolution ? "Hide solution" : "View solution"}
            </Button>

            {showSolution && (
              <ol className="solution-list" id="solution-steps">
                {result.solutionSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            )}
          </>
        )}
      </Card>

      <div className="btn-row">
        {result.hasAutopsy ? (
          <Button onClick={onSeeWhatHappened}>See what the system noticed</Button>
        ) : (
          <Button onClick={onContinue}>Continue to next question</Button>
        )}
      </div>
    </Screen>
  );
}
