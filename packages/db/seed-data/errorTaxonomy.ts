import type { ErrorCategory } from "@ipmat/examiner-lens";

export interface ErrorTaxonomyEntry {
  code: string;
  label: string;
  description: string;
  category: ErrorCategory;
}

/**
 * Small, deliberately curated starting set (docs/DATABASE.md §Error
 * Taxonomy) — grown over time from real confirmed Autopsy diagnoses, not
 * expanded speculatively now. There is no domain package for autopsy yet
 * (Phase 5), so this fixture lives directly in the db package.
 *
 * `category` uses the SAME 5-value vocabulary Examiner Lens error modes
 * use (docs/DECISIONS.md D-013) — one shared error taxonomy, not two.
 */
export const errorTaxonomySeed: ErrorTaxonomyEntry[] = [
  {
    code: "base_confusion",
    label: "Base confusion",
    description: "Applied a percentage change to the wrong base quantity (e.g. new value instead of original).",
    category: "misconception"
  },
  {
    code: "sign_error",
    label: "Sign error",
    description: "Treated an increase as a decrease, or vice versa, when combining percentage changes.",
    category: "misconception"
  },
  {
    code: "misread_question",
    label: "Misread question",
    description: "Answered a question different from the one actually asked (e.g. found the discount instead of the final price).",
    category: "interpretation_mistake"
  },
  {
    code: "careless_arithmetic",
    label: "Careless arithmetic",
    description: "Correct method, but a computational slip (multiplication, division, or rounding) produced the wrong number.",
    category: "calculation_mistake"
  },
  {
    code: "successive_change_error",
    label: "Successive change error",
    description: "Added/subtracted successive percentage changes instead of compounding them multiplicatively.",
    category: "method_selection_mistake"
  },
  {
    code: "percentage_point_confusion",
    label: "Percentage point confusion",
    description: "Confused an absolute percentage-point difference with a relative percentage change (or vice versa).",
    category: "interpretation_mistake"
  }
];
