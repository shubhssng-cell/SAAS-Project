import { useState, type ReactNode } from "react";
import type { AttemptEvidenceViewModel, AttemptResultViewModel } from "../adapter/index.js";
import { Button, Card, Screen } from "../design/index.js";

/**
 * Phase 4 Unit 1 -- what was RECORDED about this attempt, in the server's own neutral sentences. Shown only on the result screen
 * (after submission); it states observations, never a reason, a label or a judgment, and is omitted entirely when unavailable.
 */
function EvidenceCard({ evidence }: { evidence: AttemptEvidenceViewModel | null | undefined }) {
  if (!evidence || evidence.observations.length === 0) return null;
  return (
    <Card>
      <h2 className="headline headline-compact" id="evidence-heading">
        What was recorded
      </h2>
      <ul className="evidence-list" aria-labelledby="evidence-heading">
        {evidence.observations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {evidence.notRecorded.map((line) => (
        <p key={line} className="subtext evidence-note">
          {line}
        </p>
      ))}
    </Card>
  );
}

export function ResultScreen({
  result,
  evidence,
  explanation,
  onSeeWhatHappened,
  onContinue
}: {
  result: AttemptResultViewModel;
  evidence?: AttemptEvidenceViewModel | null;
  /** Phase 4 Unit 2: the optional "possible explanation" card (an incorrect, submitted attempt only). Rendered after the recorded evidence. */
  explanation?: ReactNode;
  onSeeWhatHappened: () => void;
  onContinue: () => void;
}) {
  const [showSolution, setShowSolution] = useState(false);
  // Solution steps are the server's authored worked solution. When none is stored the list is empty, and a "View solution" control that reveals nothing would be a control that does nothing -- so none is offered.
  const hasSolution = result.solutionSteps.length > 0;

  // A skipped attempt is its own outcome -- no answer was submitted and nothing was graded -- so it is
  // never presented as "incorrect" and shows no answers, correct answer, or solution.
  if (result.status === "skipped") {
    return (
      <Screen>
        <Card>
          <div className="result-banner">
            <div className="result-icon skipped" aria-hidden="true">
              →
            </div>
            <h1 className="headline headline-compact">Skipped.</h1>
          </div>
          <p className="subtext">You skipped this question, so no answer was submitted.</p>
          <div className="fact-row">
            <span className="fact-label">Time spent</span>
            <span className="fact-value">
              {result.timeTakenSeconds}s <span className="fact-value-note">(expected {result.expectedTimeSeconds}s)</span>
            </span>
          </div>
        </Card>
        <EvidenceCard evidence={evidence} />
        <div className="btn-row">
          <Button onClick={onContinue}>Continue to next question</Button>
        </div>
      </Screen>
    );
  }

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

      <EvidenceCard evidence={evidence} />

      {explanation}

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
