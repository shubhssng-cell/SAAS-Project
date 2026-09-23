import type { TrainingRequirement, TrainingSystemApplicability, TrainingSystemContext, TrainingSystemProvider, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { evaluatePressureTraining } from "./applicability.js";
import { selectPressureTrainingQuestion } from "./selection.js";
import { PRESSURE_DIMENSIONS } from "./types.js";
import type { PressureTrainingRequirement } from "./types.js";

function isPressureTrainingRequirement(requirement: TrainingRequirement): requirement is PressureTrainingRequirement {
  const candidate = requirement as Partial<PressureTrainingRequirement>;
  return (
    typeof candidate.targetConceptName === "string" &&
    typeof candidate.evidencedDimension === "string" &&
    (PRESSURE_DIMENSIONS as readonly string[]).includes(candidate.evidencedDimension)
  );
}

/**
 * `@ipmat/training-systems`'s `TrainingSystemProvider` implementation for
 * Pressure Training (docs/DECISIONS.md D-061). `evaluate()` is the ONE
 * authoritative applicability decision and never reads `context.candidates`;
 * `select()` only ever runs on the EXACT requirement `evaluate()` produced
 * (enforced at runtime below as a fail-closed defensive check), and is the
 * first point candidates are read.
 */
export class PressureTrainingProvider implements TrainingSystemProvider {
  readonly providerId = "pressure-training";

  evaluate(context: TrainingSystemContext): TrainingSystemApplicability {
    return evaluatePressureTraining(context);
  }

  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome {
    if (!isPressureTrainingRequirement(applicability.requirement)) {
      return {
        status: "error",
        code: "invalid_context",
        explanation: "select() was invoked with a requirement that was not produced by this provider's own evaluate() -- an impossible execution condition, not an ordinary lack of matching content."
      };
    }

    return selectPressureTrainingQuestion(this.providerId, context, applicability.requirement, applicability.explanation);
  }
}
