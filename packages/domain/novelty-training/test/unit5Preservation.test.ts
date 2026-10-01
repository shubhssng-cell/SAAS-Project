import { MASTERY_CONSTANTS } from "@ipmat/mastery";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingCandidateQuestion, TrainingSystemContext } from "@ipmat/training-systems";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateNoveltyTraining } from "../src/applicability.js";
import { NoveltyTrainingProvider } from "../src/provider.js";
import type { NoveltyTrainingRequirement } from "../src/types.js";
import { makeCandidate, makeExposureBatch, STUDENT } from "./fixtures.js";

/**
 * Phase 5 Unit 5 (student-facing Novelty Training) leaves the provider UNCHANGED. These tests pin the semantics the student-facing layer relies on
 * so a later change cannot quietly alter them: the canonical evidence gates, the target-pair rotation, candidate-invariance of `evaluate()`, the
 * evaluate/select separation, and the absence of any stage / score / psychological vocabulary or any substitute for the categorical `noveltyLevel`.
 */
const MIN = MASTERY_CONSTANTS.MIN_OBSERVATIONS_FOR_COMPONENT;
function ctx(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}
const standard = (n: number, conceptName = "Percentages") => makeExposureBatch(n, { noveltyLevel: "standard", conceptName });
const level = (n: number, noveltyLevel: "novel_representation" | "novel_combination" | "novel_context", conceptName = "Percentages") => makeExposureBatch(n, { noveltyLevel, conceptName });
const requirementOf = (d: ReturnType<typeof evaluateNoveltyTraining>) => (d.applicable ? (d.requirement as NoveltyTrainingRequirement) : null);

describe("Novelty Training -- semantics preserved for the student-facing layer", () => {
  it("gate 1 is exactly MIN_OBSERVATIONS_FOR_COMPONENT DISTINCT standard questions of the concept (one fewer is not enough; a retried question is one)", () => {
    expect(evaluateNoveltyTraining(ctx({ attemptRecords: standard(MIN - 1) })).applicable).toBe(false);
    expect(evaluateNoveltyTraining(ctx({ attemptRecords: standard(MIN) })).applicable).toBe(true);
    const retried = Array.from({ length: MIN + 2 }, () => makeExposureBatch(1, { noveltyLevel: "standard", questionId: "same-question" })[0]!);
    expect(evaluateNoveltyTraining(ctx({ attemptRecords: retried })).applicable).toBe(false);
  });

  it("gate 2 is exactly MIN distinct questions per style: a style at MIN-1 is underexposed, at MIN it is sufficient", () => {
    const allButOne = [...standard(MIN), ...level(MIN, "novel_representation"), ...level(MIN, "novel_context"), ...level(MIN - 1, "novel_combination")];
    expect(requirementOf(evaluateNoveltyTraining(ctx({ attemptRecords: allButOne })))?.targetNoveltyLevel).toBe("novel_combination");
    const all = [...allButOne, ...level(1, "novel_combination")];
    const decision = evaluateNoveltyTraining(ctx({ attemptRecords: all }));
    expect(decision).toMatchObject({ applicable: false, reason: "sufficient_novelty_exposure" });
  });

  it("the target ROTATES: recording an exposure at the lowest pair moves the target to the next-lowest (peer styles, no ladder)", () => {
    let history = standard(MIN);
    const order: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const target = requirementOf(evaluateNoveltyTraining(ctx({ attemptRecords: history })))!.targetNoveltyLevel;
      order.push(target);
      history = [...history, ...level(1, target)];
    }
    expect(order).toEqual(["novel_combination", "novel_context", "novel_representation", "novel_combination", "novel_context", "novel_representation"]);
  });

  it("exposure is correctness-independent: wrong and right answers on a style give the same decision", () => {
    const right = [...standard(MIN), ...makeExposureBatch(2, { noveltyLevel: "novel_context", isCorrect: true })];
    const wrong = [...standard(MIN), ...makeExposureBatch(2, { noveltyLevel: "novel_context", isCorrect: false })];
    expect(JSON.stringify(requirementOf(evaluateNoveltyTraining(ctx({ attemptRecords: right }))))).toBe(JSON.stringify(requirementOf(evaluateNoveltyTraining(ctx({ attemptRecords: wrong })))));
  });

  it("evaluate() is candidate-invariant: 25 radically different candidate pools give a byte-identical decision", () => {
    const history = [...standard(MIN), ...level(1, "novel_context")];
    const baseline = JSON.stringify(evaluateNoveltyTraining(ctx({ attemptRecords: history })));
    for (let i = 0; i < 25; i += 1) {
      const pool: TrainingCandidateQuestion[] = Array.from({ length: i }, (_, k) => makeCandidate({ conceptName: k % 2 ? "Percentages" : "Ratio", noveltyLevel: (["standard", "novel_context", "novel_combination", "novel_representation"] as const)[k % 4] }, { validationState: k % 3 ? "published" : "draft" }));
      expect(JSON.stringify(evaluateNoveltyTraining(ctx({ attemptRecords: history, candidates: pool })))).toBe(baseline);
    }
  });

  it("applicable + zero candidates is two distinct, separately-reported results (never one collapsed into the other)", () => {
    const history = standard(MIN);
    expect(evaluateNoveltyTraining(ctx({ attemptRecords: history })).applicable).toBe(true);
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), ctx({ attemptRecords: history }));
    expect(outcome.status).toBe("no_eligible_question");
    expect(runTrainingSystemProvider(new NoveltyTrainingProvider(), ctx()).status).toBe("not_applicable");
  });

  it("select() is never reached when not applicable, can never return not_applicable, and a requirement not produced by evaluate() is an `error`", () => {
    let selectCalls = 0;
    class Spy extends NoveltyTrainingProvider {
      override select(...args: Parameters<NoveltyTrainingProvider["select"]>) {
        selectCalls += 1;
        return super.select(...args);
      }
    }
    expect(runTrainingSystemProvider(new Spy(), ctx()).status).toBe("not_applicable");
    expect(selectCalls).toBe(0);
    const applicable = runTrainingSystemProvider(new Spy(), ctx({ attemptRecords: standard(MIN), candidates: [makeCandidate({ noveltyLevel: "novel_combination" })] }));
    expect(selectCalls).toBe(1);
    expect(["selected", "no_eligible_question", "error"]).toContain(applicable.status);
    expect(new NoveltyTrainingProvider().select(ctx(), { requirement: { notes: [] } as never, explanation: "x" })).toMatchObject({ status: "error", code: "invalid_context" });
  });

  it("matching is exact on the categorical noveltyLevel: testingModes with a coincidentally similar name never qualifies a candidate", () => {
    const history = [...standard(MIN), ...level(MIN, "novel_representation"), ...level(MIN, "novel_context")];
    const decoy = makeCandidate({ conceptName: "Percentages", noveltyLevel: "standard", testingModes: ["direct"] });
    const outcome = runTrainingSystemProvider(new NoveltyTrainingProvider(), ctx({ attemptRecords: history, candidates: [decoy] }));
    expect(outcome.status).toBe("no_eligible_question");
  });

  it("has no stage / progression / score / confidence vocabulary, no substitute for noveltyLevel, and no randomness or clock in its source", () => {
    const src = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");
    for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
      const code = readFileSync(join(src, file), "utf-8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
      expect(code, `${file} stage`).not.toMatch(/\bstage\b|steady_pace|foundational|noveltyScore|exposureScore|priorityScore|confidence|\bability\b/);
      expect(code, `${file} substitutes`).not.toMatch(/representationNovelty|computationalLoad|conceptualLoad|testingModes/);
      expect(code, `${file} random`).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    }
  });
});
