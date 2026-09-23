import { makeAttemptRecord, makeCandidate, makeConfirmedRepairPlan, PLAYGROUND_STUDENT_ID } from "./builders.js";
import type { TrainingPlaygroundScenario } from "./types.js";

/**
 * The centralized, typed fixture catalog (docs/DECISIONS.md D-057). Every
 * scenario is independently runnable and fully deterministic -- clearly
 * synthetic data only, never implying a real student's history.
 * `expectedOutcomes` is for regression/testing purposes ONLY; the UI
 * always displays the actual outcome `runTrainingPlaygroundScenario()`
 * returns, never this field.
 */
export const TRAINING_PLAYGROUND_SCENARIOS: TrainingPlaygroundScenario[] = [
  {
    id: "calculation-friction",
    displayName: "Calculation friction",
    description: "Enough evidence for Calculation Gym applicability: a clean accuracy gap between low- and high-computational-load attempts on the same concept.",
    evidenceSummary: [
      "5 correct attempts on low-computationalLoad questions (computationalLoad 0.1)",
      "5 incorrect attempts on high-computationalLoad questions (computationalLoad 0.9)",
      "Both slices meet the minimum-observations threshold",
      "Observed accuracy gap: 100% (low load) vs. 0% (high load)"
    ],
    systemsToRun: ["calculation-gym"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: true, computationalLoad: 0.1 })),
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: false, computationalLoad: 0.9 }))
      ],
      candidates: [makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.7, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 } })]
    },
    expectedOutcomes: [{ systemId: "calculation-gym", status: "selected" }]
  },

  {
    id: "speed-inefficiency",
    displayName: "Speed inefficiency",
    description: "Enough evidence for Speed Lab applicability: repeated correct-but-slow attempts on conceptually easy, hint-free, non-time-pressured questions.",
    evidenceSummary: [
      "5 correct, hint-free attempts, each taking 135s against an expected 90s (speedRatio 1.5)",
      "All 5 attempts are on low-conceptualLoad questions (conceptualLoad 0.1)",
      "None of the attempts used a hint or carried the time_pressured testing mode",
      "Observed correct-and-slow fraction: 100% of the eligible population"
    ],
    systemsToRun: ["speed-lab"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: true, conceptualLoad: 0.1, timeTakenSeconds: 135, expectedTimeSeconds: 90 })),
      candidates: [makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 } })]
    },
    expectedOutcomes: [{ systemId: "speed-lab", status: "selected" }]
  },

  {
    id: "trap-recurrence",
    displayName: "Trap recurrence",
    description: "Repeated incorrect attempts on distinct questions whose designers tagged the SAME trap-taxonomy code -- at least 2 distinct failing question IDs.",
    evidenceSummary: [
      "2 distinct questions, each incorrect, both designed with trap-taxonomy code \"base_confusion\"",
      "The two failing question IDs are genuinely distinct (not the same question retried)",
      "Candidate-level pattern-match evidence only (docs/DECISIONS.md D-056)"
    ],
    systemsToRun: ["trap-lab"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [makeAttemptRecord({ isCorrect: false, trapErrorTaxonomyCode: "base_confusion" }), makeAttemptRecord({ isCorrect: false, trapErrorTaxonomyCode: "base_confusion" })],
      candidates: [makeCandidate({ conceptName: "Percentages", trapErrorTaxonomyCode: "base_confusion" })],
      errorTaxonomy: [{ code: "base_confusion", label: "Base confusion", description: "Confuses the base of a percentage change.", category: "trap" }]
    },
    expectedOutcomes: [{ systemId: "trap-lab", status: "selected" }]
  },

  {
    id: "repair-first",
    displayName: "Repair first",
    description: "A confirmed RepairPlan exists and a candidate directly matches its target taxonomy cell and trap code -- training orchestration attempts, and succeeds at, targeted repair before considering anything else.",
    evidenceSummary: [
      "One confirmed RepairPlan (student-confirmed diagnosis) targeting concept \"Percentages\", taxonomy cell \"cell-reverse-standard\", trap code \"base_confusion\"",
      "One published candidate matches that exact taxonomy cell AND trap code (the strongest match tier)"
    ],
    systemsToRun: ["training-orchestration"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [],
      candidates: [makeCandidate({ conceptName: "Percentages", patternTaxonomyCellId: "cell-reverse-standard", trapErrorTaxonomyCode: "base_confusion" })],
      activeRepairPlans: [{ plan: makeConfirmedRepairPlan() }]
    },
    expectedOutcomes: [{ systemId: "training-orchestration", status: "selected", note: "targeted_repair" }]
  },

  {
    id: "repair-fallback",
    displayName: "Repair fallback",
    description: "A confirmed RepairPlan exists but no candidate exists for its target concept -- targeted repair returns no_match, and orchestration's existing fallback policy tries adaptive practice next.",
    evidenceSummary: [
      "One confirmed RepairPlan targeting concept \"Percentages\"",
      "The only available published candidate is for a DIFFERENT concept (\"Ratio\") -- repair selection has nothing to match against",
      "No mastery data exists yet for \"Ratio\", so the Ratio candidate represents an unattempted taxonomy cell (a coverage gap)"
    ],
    systemsToRun: ["training-orchestration"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [],
      candidates: [makeCandidate({ conceptName: "Ratio", patternFamilyName: "Ratio Comparison", patternTaxonomyCellId: "cell-ratio-standard" })],
      activeRepairPlans: [{ plan: makeConfirmedRepairPlan() }]
    },
    expectedOutcomes: [{ systemId: "training-orchestration", status: "selected", note: "adaptive_practice; wasFallbackFromRepair=true" }]
  },

  {
    id: "adaptive-coverage-gap",
    displayName: "Adaptive coverage gap",
    description: "No confirmed RepairPlan exists and no specialized system is in play -- adaptive selection alone finds a valid coverage-driven candidate (a taxonomy cell this student has never attempted).",
    evidenceSummary: [
      "No confirmed RepairPlan is active",
      "No attempt history exists at all for this student",
      "One published candidate exists for a taxonomy cell with zero recorded attempts -- an observable coverage gap"
    ],
    systemsToRun: ["training-orchestration"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [],
      candidates: [makeCandidate({ conceptName: "Percentages" })]
    },
    expectedOutcomes: [{ systemId: "training-orchestration", status: "selected", note: "adaptive_practice; wasFallbackFromRepair=false" }]
  },

  {
    id: "insufficient-evidence",
    displayName: "Insufficient evidence",
    description: "No attempt history exists at all -- none of the three specialized systems can honestly claim applicability, and each fails closed rather than guessing.",
    evidenceSummary: ["Zero attempt records supplied for this student", "No calculation, speed, or trap-recurrence evidence exists to evaluate"],
    systemsToRun: ["calculation-gym", "speed-lab", "trap-lab"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [],
      candidates: []
    },
    expectedOutcomes: [
      { systemId: "calculation-gym", status: "not_applicable" },
      { systemId: "speed-lab", status: "not_applicable" },
      { systemId: "trap-lab", status: "not_applicable" }
    ]
  },

  {
    id: "candidate-filtering",
    displayName: "Candidate filtering",
    description: "The same calculation-friction evidence as scenario 1, but the candidate pool now includes an unpublished candidate, a structurally malformed candidate, and a candidate below the required computational-load floor -- Calculation Gym's own filtering excludes each correctly.",
    evidenceSummary: [
      "Same calculation-friction evidence as \"Calculation friction\" (5 low-load correct, 5 high-load incorrect)",
      "Candidate pool includes: one draft (unpublished) high-load candidate, one structurally malformed high-load candidate, one published but too-low-load candidate, and one genuinely qualifying candidate"
    ],
    systemsToRun: ["calculation-gym"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: true, computationalLoad: 0.1 })),
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: false, computationalLoad: 0.9 }))
      ],
      candidates: [
        makeCandidate(
          { conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.7, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 } },
          { validationState: "draft" }
        ),
        (() => {
          const malformed = makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.7, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 } });
          // Deliberately corrupted, mirroring @ipmat/calculation-gym's own test fixtures for its malformed-candidate guard.
          (malformed.question as unknown as Record<string, unknown>).difficultyDimensions = undefined;
          return malformed;
        })(),
        makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.1, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 } }),
        makeCandidate({ conceptName: "Percentages", difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.6, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 } })
      ]
    },
    expectedOutcomes: [{ systemId: "calculation-gym", status: "selected", note: "excludedMalformedCount=1, excludedIneligibleCount=2" }]
  },

  {
    id: "no-eligible-question",
    displayName: "No eligible question",
    description: "Trap recurrence is genuinely detected, but every available candidate either carries the wrong trap code or is unpublished -- Trap Lab remains applicable, yet has nothing eligible to select.",
    evidenceSummary: [
      "Same trap-recurrence evidence as \"Trap recurrence\" (2 distinct failing questions, code \"base_confusion\")",
      "One candidate carries a DIFFERENT trap code",
      "One candidate carries the right code but is still a draft (unpublished)"
    ],
    systemsToRun: ["trap-lab"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [makeAttemptRecord({ isCorrect: false, trapErrorTaxonomyCode: "base_confusion" }), makeAttemptRecord({ isCorrect: false, trapErrorTaxonomyCode: "base_confusion" })],
      candidates: [
        makeCandidate({ conceptName: "Percentages", trapErrorTaxonomyCode: "other_code" }),
        makeCandidate({ conceptName: "Percentages", trapErrorTaxonomyCode: "base_confusion" }, { validationState: "draft" })
      ]
    },
    expectedOutcomes: [{ systemId: "trap-lab", status: "no_eligible_question" }]
  },

  {
    id: "mixed-evidence",
    displayName: "Mixed evidence",
    description:
      "Calculation friction, speed inefficiency, trap recurrence, AND a confirmed RepairPlan are all simultaneously observable for the same student and concept. Each specialized system independently reports applicable -- but training orchestration, using its own unmodified precedence policy, picks targeted repair.",
    evidenceSummary: [
      "5 correct low-computationalLoad + 5 incorrect high-computationalLoad attempts (calculation-friction-shaped, conceptualLoad kept high to stay out of Speed Lab's evidence)",
      "5 correct, hint-free, slow attempts on low-conceptualLoad questions (speed-inefficiency-shaped)",
      "2 distinct incorrect attempts sharing trap code \"base_confusion\" (trap-recurrence-shaped)",
      "One confirmed RepairPlan targeting the same concept, taxonomy cell, and trap code",
      "Three candidates, each qualifying for exactly one of Calculation Gym / Speed Lab, and one qualifying for both Trap Lab and targeted repair"
    ],
    systemsToRun: ["calculation-gym", "speed-lab", "trap-lab", "training-orchestration"],
    fixture: {
      studentId: PLAYGROUND_STUDENT_ID,
      attemptRecords: [
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: true, computationalLoad: 0.1, conceptualLoad: 0.6 })),
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: false, computationalLoad: 0.9, conceptualLoad: 0.6 })),
        ...Array.from({ length: 5 }, () => makeAttemptRecord({ isCorrect: true, computationalLoad: 0.2, conceptualLoad: 0.1, timeTakenSeconds: 135, expectedTimeSeconds: 90 })),
        makeAttemptRecord({ isCorrect: false, computationalLoad: 0.2, conceptualLoad: 0.6, trapErrorTaxonomyCode: "base_confusion" }),
        makeAttemptRecord({ isCorrect: false, computationalLoad: 0.2, conceptualLoad: 0.6, trapErrorTaxonomyCode: "base_confusion" })
      ],
      candidates: [
        makeCandidate({
          conceptName: "Percentages",
          patternTaxonomyCellId: "cell-reverse-standard",
          trapErrorTaxonomyCode: "base_confusion",
          difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 }
        }),
        makeCandidate({
          conceptName: "Percentages",
          difficultyDimensions: { conceptualLoad: 0.7, computationalLoad: 0.7, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 }
        }),
        makeCandidate({
          conceptName: "Percentages",
          difficultyDimensions: { conceptualLoad: 0.2, computationalLoad: 0.2, trapDensity: 0.15, representationNovelty: 0.05, timePressure: 0.1, multiStepDepth: 0.1 }
        })
      ],
      activeRepairPlans: [{ plan: makeConfirmedRepairPlan() }],
      errorTaxonomy: [{ code: "base_confusion", label: "Base confusion", description: "Confuses the base of a percentage change.", category: "trap" }]
    },
    expectedOutcomes: [
      { systemId: "calculation-gym", status: "selected" },
      { systemId: "speed-lab", status: "selected" },
      { systemId: "trap-lab", status: "selected" },
      { systemId: "training-orchestration", status: "selected", note: "targeted_repair (unmodified precedence policy)" }
    ]
  }
];

export function getTrainingPlaygroundScenario(id: string): TrainingPlaygroundScenario | undefined {
  return TRAINING_PLAYGROUND_SCENARIOS.find((s) => s.id === id);
}
