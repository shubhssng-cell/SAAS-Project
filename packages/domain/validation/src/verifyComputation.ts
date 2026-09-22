import { evaluate } from "mathjs";
import { fail, ok, type ValidationResult } from "./types.js";

const EPSILON = 1e-6;

/**
 * The exact supported grammar (Phase 3.1.1 §2), and nothing more:
 * digits, whitespace, a decimal point, and the six operators
 * `+ - * / ^ ( )`. No comma. Earlier versions of this allowlist included
 * `,`, on the theory that it might support thousands-separator input —
 * but mathjs's `evaluate()` treats a top-level comma as a STATEMENT
 * separator, not a grouping character, so `"1,000"` was never actually
 * being read as the number 1000; it risked evaluating as a two-element
 * sequence instead. That character served no real purpose and is removed
 * (docs/DECISIONS.md D-028). `computation` is meant to be a single plain
 * arithmetic expression the AI derived, in numerals — comma-formatted
 * numbers, scientific notation, and named constants/functions are all
 * out of scope by design, not an oversight.
 */
const SAFE_ARITHMETIC_PATTERN = /^[\d\s+\-*/^().]+$/;

/** No legitimate percentages-exam computation needs a string anywhere near this long. */
const MAX_COMPUTATION_LENGTH = 200;

/** No legitimate numeric literal in this domain needs anywhere near this many digits; this exists specifically to block pathological inputs like a 24-digit number raised to another 12-digit number. */
const MAX_NUMERIC_LITERAL_DIGITS = 15;

/** Chained exponentiation (e.g. repeated `^`) is the primary way a short, charset-legal string can still be computationally explosive (tower exponentiation). Real percentage/ratio arithmetic essentially never needs more than one `^`; this cap is deliberately generous relative to that, not tight against it. */
const MAX_EXPONENTIATION_OPERATORS = 3;

/** A real Percentages-chapter answer is never anywhere near this large; a result beyond it indicates a pathological or nonsensical expression, not a legitimate computation this pipeline should trust. */
const MAX_RESULT_MAGNITUDE = 1e12;

/**
 * Independent, deterministic re-derivation (docs/QUESTION_ENGINE.md §5a) —
 * this is the ONLY check that decides whether the numeric answer is
 * correct. "The LLM says the answer is X" is never sufficient on its own;
 * mathjs evaluates the candidate's own stated computation expression
 * (plain arithmetic — numbers, + - * / ^ (), no free variables) completely
 * independently of the LLM, and the result must match both the
 * candidate's `expectedAnswer` and (numerically) its `correctAnswer`.
 *
 * Every check before `evaluate()` is called is a deterministic, syntactic
 * gate on UNTRUSTED (AI-generated) text — length, charset, numeric-literal
 * magnitude, and operator complexity are all rejected outright, without
 * ever reaching the evaluator, before any evaluation is attempted. This is
 * intentionally a narrow arithmetic verifier, not a general-purpose math
 * parser or sandboxed interpreter: expanding the grammar (scientific
 * notation, functions, comma-formatted numbers) is a deliberate future
 * decision, not a gap to quietly patch over (docs/DECISIONS.md D-018,
 * D-028).
 */
export function verifyComputation(input: {
  computation: string;
  expectedAnswer: number;
  correctAnswer: string;
}): ValidationResult {
  if (input.computation.length > MAX_COMPUTATION_LENGTH) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation is ${input.computation.length} characters long, exceeding the ${MAX_COMPUTATION_LENGTH}-character limit for a plain arithmetic expression, and was rejected without evaluation`
    );
  }

  if (!SAFE_ARITHMETIC_PATTERN.test(input.computation)) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      "Computation contains characters outside the supported grammar (digits, whitespace, . and + - * / ^ ( )) and was rejected without evaluation"
    );
  }

  const exponentiationCount = (input.computation.match(/\^/g) ?? []).length;
  if (exponentiationCount > MAX_EXPONENTIATION_OPERATORS) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation uses ${exponentiationCount} '^' operators, exceeding the ${MAX_EXPONENTIATION_OPERATORS}-operator complexity limit, and was rejected without evaluation`
    );
  }

  const numericLiterals = input.computation.match(/\d+/g) ?? [];
  const oversizedLiteral = numericLiterals.find((literal) => literal.length > MAX_NUMERIC_LITERAL_DIGITS);
  if (oversizedLiteral) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation contains a ${oversizedLiteral.length}-digit numeric literal, exceeding the ${MAX_NUMERIC_LITERAL_DIGITS}-digit limit, and was rejected without evaluation`
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

  if (Math.abs(recomputed) > MAX_RESULT_MAGNITUDE) {
    return fail(
      "impossible_computation",
      "groundTruthDerivation.computation",
      `Computation evaluated to ${recomputed}, exceeding the plausible magnitude bound (${MAX_RESULT_MAGNITUDE}) for this domain, and was rejected`
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
 * (`unverifiable_answer`), never a silent skip. Note this function parses
 * `correctAnswer` (a short, standalone answer string), which is a
 * different field with different, legitimate comma semantics than
 * `computation` (a full arithmetic expression, which never needs a comma
 * — see `SAFE_ARITHMETIC_PATTERN` above).
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
