import { useState } from "react";
import { CandidatePanel } from "./components/CandidatePanel.js";
import { DecisionPanel } from "./components/DecisionPanel.js";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel.js";
import { EvidencePanel } from "./components/EvidencePanel.js";
import { ScenarioSelector } from "./components/ScenarioSelector.js";
import { getTrainingPlaygroundScenario, TRAINING_PLAYGROUND_SCENARIOS } from "./domain/scenarios.js";
import { runTrainingPlaygroundScenario } from "./domain/runScenario.js";
import type { TrainingPlaygroundRunResult } from "./domain/types.js";

export function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(TRAINING_PLAYGROUND_SCENARIOS[0]!.id);
  const [runResult, setRunResult] = useState<TrainingPlaygroundRunResult | null>(null);

  const scenario = getTrainingPlaygroundScenario(selectedScenarioId)!;

  function handleSelectScenario(scenarioId: string) {
    setSelectedScenarioId(scenarioId);
    // Selecting a different scenario clears any prior result -- never displays a result that
    // doesn't belong to the currently selected scenario (docs/DECISIONS.md D-057).
    setRunResult(null);
  }

  function handleRun() {
    setRunResult(runTrainingPlaygroundScenario(scenario));
  }

  function handleReset() {
    setRunResult(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>IPMAT AI — Training Lab Playground</h1>
        <p className="app-header__subtitle">Internal development tool. Not the production student experience.</p>
        <dl className="app-header__facts">
          <div>
            <dt>Current scenario</dt>
            <dd>{scenario.displayName}</dd>
          </div>
          <div>
            <dt>Student ID</dt>
            <dd>{scenario.fixture.studentId}</dd>
          </div>
          <div>
            <dt>Prep phase</dt>
            <dd>{scenario.fixture.prepPhase ? "supplied" : "not supplied"}</dd>
          </div>
          <div>
            <dt>Selected training mode</dt>
            <dd>{runResult ? runResult.systemResults.map((r) => r.systemId).join(", ") : "not run yet"}</dd>
          </div>
        </dl>
      </header>

      <ScenarioSelector scenarios={TRAINING_PLAYGROUND_SCENARIOS} selectedScenarioId={selectedScenarioId} onSelect={handleSelectScenario} />

      <div className="run-controls">
        <button type="button" className="run-button" onClick={handleRun}>
          Run scenario
        </button>
        <button type="button" className="reset-button" onClick={handleReset} disabled={!runResult}>
          Reset
        </button>
      </div>

      <EvidencePanel scenario={scenario} />
      <CandidatePanel scenario={scenario} runResult={runResult} />

      {runResult ? (
        <>
          <DecisionPanel runResult={runResult} />
          <DiagnosticsPanel runResult={runResult} />
        </>
      ) : (
        <p className="panel__note panel__note--pending">No result yet — select a scenario and click "Run scenario" to see the actual training decision.</p>
      )}
    </div>
  );
}
