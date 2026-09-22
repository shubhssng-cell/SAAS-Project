import type { ErrorTaxonomyEntry } from "../src/types.js";

/**
 * The SAME entries as `packages/db/seed-data/errorTaxonomy.ts` (Phase 5A
 * §8 — integrate the existing taxonomy, don't invent a second one). This
 * package cannot import that file directly (it lives in `@ipmat/db`,
 * which this package must not depend on — see docs/ARCHITECTURE.md §6),
 * so the same entries are restated here as a test fixture, the way a
 * real caller backed by Prisma would load them from the `error_taxonomies`
 * table.
 */
export const errorTaxonomyFixture: ErrorTaxonomyEntry[] = [
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
