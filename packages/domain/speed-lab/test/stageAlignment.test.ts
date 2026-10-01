import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { AutopsyQuestionContext, TrainingCandidateQuestion, TrainingSystemContext } from "@ipmat/training-systems";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPEED_LAB_CONSTANTS } from "../src/constants.js";
import { SpeedLabProvider } from "../src/provider.js";
import { computeSpeedEvidence } from "../src/speedEvidence.js";
import type { SpeedLabRequirement, SpeedLabStage } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, makeFastCorrectBatch, makeSlowCorrectBatch, STUDENT } from "./fixtures.js";

/**
 * Phase 5 Unit 3 (docs/DECISIONS.md D-077): what a Speed Lab stage SERVES must be exactly what counts as that stage's PROGRESSION evidence
 * (`progression.ts`): steady-shaped = conceptualLoad < LOW and NOT time-pressured; mixed-shaped = conceptualLoad >= LOW and NOT time-pressured;
 * time_constrained = carries the `time_pressured` testing mode. Otherwise a served question could never count toward the gate it feeds.
 */
const LOW = SPEED_LAB_CONSTANTS.LOW_CONCEPTUAL_LOAD_THRESHOLD;
type Modes = AutopsyQuestionContext["testingModes"];

function dims(conceptualLoad: number): AutopsyQuestionContext["difficultyDimensions"] {
  return { conceptualLoad, computationalLoad: 0.2, trapDensity: 0.1, representationNovelty: 0, timePressure: 0, multiStepDepth: 0 };
}
function cand(id: string, conceptualLoad: number, modes: Modes = ["direct"], expectedTimeSeconds = 90): TrainingCandidateQuestion {
  return makeCandidate({ questionId: id, conceptName: "Percentages", difficultyDimensions: dims(conceptualLoad), testingModes: modes }, { expectedTimeSeconds });
}
function ctx(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}
function shapeMatches(stage: SpeedLabStage, q: AutopsyQuestionContext): boolean {
  const load = q.difficultyDimensions.conceptualLoad;
  const timed = q.testingModes.includes("time_pressured");
  if (stage === "steady_pace") return load < LOW && !timed;
  if (stage === "mixed_pace") return load >= LOW && !timed;
  return timed;
}

// Histories that drive each stage through the REAL applicability (>= 3 eligible, >= half correct-and-slow) and progression (count-based gates).
const TRIGGER = () => makeSlowCorrectBatch(4, { conceptualLoad: 0.2 }); // eligible, correct-and-slow => applicable, slowFraction 1
function history(stage: SpeedLabStage) {
  if (stage === "steady_pace") return TRIGGER();
  const steadyGood = makeFastCorrectBatch(3, { conceptualLoad: 0.2 }); // clears the steady gate; eligible population 7, slow 4 -> still applicable
  if (stage === "mixed_pace") return [...TRIGGER(), ...steadyGood];
  return [...TRIGGER(), ...steadyGood, ...makeFastCorrectBatch(3, { conceptualLoad: 0.8 })]; // broader slice cleared too (high-load attempts are not eligible, so applicability is unchanged)
}

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
  return Array.from({ length: size }, (_, i) => cand(`p${seed}-${i}`, Math.round(next() * 100) / 100, next() < 0.35 ? ["time_pressured"] : ["direct"], 30 + Math.floor(next() * 120)));
}

describe("Speed Lab -- a stage serves exactly its own evidence shape", () => {
  it("steady_pace never serves a time-pressured or conceptually heavier question, even when it is the least-exposed one", () => {
    const requirement = { targetConceptName: "Percentages", stage: "steady_pace", maxConceptualLoad: LOW, minConceptualLoad: null, requireTimePressured: false, excludeTimePressured: true } as SpeedLabRequirement;
    const timedLight = cand("timed", 0.1, ["time_pressured"]);
    const heavy = cand("heavy", 0.8);
    const lightSeen = cand("light", 0.2);
    const outcome = new SpeedLabProvider().select(ctx({ candidates: [timedLight, heavy, lightSeen], attemptRecords: [makeAttemptRecord({ questionId: "light", conceptualLoad: 0.2 })] }), { requirement, explanation: "t" });
    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") expect(outcome.question.questionId).toBe("light");
  });

  it("mixed_pace serves only conceptually heavier, non-timed questions -- never a light one (which cannot feed the mixed gate) nor a timed one", () => {
    const mixed = { targetConceptName: "Percentages", stage: "mixed_pace", maxConceptualLoad: null, minConceptualLoad: LOW, requireTimePressured: false, excludeTimePressured: true } as SpeedLabRequirement;
    const provider = new SpeedLabProvider();
    expect(provider.select(ctx({ candidates: [cand("light", 0.2), cand("timed", 0.8, ["time_pressured"])] }), { requirement: mixed, explanation: "t" }).status).toBe("no_eligible_question");
    const outcome = provider.select(ctx({ candidates: [cand("light", 0.2), cand("timed", 0.8, ["time_pressured"]), cand("heavy", 0.7)] }), { requirement: mixed, explanation: "t" });
    expect(outcome.status === "selected" && outcome.question.questionId).toBe("heavy");
  });

  it("time_constrained serves only questions that carry the time_pressured testing mode (at any conceptual load)", () => {
    const tc = { targetConceptName: "Percentages", stage: "time_constrained", maxConceptualLoad: null, requireTimePressured: true } as SpeedLabRequirement;
    const provider = new SpeedLabProvider();
    expect(provider.select(ctx({ candidates: [cand("a", 0.2), cand("b", 0.8)] }), { requirement: tc, explanation: "t" }).status).toBe("no_eligible_question");
    for (const load of [0.1, 0.9]) {
      const o = provider.select(ctx({ candidates: [cand("a", 0.2), cand("t", load, ["time_pressured"])] }), { requirement: tc, explanation: "t" });
      expect(o.status === "selected" && o.question.questionId).toBe("t");
    }
  });

  it("a requirement without the new optional fields behaves exactly as before (backward compatible)", () => {
    const legacy: SpeedLabRequirement = { targetConceptName: "Percentages", stage: "mixed_pace", maxConceptualLoad: null, requireTimePressured: false };
    const o = new SpeedLabProvider().select(ctx({ candidates: [cand("light", 0.2), cand("timed", 0.2, ["time_pressured"])] }), { requirement: legacy, explanation: "t" });
    expect(o.status).toBe("selected");
  });

  it.each(["steady_pace", "mixed_pace", "time_constrained"] as const)("end to end, stage %s: applicable, the real progression names the stage, the served question has that stage's shape", (stage) => {
    const pool = [cand("s1", 0.2), cand("s2", 0.3), cand("m1", 0.7), cand("m2", 0.9), cand("t1", 0.2, ["time_pressured"]), cand("t2", 0.8, ["time_pressured"])];
    const outcome = runTrainingSystemProvider(new SpeedLabProvider(), ctx({ attemptRecords: history(stage), candidates: pool }));
    expect(outcome.status).toBe("selected");
    if (outcome.status !== "selected") return;
    expect((outcome.requirement as SpeedLabRequirement).stage).toBe(stage);
    expect(shapeMatches(stage, outcome.question)).toBe(true);
  });

  it("serving/progression alignment: answering what a stage serves (correctly, at good pace) is counted by the gate it feeds", () => {
    const pool = [cand("s1", 0.2), cand("m1", 0.7)];
    // steady stage serves a light question; three good-pace correct answers on light questions move the real progression to mixed
    const served = runTrainingSystemProvider(new SpeedLabProvider(), ctx({ attemptRecords: history("steady_pace"), candidates: pool }));
    expect(served.status === "selected" && served.question.questionId).toBe("s1");
    const after = [...history("steady_pace"), ...makeFastCorrectBatch(3, { conceptualLoad: 0.2 })];
    const next = runTrainingSystemProvider(new SpeedLabProvider(), ctx({ attemptRecords: after, candidates: pool }));
    expect(next.status === "selected" && (next.requirement as SpeedLabRequirement).stage).toBe("mixed_pace");
    // ... and the mixed stage serves a heavier question, which is exactly what the next gate counts
    expect(next.status === "selected" && next.question.questionId).toBe("m1");
    const after2 = [...after, ...makeFastCorrectBatch(3, { conceptualLoad: 0.7 })];
    const third = runTrainingSystemProvider(new SpeedLabProvider(), ctx({ attemptRecords: after2, candidates: [...pool, cand("t1", 0.2, ["time_pressured"])] }));
    expect(third.status === "selected" && (third.requirement as SpeedLabRequirement).stage).toBe("time_constrained");
  });

  it("insufficient evidence never advances a stage: 2 good-pace attempts do not clear a gate, slow ones never count", () => {
    const pool = [cand("s1", 0.2), cand("m1", 0.7)];
    for (const extra of [makeFastCorrectBatch(2, { conceptualLoad: 0.2 }), makeSlowCorrectBatch(5, { conceptualLoad: 0.2 })]) {
      const o = runTrainingSystemProvider(new SpeedLabProvider(), ctx({ attemptRecords: [...TRIGGER(), ...extra], candidates: pool }));
      expect(o.status === "selected" && (o.requirement as SpeedLabRequirement).stage).toBe("steady_pace");
    }
  });

  it("property: over 300 seeded random pools the selection is in-shape, independent of candidate order, and repeatable", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const pool = randomPool(seed);
      for (const stage of ["steady_pace", "mixed_pace", "time_constrained"] as const) {
        const requirement: SpeedLabRequirement =
          stage === "steady_pace"
            ? { targetConceptName: "Percentages", stage, maxConceptualLoad: LOW, minConceptualLoad: null, requireTimePressured: false, excludeTimePressured: true }
            : stage === "mixed_pace"
              ? { targetConceptName: "Percentages", stage, maxConceptualLoad: null, minConceptualLoad: LOW, requireTimePressured: false, excludeTimePressured: true }
              : { targetConceptName: "Percentages", stage, maxConceptualLoad: null, requireTimePressured: true };
        const run = (candidates: TrainingCandidateQuestion[]) => new SpeedLabProvider().select(ctx({ candidates }), { requirement, explanation: "t" });
        const a = run(pool);
        expect(JSON.stringify(run([...pool].reverse()))).toBe(JSON.stringify(a));
        expect(JSON.stringify(run([...pool.slice(3), ...pool.slice(0, 3)]))).toBe(JSON.stringify(a));
        expect(JSON.stringify(run(pool))).toBe(JSON.stringify(a));
        if (a.status === "selected") expect(shapeMatches(stage, a.question), `seed ${seed} ${stage}`).toBe(true);
      }
    }
  });
});

describe("Speed Lab -- the existing design is preserved (Unit 3 does not change it)", () => {
  it("reuses the canonical slow boundary: an attempt AT AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO is slow, just below is not", () => {
    const expected = 100;
    const at = makeAttemptRecord({ conceptualLoad: 0.2, isCorrect: true, expectedTimeSeconds: expected, timeTakenSeconds: expected * AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO });
    const below = makeAttemptRecord({ conceptualLoad: 0.2, isCorrect: true, expectedTimeSeconds: expected, timeTakenSeconds: expected * AUTOPSY_THRESHOLDS.SLOW_SPEED_RATIO - 1 });
    expect(computeSpeedEvidence("Percentages", STUDENT, [at]).correctSlowCount).toBe(1);
    expect(computeSpeedEvidence("Percentages", STUDENT, [below]).correctSlowCount).toBe(0);
    expect(JSON.stringify(SPEED_LAB_CONSTANTS)).not.toMatch(/SLOW_SPEED_RATIO|FAST_SPEED_RATIO/); // no second slow/fast threshold is defined here
  });

  it("incorrect-and-slow is diagnostic only: it never makes Speed Lab applicable", () => {
    const records = [...makeFastCorrectBatch(1, { conceptualLoad: 0.2 }), ...makeSlowCorrectBatch(0), ...Array.from({ length: 5 }, () => makeAttemptRecord({ conceptualLoad: 0.2, isCorrect: false, timeTakenSeconds: 200, expectedTimeSeconds: 90 }))];
    const evidence = computeSpeedEvidence("Percentages", STUDENT, records);
    expect(evidence.incorrectSlowCount).toBe(5);
    expect(runTrainingSystemProvider(new SpeedLabProvider(), ctx({ attemptRecords: records, candidates: [cand("s1", 0.2)] })).status).toBe("not_applicable");
  });

  it("the denominator is correctness-independent and excludes heavy / hinted / timed attempts", () => {
    const records = [...makeSlowCorrectBatch(2, { conceptualLoad: 0.2 }), makeAttemptRecord({ conceptualLoad: 0.2, isCorrect: false, timeTakenSeconds: 60, expectedTimeSeconds: 90 }), makeAttemptRecord({ conceptualLoad: 0.9, isCorrect: true, timeTakenSeconds: 200, expectedTimeSeconds: 90 }), makeAttemptRecord({ conceptualLoad: 0.2, isCorrect: true, timeTakenSeconds: 200, expectedTimeSeconds: 90, hintsUsed: 1 }), makeAttemptRecord({ conceptualLoad: 0.2, isCorrect: true, timeTakenSeconds: 200, expectedTimeSeconds: 90, testingModes: ["time_pressured"] })];
    expect(computeSpeedEvidence("Percentages", STUDENT, records)).toMatchObject({ eligibleGradedCount: 3, correctSlowCount: 2, incorrectSlowCount: 0 });
  });

  it("never reads computationalLoad, never depends on Calculation Gym, never defines a score, a ranking or randomness", () => {
    const src = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");
    for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
      const code = readFileSync(join(src, file), "utf-8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
      expect(code, `${file} computationalLoad`).not.toMatch(/computationalLoad/);
      expect(code, `${file} calculation-gym`).not.toMatch(/calculation-gym/);
      expect(code, `${file} score`).not.toMatch(/priorityScore|speedAbilityScore|targetSpeedRatio|confidence/);
      expect(code, `${file} random`).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    }
    const pkg = JSON.parse(readFileSync(join(dirname(src), "package.json"), "utf-8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@ipmat/autopsy", "@ipmat/mastery", "@ipmat/training-systems"]);
  });
});
