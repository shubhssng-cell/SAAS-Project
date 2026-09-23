import type { TrainingRequirement, TrainingSystemApplicability, TrainingSystemContext, TrainingSystemProvider, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { evaluateCalculationGym } from "./applicability.js";
import { selectCalculationGymQuestion } from "./selection.js";
import { CALCULATION_TRAINING_STAGES } from "./types.js";
import type { CalculationGymRequirement } from "./types.js";

function isCalculationGymRequirement(requirement: TrainingRequirement): requirement is CalculationGymRequirement {
  const candidate = requirement as Partial<CalculationGymRequirement>;
  return (
    typeof candidate.targetConceptName === "string" &&
    typeof candidate.stage === "string" &&
    (CALCULATION_TRAINING_STAGES as readonly string[]).includes(candidate.stage) &&
    typeof candidate.minComputationalLoad === "number" &&
    typeof candidate.requireMultiStep === "boolean" &&
    typeof candidate.requireTimePressured === "boolean"
  );
}

/**
 * `@ipmat/training-systems`'s `TrainingSystemProvider` implementation for
 * Calculation Gym (docs/DECISIONS.md D-054). `evaluate()` is the ONE
 * authoritative applicability decision; `select()` only ever runs on the
 * EXACT requirement `evaluate()` produced (enforced at runtime below as a
 * fail-closed defensive check — the shared contract's own type already
 * makes this the only supported call path via `runTrainingSystemProvider()`).
 */
export class CalculationGymProvider implements TrainingSystemProvider {
  readonly providerId = "calculation-gym";

  evaluate(context: TrainingSystemContext): TrainingSystemApplicability {
    return evaluateCalculationGym(context);
  }

  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome {
    if (!isCalculationGymRequirement(applicability.requirement)) {
      return {
        status: "error",
        code: "invalid_context",
        explanation: "select() was invoked with a requirement that was not produced by this provider's own evaluate() -- an impossible execution condition, not an ordinary lack of matching content."
      };
    }

    return selectCalculationGymQuestion(this.providerId, context, applicability.requirement, applicability.explanation);
  }
}
