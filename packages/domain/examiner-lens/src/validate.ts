import { hasConcept, type ConceptGraph } from "@ipmat/concept-graph";
import { ALL_TESTING_MODES, type ExaminerLensAnalysisData } from "./types.js";

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Phrases that assert or imply literal completeness. The product rule is
 * "known / mapped / covered / uncovered", never "every possible question"
 * (docs/QUESTION_ENGINE.md §3, docs/DECISIONS.md D-007) — this is a
 * concrete, testable guard against that rule quietly regressing in
 * authored or AI-generated text.
 */
const BANNED_COMPLETENESS_PHRASES = [
  "every possible question",
  "all possible questions",
  "complete coverage",
  "fully covers",
  "exhaustive list of",
  "every way this can be tested",
  "guaranteed to cover all",
  "mathematically complete"
];

export function findCompletenessClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_COMPLETENESS_PHRASES.filter((phrase) => lower.includes(phrase));
}

/**
 * Structural validation for an ExaminerLensAnalysisData object — checks
 * shape and internal consistency without calling any AI provider (this
 * package must be testable with deterministic fixtures alone; see
 * docs/QUESTION_ENGINE.md §8). This is NOT the full Phase 3 validation
 * pipeline (no AI-judge pass, no dedup check) — it's the structural gate
 * every Lens analysis must pass regardless of how it was produced.
 */
export function validateExaminerLensAnalysis(
  data: ExaminerLensAnalysisData,
  graph: ConceptGraph
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!hasConcept(graph, data.concept)) {
    issues.push({ field: "concept", message: `"${data.concept}" is not a concept in the supplied graph` });
  }
  if (data.whatIsTested.concept !== data.concept) {
    issues.push({ field: "whatIsTested.concept", message: "must match the top-level concept" });
  }
  if (data.testingModes.length === 0) {
    issues.push({ field: "testingModes", message: "at least one testing mode is required" });
  }
  for (const mode of data.testingModes) {
    if (!ALL_TESTING_MODES.includes(mode)) {
      issues.push({ field: "testingModes", message: `"${mode}" is not a recognized testing mode` });
    }
  }
  if (data.combinations.some((combination) => !hasConcept(graph, combination.concept))) {
    issues.push({ field: "combinations", message: "references a concept not present in the supplied graph" });
  }

  for (const [key, value] of Object.entries(data.difficultyDimensions)) {
    if (value < 0 || value > 1) {
      issues.push({ field: `difficultyDimensions.${key}`, message: "must be between 0 and 1" });
    }
  }

  const textFields: Array<[string, string]> = [
    ["whatIsTested.skill", data.whatIsTested.skill],
    ...data.errorModes.map((mode, i): [string, string] => [`errorModes[${i}].description`, mode.description]),
    ...data.combinations.map((c, i): [string, string] => [`combinations[${i}].relation.rationale`, c.relation.rationale])
  ];
  for (const [field, text] of textFields) {
    const claims = findCompletenessClaims(text);
    if (claims.length > 0) {
      issues.push({ field, message: `contains a false-completeness claim: "${claims[0]}"` });
    }
  }

  return { valid: issues.length === 0, issues };
}
