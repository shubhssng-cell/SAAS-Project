import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { evaluateNoveltyTraining } from "../src/applicability.js";
import type { NoveltyTrainingRequirement } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, makeExposureBatch, STUDENT } from "./fixtures.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function asRequirement(requirement: unknown): NoveltyTrainingRequirement {
  return requirement as NoveltyTrainingRequirement;
}

function context(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

/** >= 3 standard attempts for "Percentages" -- clears the concept-specific baseline gate on its own. */
function clearedBaselineRecords(overrides: Parameters<typeof makeAttemptRecord>[0] = {}) {
  return makeExposureBatch(3, { noveltyLevel: "standard", conceptName: "Percentages", ...overrides });
}

describe("evaluateNoveltyTraining", () => {
  it("insufficient_evidence: no concept clears the standard-exposure baseline", () => {
    const outcome = evaluateNoveltyTraining(context({ attemptRecords: makeExposureBatch(2, { noveltyLevel: "standard" }) }));
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("insufficient_evidence");
  });

  it("sufficient_novelty_exposure: baseline cleared, but every novelty dimension already has 3+ exposures", () => {
    const attemptRecords = [
      ...clearedBaselineRecords(),
      ...makeExposureBatch(3, { noveltyLevel: "novel_representation" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_combination" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_context" })
    ];
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(false);
    if (!outcome.applicable) expect(outcome.reason).toBe("sufficient_novelty_exposure");
  });

  it("applicable: 0 target-level exposures (limited prior exposure)", () => {
    const outcome = evaluateNoveltyTraining(context({ attemptRecords: clearedBaselineRecords() }));
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).targetConceptName).toBe("Percentages");
  });

  it("applicable: 1 target-level exposure (underexposed)", () => {
    const attemptRecords = [...clearedBaselineRecords(), ...makeExposureBatch(1, { noveltyLevel: "novel_representation" })];
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
  });

  it("applicable: 2 target-level exposures (still underexposed)", () => {
    const attemptRecords = [...clearedBaselineRecords(), ...makeExposureBatch(2, { noveltyLevel: "novel_representation" })];
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
  });

  it("3 exposures on a dimension removes it from consideration (not underexposed)", () => {
    const attemptRecords = [
      ...clearedBaselineRecords(),
      ...makeExposureBatch(3, { noveltyLevel: "novel_representation" }), // sufficient -- excluded from targeting
      ...makeExposureBatch(3, { noveltyLevel: "novel_context" }), // sufficient -- excluded from targeting
      ...makeExposureBatch(1, { noveltyLevel: "novel_combination" }) // underexposed -- the only remaining candidate
    ];
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).targetNoveltyLevel).toBe("novel_combination");
  });

  it("all three levels are compared, and the globally lowest exposure count wins", () => {
    const attemptRecords = [
      ...clearedBaselineRecords(),
      ...makeExposureBatch(2, { noveltyLevel: "novel_representation" }),
      ...makeExposureBatch(0, { noveltyLevel: "novel_combination" }), // no-op, illustrative
      ...makeExposureBatch(1, { noveltyLevel: "novel_context" })
    ];
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).targetNoveltyLevel).toBe("novel_combination");
  });

  it("equal counts across levels: deterministic lexicographic noveltyLevel tie-break", () => {
    const attemptRecords = clearedBaselineRecords(); // all three non-standard dimensions are at 0 -- a genuine tie
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).targetNoveltyLevel).toBe("novel_combination"); // lexicographically first among the three
  });

  it("multi-concept: the globally lowest count wins, then lexicographic concept name", () => {
    // Both concepts have novel_combination/novel_context sufficiently exposed (3), isolating
    // novel_representation as the only dimension that differs between them (2 vs 1).
    const attemptRecords = [
      ...clearedBaselineRecords({ conceptName: "Percentages" }),
      ...makeExposureBatch(2, { noveltyLevel: "novel_representation", conceptName: "Percentages" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_combination", conceptName: "Percentages" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_context", conceptName: "Percentages" }),
      ...clearedBaselineRecords({ conceptName: "Ratio" }),
      ...makeExposureBatch(1, { noveltyLevel: "novel_representation", conceptName: "Ratio" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_combination", conceptName: "Ratio" }),
      ...makeExposureBatch(3, { noveltyLevel: "novel_context", conceptName: "Ratio" })
    ];
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).targetConceptName).toBe("Ratio");
  });

  it("cross-concept baseline isolation: Percentages clearing its baseline does not satisfy Ratio's baseline", () => {
    const attemptRecords = clearedBaselineRecords({ conceptName: "Percentages" }); // 3 standard Percentages attempts only
    const outcome = evaluateNoveltyTraining(context({ attemptRecords }));
    expect(outcome.applicable).toBe(true);
    if (outcome.applicable) expect(asRequirement(outcome.requirement).targetConceptName).toBe("Percentages"); // never "Ratio" -- Ratio has zero history at all
  });

  it("applicable with ZERO candidates supplied -- applicability never depends on candidate availability", () => {
    const outcome = evaluateNoveltyTraining(context({ attemptRecords: clearedBaselineRecords(), candidates: [] }));
    expect(outcome.applicable).toBe(true);
  });

  it("candidate-pool invariance: identical attempt history produces an identical decision whether candidates is empty or rich", () => {
    const attemptRecords = clearedBaselineRecords();
    const withEmptyCandidates = evaluateNoveltyTraining(context({ attemptRecords, candidates: [] }));
    const withRichCandidates = evaluateNoveltyTraining(
      context({
        attemptRecords,
        candidates: [
          makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_representation" }),
          makeCandidate({ conceptName: "Percentages", noveltyLevel: "novel_context" }),
          makeCandidate({ conceptName: "Ratio", noveltyLevel: "novel_combination" })
        ]
      })
    );

    expect(withEmptyCandidates.applicable).toBe(withRichCandidates.applicable);
    if (withEmptyCandidates.applicable && withRichCandidates.applicable) {
      expect(asRequirement(withEmptyCandidates.requirement)).toEqual(asRequirement(withRichCandidates.requirement));
    }
  });

  it("source-level regression: evaluateNoveltyTraining's own CODE (not doc-comment prose explaining the invariant) never references context.candidates", () => {
    const source = readFileSync(join(packageRoot, "src", "applicability.ts"), "utf-8");
    // Strip block (/** ... */) and line (// ...) comments before scanning -- the invariant IS
    // documented in prose there by design; this test targets actual code usage only.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly.includes("context.candidates")).toBe(false);
    expect(codeOnly.includes(".candidates")).toBe(false);
  });
});
