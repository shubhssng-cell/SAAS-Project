import type { TrainingRequirement, TrainingSystemApplicability, TrainingSystemContext, TrainingSystemProvider, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { evaluateSpeedLab } from "./applicability.js";
import { selectSpeedLabQuestion } from "./selection.js";
import { SPEED_LAB_STAGES } from "./types.js";
import type { SpeedLabRequirement } from "./types.js";

function isSpeedLabRequirement(requirement: TrainingRequirement): requirement is SpeedLabRequirement {
  const candidate = requirement as Partial<SpeedLabRequirement>;
  return (
    typeof candidate.targetConceptName === "string" &&
    typeof candidate.stage === "string" &&
    (SPEED_LAB_STAGES as readonly string[]).includes(candidate.stage) &&
    (candidate.maxConceptualLoad === null || typeof candidate.maxConceptualLoad === "number") &&
    typeof candidate.requireTimePressured === "boolean"
  );
}

/**
 * `@ipmat/training-systems`'s `TrainingSystemProvider` implementation for
 * Speed Lab (docs/DECISIONS.md D-055). `evaluate()` is the ONE
 * authoritative applicability decision; `select()` only ever runs on the
 * EXACT requirement `evaluate()` produced (enforced at runtime below as a
 * fail-closed defensive check).
 */
export class SpeedLabProvider implements TrainingSystemProvider {
  readonly providerId = "speed-lab";

  evaluate(context: TrainingSystemContext): TrainingSystemApplicability {
    return evaluateSpeedLab(context);
  }

  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome {
    if (!isSpeedLabRequirement(applicability.requirement)) {
      return {
        status: "error",
        code: "invalid_context",
        explanation: "select() was invoked with a requirement that was not produced by this provider's own evaluate() -- an impossible execution condition, not an ordinary lack of matching content."
      };
    }

    return selectSpeedLabQuestion(this.providerId, context, applicability.requirement, applicability.explanation);
  }
}
