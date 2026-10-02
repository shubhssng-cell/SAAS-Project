import type { TrainingRequirement, TrainingSystemApplicability, TrainingSystemContext, TrainingSystemProvider, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { evaluateRevision } from "./applicability.js";
import { selectRevisionQuestion } from "./selection.js";
import type { RevisionTrainingRequirement } from "./types.js";

function isRevisionRequirement(requirement: TrainingRequirement): requirement is RevisionTrainingRequirement {
  return typeof (requirement as Partial<RevisionTrainingRequirement>).targetConceptName === "string";
}

/**
 * `@ipmat/training-systems`'s `TrainingSystemProvider` for Revision (docs/DECISIONS.md D-081):
 * deliberate re-exposure of a concept the student has attempted before but not for a while.
 * `evaluate()` is the ONE authoritative applicability decision and never reads
 * `context.candidates`; `select()` only runs on the exact requirement `evaluate()` produced.
 */
export class RevisionTrainingProvider implements TrainingSystemProvider {
  readonly providerId = "revision-training";

  evaluate(context: TrainingSystemContext): TrainingSystemApplicability {
    return evaluateRevision(context);
  }

  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome {
    if (!isRevisionRequirement(applicability.requirement)) {
      return {
        status: "error",
        code: "invalid_context",
        explanation: "select() was invoked with a requirement that was not produced by this provider's own evaluate() -- an impossible execution condition, not an ordinary lack of matching content."
      };
    }
    return selectRevisionQuestion(this.providerId, context, applicability.requirement, applicability.explanation);
  }
}
