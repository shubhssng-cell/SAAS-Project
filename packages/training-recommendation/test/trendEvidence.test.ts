import { describe, expect, it } from "vitest";
import { TrainingRecommendationService } from "../src/service.js";
import { ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World } from "./fixtures.js";

/**
 * Phase 3.3 -- TREND evidence end to end through the REAL TrainingRecommendationService over persisted-style attempt history.
 * Every call builds a brand-new service that reads only the repositories, so the decision cannot depend on process-local state.
 * Trend evidence describes changes in observed performance; it does not diagnose the student.
 */

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };

function poolWorld(): World {
  const w = new World();
  w.addQuestion({ id: "q-std", dna: { difficultyTier: "standard", patternFamilyName: "Point", patternTaxonomyCellId: "cell-point", trapErrorTaxonomyCode: "percentage_point_confusion", testingModes: ["contextualized"] } });
  w.addQuestion({ id: "q-advA", dna: { difficultyTier: "advanced", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-succ", trapErrorTaxonomyCode: "successive_change_error", testingModes: ["combined"] } });
  w.addQuestion({ id: "q-advB", dna: { difficultyTier: "advanced", patternFamilyName: "Reverse", patternTaxonomyCellId: "cell-rev", trapErrorTaxonomyCode: "base_confusion", testingModes: ["reverse", "combined"] } });
  return w;
}

type Outcome = "w" | "c";
async function play(world: World, steps: Array<[string, Outcome]>, o: { studentId?: string; enrollmentId?: string } = {}) {
  let clock = 0;
  let n = 0;
  for (const [questionId, outcome] of steps) {
    n += 1;
    await world.finalizedAttempt({ id: `${o.studentId ?? "me"}-${n}`, questionId, correct: outcome === "c", start: clock, finalize: clock + 40, studentId: o.studentId, enrollmentId: o.enrollmentId });
    clock += 140;
  }
}

async function adaptive(world: World, req = request) {
  const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(req);
  if (result.status !== "selected" || result.actionType !== "adaptive_practice") throw new Error(`expected adaptive_practice, got ${result.status}`);
  return result;
}

describe("trend evidence through the real recommendation service", () => {
  it("improvement: wrong x3 then correct x3 -> recent_improvement (not accuracy_weakness), one step up, old facts preserved", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"], ["q-std", "c"], ["q-std", "c"], ["q-std", "c"]]);
    const r = await adaptive(world);
    expect(r.providerResult.primaryReason).toBe("recent_improvement");
    expect(r.providerResult.allReasonsSatisfied).not.toContain("accuracy_weakness");
    expect(r.providerResult.trendEvidence).toMatchObject({ kind: "improving", earlierGraded: 3, earlierCorrect: 0, recentCorrect: 3 });
    expect(r.providerResult.accumulatedEvidence).toMatchObject({ gradedAttempts: 6, incorrectCount: 3 });
    expect(["q-advA", "q-advB"]).toContain(r.question.questionId);
    // reconstructed identically by another brand-new service over the same history
    expect(await adaptive(world)).toEqual(r);
  });

  it("deterioration after strong history: correct x4, wrong, correct, wrong -> recent_deterioration at a difficulty that is not harder", async () => {
    const world = poolWorld();
    await play(world, [["q-std", "c"], ["q-std", "c"], ["q-std", "c"], ["q-std", "c"], ["q-advA", "w"], ["q-advB", "c"], ["q-advA", "w"]]);
    const r = await adaptive(world);
    expect(r.providerResult.trendEvidence).toMatchObject({ kind: "deteriorating", lastGradedTier: "advanced" });
    expect(r.providerResult.primaryReason).toBe("recent_deterioration");
    expect(r.question.questionId).toBe("q-advB"); // same tier as the last graded one first; never the just-attempted q-advA
  });

  it("persistent difficulty is not cleared by one success: w w c w w keeps the accumulated response", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-std", "c"], ["q-advA", "w"], ["q-advB", "w"]]);
    const r = await adaptive(world);
    expect(r.providerResult.trendEvidence?.kind).toBe("persistent_difficulty");
    expect(r.providerResult.primaryReason).toBe("repeated_error");
  });

  it("another student's improvement never changes this student's recommendation", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"]]);
    const before = await adaptive(world);
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"], ["q-std", "c"], ["q-std", "c"], ["q-std", "c"]], { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    expect(await adaptive(world)).toEqual(before);
    expect(before.providerResult.trendEvidence).toMatchObject({ gradedAttempts: 1, kind: null });
  });
});
