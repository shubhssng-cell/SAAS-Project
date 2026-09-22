export type RejectionCode =
  | "malformed_output"
  | "blueprint_violation"
  | "out_of_syllabus"
  | "multiple_or_no_correct_answer"
  | "answer_mismatch"
  | "impossible_computation"
  | "unverifiable_answer"
  | "unsupported_completeness_claim"
  | "duplicate_risk"
  | "distractor_quality"
  | "missing_provenance"
  | "judge_ambiguous"
  | "judge_contradictory"
  | "judge_syllabus_irrelevant"
  | "judge_difficulty_dishonest"
  | "judge_multiple_answers"
  | "budget_exceeded"
  | "unverifiable_cost"
  | "answer_leakage_in_stem";

export interface ValidationIssue {
  code: RejectionCode;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((result) => result.issues);
  return { valid: issues.length === 0, issues };
}

export function ok(): ValidationResult {
  return { valid: true, issues: [] };
}

export function fail(code: RejectionCode, field: string, message: string): ValidationResult {
  return { valid: false, issues: [{ code, field, message }] };
}
