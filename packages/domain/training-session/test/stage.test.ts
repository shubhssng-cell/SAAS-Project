import { CALCULATION_TRAINING_STAGES } from "@ipmat/calculation-gym";
import { describe, expect, it } from "vitest";
import { TRAINING_SYSTEM_CATALOG, findTrainingSystem } from "../src/catalog.js";
import { runTrainingSystem, stageKeyOfRun } from "../src/runSystem.js";
import { describeStage, describeStageChange, readStageKey } from "../src/stage.js";
import { makeCandidate, STUDENT } from "./fixtures.js";

const calculation = findTrainingSystem("calculation-gym")!;

describe("Calculation in the catalog (Phase 5 Unit 2)", () => {
  it("is a calculation-dimension system served by the existing calculation provider", () => {
    expect(calculation).toMatchObject({ systemId: "calculation-gym", dimension: "calculation", providerId: "calculation-gym", label: "Calculation" });
    expect(calculation.trains).toContain("Deliberate calculation practice");
  });

  it("restates EXACTLY the provider's own stage vocabulary, in order (parity guard -- this package cannot import the provider)", () => {
    expect(calculation.stages?.map((s) => s.key)).toEqual([...CALCULATION_TRAINING_STAGES]);
  });

  it("only Calculation is staged; no other system claims stages it does not have", () => {
    expect(TRAINING_SYSTEM_CATALOG.filter((d) => d.stages).map((d) => d.systemId)).toEqual(["calculation-gym"]);
  });

  it("stage copy is authored, threshold-free and says nothing about the student", () => {
    const text = JSON.stringify(calculation.stages).toLowerCase();
    for (const banned of ["0.", "%", "threshold", "accuracy", "score", "confidence", "ability", "weak", "struggle", "improv"]) expect(text, banned).not.toContain(banned);
  });
});

describe("stage reading and presentation", () => {
  it("reads a stage key generically from a requirement, and nothing else", () => {
    expect(readStageKey({ stage: "mixed" } as never)).toBe("mixed");
    for (const bad of [undefined, {}, { stage: 3 }, { stage: "" }]) expect(readStageKey(bad as never)).toBeNull();
  });

  it("describes a stage with its 1-based position; an unknown stage or an unstaged system is null", () => {
    expect(describeStage(calculation, "foundational")).toMatchObject({ key: "foundational", position: 1, total: 3, label: "Stage 1 · Foundations" });
    expect(describeStage(calculation, "time_pressured")?.position).toBe(3);
    expect(describeStage(calculation, "nope")).toBeNull();
    expect(describeStage(calculation, null)).toBeNull();
    expect(describeStage(findTrainingSystem("speed-lab")!, "mixed")).toBeNull();
  });

  it("a forward change and a step back both get authored, distinct, claim-free notes; no change is null", () => {
    const forward = describeStageChange(calculation, "foundational", "mixed")!;
    const back = describeStageChange(calculation, "time_pressured", "mixed")!;
    expect(forward.direction).toBe("forward");
    expect(back.direction).toBe("back");
    expect(forward.note).not.toBe(back.note);
    expect(`${forward.note} ${back.note}`.toLowerCase()).not.toMatch(/improv|better|worse|weak|score|ability|threshold/);
    expect(describeStageChange(calculation, "mixed", "mixed")).toBeNull();
    expect(describeStageChange(calculation, null, "mixed")).toBeNull();
    expect(describeStageChange(calculation, "mixed", "nope")).toBeNull();
  });
});

describe("stageKeyOfRun -- the stage the provider itself reports", () => {
  const dims = (load: number) => ({ conceptualLoad: 0.2, computationalLoad: load, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 });
  it("is unknown when the system is not applicable or has no engine", () => {
    expect(stageKeyOfRun(runTrainingSystem("calculation-gym", { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [] }))).toBeNull();
    expect(stageKeyOfRun(runTrainingSystem("revision", { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [] }))).toBeNull();
  });

  it("is read from the provider's requirement when it is applicable -- even when no question qualifies", () => {
    // friction evidence needs graded attempts: build them through the shared fixtures' shape
    const rec = (load: number, correct: boolean, i: number) => ({
      contribution: { attemptId: `a${i}`, studentId: STUDENT, conceptId: "Percentages", questionId: `h${i}`, status: "submitted" as const, isCorrect: correct, timeTakenSeconds: 60, expectedTimeSeconds: 90, hintsUsed: 0, skipped: false, finalizedAt: "2026-01-01T00:00:00.000Z" },
      question: makeCandidate({ questionId: `h${i}`, conceptName: "Percentages", difficultyDimensions: dims(load) }).question
    });
    const attemptRecords = [rec(0.2, true, 1), rec(0.2, true, 2), rec(0.2, true, 3), rec(0.8, false, 4), rec(0.8, false, 5), rec(0.8, false, 6)];
    const run = runTrainingSystem("calculation-gym", { studentId: STUDENT, masteryByConcept: [], attemptRecords, candidates: [makeCandidate({ conceptName: "Percentages", difficultyDimensions: dims(0.2) })] });
    expect(stageKeyOfRun(run)).toBe("mixed"); // low cleared, no heavy evidence at 0.75 -> stage 2, whether or not a question qualifies
  });
});
