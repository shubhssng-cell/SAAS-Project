import type { TrainingRequirement, TrainingSystemApplicability, TrainingSystemContext, TrainingSystemProvider, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { evaluateTrapLab } from "./applicability.js";
import { selectTrapLabQuestion } from "./selection.js";
import type { TrapLabRequirement } from "./types.js";

function isTrapLabRequirement(requirement: TrainingRequirement): requirement is TrapLabRequirement {
  const candidate = requirement as Partial<TrapLabRequirement>;
  return typeof candidate.targetErrorTaxonomyCode === "string" && (candidate.targetConceptName === undefined || typeof candidate.targetConceptName === "string");
}

/**
 * `@ipmat/training-systems`'s `TrainingSystemProvider` implementation for
 * Trap Lab (docs/DECISIONS.md D-056). `evaluate()` is the ONE
 * authoritative applicability decision; `select()` only ever runs on the
 * EXACT requirement `evaluate()` produced (enforced at runtime below as a
 * fail-closed defensive check).
 */
export class TrapLabProvider implements TrainingSystemProvider {
  readonly providerId = "trap-lab";

  evaluate(context: TrainingSystemContext): TrainingSystemApplicability {
    return evaluateTrapLab(context);
  }

  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome {
    if (!isTrapLabRequirement(applicability.requirement)) {
      return {
        status: "error",
        code: "invalid_context",
        explanation: "select() was invoked with a requirement that was not produced by this provider's own evaluate() -- an impossible execution condition, not an ordinary lack of matching content."
      };
    }

    return selectTrapLabQuestion(this.providerId, context, applicability.requirement, applicability.explanation);
  }
}
