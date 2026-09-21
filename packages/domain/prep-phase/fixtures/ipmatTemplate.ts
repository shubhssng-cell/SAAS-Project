import type { PrepPhaseTemplateData } from "../src/types.js";

/**
 * Deliberately simple first curve for IPMAT (see docs/MASTER_PLAN.md Phase
 * 1 — "a first, deliberately simple curve, refine later with real cohort
 * data"). Only "Percentages" has a target because it's the only chapter
 * that exists in this vertical slice; adding a chapter means adding a key
 * to expectedCoverage, not changing this shape.
 */
export const ipmatPrepPhaseTemplate: PrepPhaseTemplateData = {
  examId: "ipmat-indore",
  examDate: "2027-01-15",
  phaseCurve: [
    { daysToExam: 210, expectedCoverage: { Percentages: 0.0 } },
    { daysToExam: 150, expectedCoverage: { Percentages: 0.25 } },
    { daysToExam: 90, expectedCoverage: { Percentages: 0.5 } },
    { daysToExam: 45, expectedCoverage: { Percentages: 0.75 } },
    { daysToExam: 14, expectedCoverage: { Percentages: 0.9 } },
    { daysToExam: 0, expectedCoverage: { Percentages: 1.0 } }
  ]
};
