import type { TrainingPlaygroundScenario } from "../domain/types.js";

interface ScenarioSelectorProps {
  scenarios: TrainingPlaygroundScenario[];
  selectedScenarioId: string;
  onSelect: (scenarioId: string) => void;
}

export function ScenarioSelector({ scenarios, selectedScenarioId, onSelect }: ScenarioSelectorProps) {
  return (
    <section aria-labelledby="scenario-selector-heading" className="panel">
      <h2 id="scenario-selector-heading">Scenario catalog</h2>
      <div className="scenario-grid" role="radiogroup" aria-labelledby="scenario-selector-heading">
        {scenarios.map((scenario) => {
          const selected = scenario.id === selectedScenarioId;
          return (
            <button
              key={scenario.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "scenario-card scenario-card--selected" : "scenario-card"}
              onClick={() => onSelect(scenario.id)}
            >
              <span className="scenario-card__name">{scenario.displayName}</span>
              <span className="scenario-card__description">{scenario.description}</span>
              <ul className="scenario-card__evidence">
                {scenario.evidenceSummary.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
              <span className="scenario-card__systems">Runs: {scenario.systemsToRun.join(", ")}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
