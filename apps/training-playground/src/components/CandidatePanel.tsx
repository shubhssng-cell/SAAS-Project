import type { TrainingPlaygroundRunResult, TrainingPlaygroundScenario } from "../domain/types.js";
import { SYSTEM_DISPLAY_NAMES } from "./outcomePresentation.js";

interface CandidatePanelProps {
  scenario: TrainingPlaygroundScenario;
  runResult: TrainingPlaygroundRunResult | null;
}

/**
 * Shows only structural Question DNA metadata -- never `correctAnswer` (a
 * field `AutopsyQuestionContext` does not even carry, by design, D-052).
 * The public contracts this playground calls report per-run AGGREGATE
 * exclusion counts (`excludedMalformedCount`/`excludedIneligibleCount`),
 * not a per-candidate exclusion reason -- this panel is honest about that
 * limitation rather than re-deriving one by reimplementing a provider's
 * own eligibility rules here (docs/DECISIONS.md D-057).
 */
export function CandidatePanel({ scenario, runResult }: CandidatePanelProps) {
  const selectedQuestionIdsBySystem = new Map<string, string[]>();
  if (runResult) {
    for (const systemResult of runResult.systemResults) {
      if (systemResult.outcome.status === "selected") {
        const list = selectedQuestionIdsBySystem.get(systemResult.outcome.question.questionId) ?? [];
        list.push(SYSTEM_DISPLAY_NAMES[systemResult.systemId] ?? systemResult.systemId);
        selectedQuestionIdsBySystem.set(systemResult.outcome.question.questionId, list);
      }
    }
  }

  return (
    <section aria-labelledby="candidate-panel-heading" className="panel">
      <h2 id="candidate-panel-heading">Candidate questions</h2>
      <table className="candidate-table">
        <thead>
          <tr>
            <th scope="col">Question ID</th>
            <th scope="col">Concept</th>
            <th scope="col">Pattern family</th>
            <th scope="col">Taxonomy cell</th>
            <th scope="col">Trap code</th>
            <th scope="col">Expected time</th>
            <th scope="col">Conceptual load</th>
            <th scope="col">Novelty</th>
            <th scope="col">Testing modes</th>
            <th scope="col">State</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {scenario.fixture.candidates.map((candidate) => {
            const selectedBy = selectedQuestionIdsBySystem.get(candidate.question.questionId);
            return (
              <tr key={candidate.question.questionId} className={selectedBy ? "candidate-row--selected" : undefined}>
                <td>{candidate.question.questionId}</td>
                <td>{candidate.question.conceptName}</td>
                <td>{candidate.question.patternFamilyName}</td>
                <td>{candidate.question.patternTaxonomyCellId}</td>
                <td>{candidate.question.trapErrorTaxonomyCode ?? "—"}</td>
                <td>{candidate.expectedTimeSeconds}s</td>
                <td>{candidate.question.difficultyDimensions.conceptualLoad.toFixed(2)}</td>
                <td>{candidate.question.noveltyLevel}</td>
                <td>{candidate.question.testingModes.join(", ")}</td>
                <td>
                  <span className={`badge badge--${candidate.validationState === "published" ? "selected" : "not-applicable"}`}>{candidate.validationState}</span>
                </td>
                <td>{selectedBy ? `Selected by ${selectedBy.join(", ")}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {runResult && (
        <div className="candidate-diagnostics">
          <p className="panel__note">
            Aggregate exclusion counts from each system's diagnostics (the public contract reports counts only, not which specific candidate was excluded or why).
          </p>
          <ul>
            {runResult.systemResults.map((systemResult) => {
              const outcome = systemResult.outcome;
              if (!("diagnostics" in outcome) || !outcome.diagnostics || !("candidatesConsidered" in outcome.diagnostics)) return null;
              const d = outcome.diagnostics;
              return (
                <li key={systemResult.systemId}>
                  {SYSTEM_DISPLAY_NAMES[systemResult.systemId] ?? systemResult.systemId}: considered {d.candidatesConsidered}, malformed {d.excludedMalformedCount}, ineligible{" "}
                  {"excludedIneligibleCount" in d ? d.excludedIneligibleCount : "—"}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
