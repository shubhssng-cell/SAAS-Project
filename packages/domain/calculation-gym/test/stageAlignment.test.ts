import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { AutopsyQuestionContext, TrainingCandidateQuestion, TrainingSystemContext } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { CALCULATION_GYM_CONSTANTS } from "../src/constants.js";
import { CalculationGymProvider } from "../src/provider.js";
import type { CalculationGymRequirement, CalculationTrainingStage } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, makeGradedBatch, STUDENT } from "./fixtures.js";

/**
 * Phase 5 Unit 2 (docs/DECISIONS.md D-076): what a stage SERVES must be exactly what counts as that stage's PROGRESSION evidence
 * (`progression.ts`): foundational-shaped = load < HIGH and not multi_step; mixed-shaped = load >= HIGH and not time_pressured;
 * time_pressured = load >= HIGH and time_pressured. Otherwise a served question could never count toward the stage it was served at.
 */
const HIGH = CALCULATION_GYM_CONSTANTS.HIGH_COMPUTATIONAL_LOAD_THRESHOLD;
type Modes = AutopsyQuestionContext["testingModes"];

function dims(load: number): AutopsyQuestionContext["difficultyDimensions"] {
  return { conceptualLoad: 0.2, computationalLoad: load, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 };
}
function cand(id: string, load: number, modes: Modes = ["direct"]): TrainingCandidateQuestion {
  return makeCandidate({ questionId: id, conceptName: "Percentages", difficultyDimensions: dims(load), testingModes: modes });
}
function ctx(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

function shapeMatches(stage: CalculationTrainingStage, q: AutopsyQuestionContext): boolean {
  const load = q.difficultyDimensions.computationalLoad;
  if (stage === "foundational") return load < HIGH && !q.testingModes.includes("multi_step");
  if (stage === "mixed") return load >= HIGH && !q.testingModes.includes("time_pressured");
  return load >= HIGH && q.testingModes.includes("time_pressured");
}

// Histories that drive each stage through the REAL applicability + progression (friction needs low - high >= 0.2, >= 3 per slice).
function history(stage: CalculationTrainingStage) {
  if (stage === "foundational") return [...makeGradedBatch(3, 2, { computationalLoad: 0.2 }), ...makeGradedBatch(3, 0, { computationalLoad: 0.8 })]; // low 0.67 < 0.75
  if (stage === "mixed") return [...makeGradedBatch(3, 3, { computationalLoad: 0.2 }), ...makeGradedBatch(3, 1, { computationalLoad: 0.8 })]; // low cleared, high 0.33
  return [...makeGradedBatch(3, 3, { computationalLoad: 0.2 }), ...makeGradedBatch(4, 3, { computationalLoad: 0.8 })]; // high 0.75 cleared, gap 0.25
}

/** A small deterministic generator (no Math.random): the same seed always yields the same pool. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function randomPool(seed: number): TrainingCandidateQuestion[] {
  const next = lcg(seed);
  const size = 3 + Math.floor(next() * 12);
  return Array.from({ length: size }, (_, i) => {
    const modes: Modes = next() < 0.3 ? ["time_pressured"] : next() < 0.3 ? ["multi_step"] : ["direct"];
    return cand(`p${seed}-${i}`, Math.round(next() * 100) / 100, modes);
  });
}

describe("Calculation Gym -- a stage serves exactly its own evidence shape", () => {
  it("foundational never serves a heavy or multi-step question, even when it is the least-exposed one", () => {
    const requirement = { targetConceptName: "Percentages", stage: "foundational", minComputationalLoad: 0, requireMultiStep: false, requireTimePressured: false, maxComputationalLoad: HIGH, excludeMultiStep: true } as CalculationGymRequirement;
    const heavyUnseen = cand("heavy", 0.9);
    const multiUnseen = cand("multi", 0.1, ["multi_step"]);
    const lightSeen = cand("light", 0.2);
    const seenLight = makeAttemptRecord({ questionId: "light", computationalLoad: 0.2 });
    const outcome = new CalculationGymProvider().select(ctx({ candidates: [heavyUnseen, multiUnseen, lightSeen], attemptRecords: [seenLight] }), { requirement, explanation: "t" });
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("light");
  });

  it("mixed never serves a time-pressured question; time_pressured serves only time-pressured heavy ones", () => {
    const mixed = { targetConceptName: "Percentages", stage: "mixed", minComputationalLoad: HIGH, requireMultiStep: false, requireTimePressured: false, excludeTimePressured: true } as CalculationGymRequirement;
    const pool = [cand("tp", 0.8, ["time_pressured"])];
    expect(new CalculationGymProvider().select(ctx({ candidates: pool }), { requirement: mixed, explanation: "t" }).status).toBe("no_eligible_question");
    const tp = { ...mixed, stage: "time_pressured", excludeTimePressured: false, requireTimePressured: true } as CalculationGymRequirement;
    expect(new CalculationGymProvider().select(ctx({ candidates: pool }), { requirement: tp, explanation: "t" }).status).toBe("selected");
  });

  it("a requirement without the new optional fields behaves exactly as before (backward compatible)", () => {
    const legacy: CalculationGymRequirement = { targetConceptName: "Percentages", stage: "foundational", minComputationalLoad: 0, requireMultiStep: false, requireTimePressured: false };
    const outcome = new CalculationGymProvider().select(ctx({ candidates: [cand("heavy", 0.9)] }), { requirement: legacy, explanation: "t" });
    expect(outcome.status).toBe("selected");
  });

  it.each(["foundational", "mixed", "time_pressured"] as const)("end to end, stage %s: applicable, the real progression names the stage, and the served question has that stage's evidence shape", (stage) => {
    const pool = [cand("low", 0.2), cand("low2", 0.3), cand("multi", 0.1, ["multi_step"]), cand("heavy", 0.8), cand("heavy2", 0.9), cand("tp", 0.8, ["time_pressured"]), cand("tp2", 0.95, ["time_pressured"])];
    const outcome = runTrainingSystemProvider(new CalculationGymProvider(), ctx({ attemptRecords: history(stage), candidates: pool }));
    expect(outcome.status).toBe("selected");
    if (outcome.status !== "selected") return;
    expect((outcome.requirement as CalculationGymRequirement).stage).toBe(stage);
    expect(shapeMatches(stage, outcome.question)).toBe(true);
  });

  it("stage progression is deterministic and monotone in the evidence: more cleared evidence never moves a stage backward", () => {
    const order: CalculationTrainingStage[] = ["foundational", "mixed", "time_pressured"];
    const pool = [cand("low", 0.2), cand("heavy", 0.8), cand("tp", 0.8, ["time_pressured"])];
    const stages = (["foundational", "mixed", "time_pressured"] as const).map((s) => {
      const o = runTrainingSystemProvider(new CalculationGymProvider(), ctx({ attemptRecords: history(s), candidates: pool }));
      return o.status === "selected" ? (o.requirement as CalculationGymRequirement).stage : null;
    });
    expect(stages).toEqual(order);
  });

  it("property: over 300 seeded random pools, the selection is in-shape, independent of candidate order, and repeatable", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const pool = randomPool(seed);
      for (const stage of ["foundational", "mixed", "time_pressured"] as const) {
        const base = { targetConceptName: "Percentages", minComputationalLoad: stage === "foundational" ? 0 : HIGH, requireMultiStep: false, requireTimePressured: stage === "time_pressured" } as const;
        const requirement: CalculationGymRequirement =
          stage === "foundational"
            ? { ...base, stage, maxComputationalLoad: HIGH, excludeMultiStep: true }
            : stage === "mixed"
              ? { ...base, stage, excludeTimePressured: true }
              : { ...base, stage };
        const run = (candidates: TrainingCandidateQuestion[]) => new CalculationGymProvider().select(ctx({ candidates }), { requirement, explanation: "t" });
        const a = run(pool);
        const reversed = run([...pool].reverse());
        const rotated = run([...pool.slice(3), ...pool.slice(0, 3)]);
        expect(JSON.stringify(reversed)).toBe(JSON.stringify(a));
        expect(JSON.stringify(rotated)).toBe(JSON.stringify(a));
        expect(JSON.stringify(run(pool))).toBe(JSON.stringify(a));
        if (a.status === "selected") expect(shapeMatches(stage, a.question), `seed ${seed} ${stage}`).toBe(true);
      }
    }
  });

  it("the provider uses no randomness and no clock", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");
    for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
      const code = readFileSync(join(src, file), "utf-8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
      expect(code, file).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    }
  });
});
