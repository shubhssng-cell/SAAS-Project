import type { TrainingRequirement, TrainingSystemApplicability, TrainingSystemContext, TrainingSystemProvider, TrainingSystemSelectionOutcome } from "@ipmat/training-systems";
import { evaluateNoveltyTraining } from "./applicability.js";
import { selectNoveltyTrainingQuestion } from "./selection.js";
import { NON_STANDARD_NOVELTY_LEVELS } from "./types.js";
import type { NoveltyTrainingRequirement } from "./types.js";

function isNoveltyTrainingRequirement(requirement: TrainingRequirement): requirement is NoveltyTrainingRequirement {
  const candidate = requirement as Partial<NoveltyTrainingRequirement>;
  return (
    typeof candidate.targetConceptName === "string" &&
    typeof candidate.targetNoveltyLevel === "string" &&
    (NON_STANDARD_NOVELTY_LEVELS as readonly string[]).includes(candidate.targetNoveltyLevel)
  );
}

/**
 * `@ipmat/training-systems`'s `TrainingSystemProvider` implementation for
 * Novelty Training (docs/DECISIONS.md D-058). `evaluate()` is the ONE
 * authoritative applicability decision and never reads
 * `context.candidates`; `select()` only ever runs on the EXACT
 * requirement `evaluate()` produced (enforced at runtime below as a
 * fail-closed defensive check), and is the first point candidates are
 * read.
 */
export class NoveltyTrainingProvider implements TrainingSystemProvider {
  readonly providerId = "novelty-training";

  evaluate(context: TrainingSystemContext): TrainingSystemApplicability {
    return evaluateNoveltyTraining(context);
  }

  select(context: TrainingSystemContext, applicability: { requirement: TrainingRequirement; explanation: string }): TrainingSystemSelectionOutcome {
    if (!isNoveltyTrainingRequirement(applicability.requirement)) {
      return {
        status: "error",
        code: "invalid_context",
        explanation: "select() was invoked with a requirement that was not produced by this provider's own evaluate() -- an impossible execution condition, not an ordinary lack of matching content."
      };
    }

    return selectNoveltyTrainingQuestion(this.providerId, context, applicability.requirement, applicability.explanation);
  }
}
