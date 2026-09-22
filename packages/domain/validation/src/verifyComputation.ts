import { evaluate } from "mathjs";
import { fail, ok, type ValidationResult } from "./types.js";

const EPSILON = 1e-6;

/**
 * `computation` comes from AI output — untrusted input — and mathjs's
 * `evaluate()` has had property-injection advisories (GHSA-29qv-4j9f-fjw5,
 * GHSA-jvff-x2qm-6286; fixed in mathjs 15.2.0, which this package pins).
 * As defense in depth regardless of the patched version, only plain
 * arithmetic characters are allowed through at all — no identifiers, no
 * object/property syntax, nothing mathjs's expression parser could
 * interpret as anything other than a number. A computation that needs
 * more than digits and + - * / ^ ( ) . , is rejected outright, not
 * evaluated.
 */
const SAFE_ARITHMETIC_PATTERN = /^[\d\s+\-*/^().,]+$/;

/**
 * Independent, deterministic re-derivation (docs/QUESTION_ENGINE.md §5a) —
 * this is the ONLY check that decides whether the numeric answer is
 * correct. "The LLM says the answer is X" is never sufficient on its own;
 * mathjs evaluates the candidate's own stated computation expression
 * (plain arithmetic — numbers, + - * / ^ (), no free variables) completely
 * independently of the LLM, and the result must match both the
 * candidate's `expectedAnswer` and (numerically) its `correctAnswer`.
 */
export function verifyComputation(input: {
  computation: string;
  expectedAnswer: number;
  correctAnswer: string;
}): ValidationResult {
  if (!SAFE_ARITHMETIC_PATTERN.test(input.computation)) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      "Computation contains characters outside plain arithmetic (digits, + - * / ^ ( ) . ,) and was rejected without evaluation"
    );
  }

  let recomputed: unknown;
  try {
    recomputed = evaluate(input.computation);
  } catch (error) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation could not be evaluated: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof recomputed !== "number" || !Number.isFinite(recomputed)) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation did not evaluate to a finite number (got ${JSON.stringify(recomputed)})`
    );
  }

  if (Math.abs(recomputed - input.expectedAnswer) > EPSILON) {
    return fail(
      "answer_mismatch",
      "groundTruthDerivation.expectedAnswer",
      `Independently recomputed value (${recomputed}) does not match the candidate's stated expectedAnswer (${input.expectedAnswer})`
    );
  }

  // Fail closed (Phase 3.1 §3): a correctAnswer that cannot be parsed as a
  // plain number is NOT skipped — it cannot be independently verified, so
  // it is rejected outright. Silently accepting an unparseable answer
  // (the previous behavior) meant a candidate could pass verification
  // despite never actually having its stated answer checked at all.
  const correctAnswerNumeric = parseNumeric(input.correctAnswer);
  if (correctAnswerNumeric === null) {
    return fail(
      "unverifiable_answer",
      "correctAnswer",
      `correctAnswer "${input.correctAnswer}" could not be parsed as a plain number and cannot be independently verified`
    );
  }
  if (Math.abs(recomputed - correctAnswerNumeric) > EPSILON) {
    return fail(
      "answer_mismatch",
      "correctAnswer",
      `Independently recomputed value (${recomputed}) does not match the stated correctAnswer ("${input.correctAnswer}")`
    );
  }

  return ok();
}

/**
 * Parses a numeric answer string. Supports the common legitimate formats
 * this project's questions actually use — plain integers/decimals,
 * thousands separators, a leading ₹/$/Rs. currency marker, and a trailing
 * `%` sign (Phase 3.1 §3: "support common legitimate formats where
 * practical, but do not over-engineer this phase"). Anything else —
 * fractions, ranges, units other than currency, "approximately", etc. —
 * returns null, which the caller now treats as a hard failure
 * (`unverifiable_answer`), never a silent skip.
 */
function parseNumeric(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^(₹|\$|Rs\.?)\s*/i, "")
    .replace(/%$/, "")
    .replace(/,/g, "")
    .trim();
  if (cleaned.length === 0 || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
