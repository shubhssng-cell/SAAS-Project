import { fail, ok, type ValidationResult } from "./types.js";

/**
 * Compares the FIRST candidate's stated answer against a SECOND,
 * independent model call's re-derivation from the stem alone (docs/
 * QUESTION_ENGINE.md §5a — "also allow an independent model/process to
 * re-derive the answer"). This is a second, different kind of check from
 * verifyComputation(): that one is deterministic arithmetic; this one
 * catches cases where the arithmetic is internally consistent but the
 * question itself doesn't actually mean what the first model thought it
 * meant (a misreading both the generator and its own math agree on).
 */
export function compareReverification(input: { candidateAnswer: string; reDerivedAnswer: string }): ValidationResult {
  const normalize = (value: string) => value.replace(/[,\s]/g, "").toLowerCase();
  if (normalize(input.candidateAnswer) !== normalize(input.reDerivedAnswer)) {
    return fail(
      "answer_mismatch",
      "reDerivedAnswer",
      `Independent re-derivation ("${input.reDerivedAnswer}") disagrees with the candidate's stated answer ("${input.candidateAnswer}")`
    );
  }
  return ok();
}
