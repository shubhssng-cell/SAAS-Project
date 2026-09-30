import { describe, expect, it } from "vitest";
import { TrainingRecommendationService } from "../src/service.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World } from "./fixtures.js";

/**
 * Phase 3.2 -- accumulated evidence end to end through the REAL TrainingRecommendationService, over persisted-style attempt
 * history (real attempt-lifecycle records in the in-memory repository). Every service call below is a brand-new service reading
 * only the repositories, so nothing can depend on process-local state. The pool uses realistic DNA (a distinct trap code and
 * testing mode per question) so the existing training-system providers are not accidentally triggered by identical metadata.
 */

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };

function poolWorld(): World {
  const w = new World();
  w.addQuestion({ id: "q-std", dna: { difficultyTier: "standard", patternFamilyName: "Point", patternTaxonomyCellId: "cell-point", trapErrorTaxonomyCode: "percentage_point_confusion", testingModes: ["contextualized"] } });
  w.addQuestion({ id: "q-advA", dna: { difficultyTier: "advanced", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-succ", trapErrorTaxonomyCode: "successive_change_error", testingModes: ["combined"] } });
  w.addQuestion({ id: "q-advB", dna: { difficultyTier: "advanced", patternFamilyName: "Reverse", patternTaxonomyCellId: "cell-rev", trapErrorTaxonomyCode: "base_confusion", testingModes: ["reverse", "combined"] } });
  return w;
}

type Outcome = "w" | "c" | "cs"; // wrong, correct on pace (40s of 90s), correct SLOW (200s of 90s)
async function play(world: World, steps: Array<[string, Outcome]>, o: { studentId?: string; enrollmentId?: string; idPrefix?: string } = {}) {
  let clock = 0;
  let n = 0;
  for (const [questionId, outcome] of steps) {
    n += 1;
    const seconds = outcome === "cs" ? 200 : 40;
    await world.finalizedAttempt({ id: `${o.idPrefix ?? "a"}${n}`, questionId, correct: outcome !== "w", start: clock, finalize: clock + seconds, studentId: o.studentId, enrollmentId: o.enrollmentId });
    clock += seconds + 100;
  }
}

async function recommend(world: World) {
  const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(request);
  if (result.status !== "selected") throw new Error(`expected a selection, got ${result.status}`);
  return result;
}
async function adaptive(world: World) {
  const result = await recommend(world);
  if (result.actionType !== "adaptive_practice") throw new Error(`expected adaptive_practice, got ${result.actionType}`);
  return result;
}

describe("accumulated evidence through the real recommendation service", () => {
  it("CASE A -- one incorrect answer: only the recent rule reacts; no accumulated weakness is created", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"]]);
    const r = await adaptive(world);
    expect(r.providerResult.primaryReason).toBe("recent_incorrect");
    expect(r.providerResult.allReasonsSatisfied).not.toEqual(expect.arrayContaining(["accuracy_weakness"]));
    expect(r.providerResult.allReasonsSatisfied).not.toContain("repeated_error");
    expect(r.providerResult.accumulatedEvidence).toMatchObject({ gradedAttempts: 1, incorrectCount: 1 });
  });

  it("CASE B -- three incorrect answers on related questions: the accumulated reason decides, from persisted history", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"]]);
    const r = await adaptive(world);
    expect(r.providerResult.primaryReason).toBe("repeated_error");
    expect(r.providerResult.accumulatedEvidence).toMatchObject({ conceptName: "Percentages", gradedAttempts: 3, incorrectCount: 3, trailingIncorrectStreak: 3 });
    expect(r.question.questionId).not.toBe("q-advA"); // the just-attempted question is not re-served
    expect(r.providerResult.explanation).toMatch(/most recent 3 graded answers/);
  });

  it("CASE B (stability) -- a later correct answer does not erase the accumulated pattern", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"], ["q-std", "c"]]);
    const r = await adaptive(world);
    expect(r.providerResult.primaryReason).toBe("accuracy_weakness");
    expect(r.providerResult.accumulatedEvidence).toMatchObject({ gradedAttempts: 4, incorrectCount: 3 });
  });

  it("CASE C -- repeated slow-but-correct answers: the existing accumulated-speed response (Speed Lab) takes over, ahead of adaptive practice", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "cs"], ["q-advB", "cs"], ["q-advA", "cs"]]);
    const r = await recommend(world);
    expect(r.actionType).toBe("training_system_practice");
    expect((r as unknown as { providerId: string }).providerId).toBe("speed-lab");
  });

  it("CASE D -- repeated success (3 on-pace correct answers on the standard tier): progression is supported and the recommendation moves off the basic question", async () => {
    const world = poolWorld();
    await play(world, [["q-std", "c"], ["q-std", "c"], ["q-std", "c"]]);
    const r = await adaptive(world);
    expect(r.providerResult.accumulatedEvidence?.highestDemonstratedTier).toEqual({ tier: "standard", attempts: 3, correct: 3 });
    expect(r.question.questionId).not.toBe("q-std");
    expect(["q-advA", "q-advB"]).toContain(r.question.questionId);
  });

  it("CASE E -- mixed results (incorrect, correct, incorrect, correct) are reported as the observed proportion, not a permanent classification", async () => {
    const world = poolWorld();
    await play(world, [["q-std", "w"], ["q-advA", "c"], ["q-advB", "w"], ["q-advA", "c"]]);
    const r = await adaptive(world);
    expect(r.providerResult.allReasonsSatisfied).not.toContain("repeated_error");
    expect(r.providerResult.primaryReason).toBe("accuracy_weakness");
    expect(r.providerResult.accumulatedEvidence).toMatchObject({ gradedAttempts: 4, incorrectCount: 2, trailingIncorrectStreak: 0 });

    // ...and it is not permanent: three more correct answers and the same concept no longer reports it.
    await play(world, [["q-std", "c"], ["q-advA", "c"], ["q-advB", "c"]], { idPrefix: "later" });
    const later = await adaptive(world);
    expect(later.providerResult.allReasonsSatisfied).not.toContain("accuracy_weakness");
  });

  it("PERMANENCE -- two early misses then a long run of correct answers do not keep the concept in repeated_error", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-std", "c"], ["q-advA", "c"], ["q-advB", "c"], ["q-std", "c"], ["q-advA", "c"], ["q-advB", "c"]]);
    const r = await adaptive(world);
    expect(r.providerResult.allReasonsSatisfied).not.toContain("repeated_error");
    expect(r.providerResult.accumulatedEvidence?.trailingIncorrectStreak).toBe(0);
  });

  it("recent + accumulated coexist: three incorrect answers -> the accumulated reason is primary and the recent signal is still reported", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"]]);
    const r = await adaptive(world);
    expect(r.providerResult.primaryReason).toBe("repeated_error");
    expect(r.providerResult.recentEvidence?.signal).toBe("incorrect");
  });

  it("persistence: a brand-new service over the same history reconstructs the same accumulated decision (no process-local counters)", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"]]);
    const first = await adaptive(world);
    const second = await adaptive(world); // recommend() constructs a fresh TrainingRecommendationService each time
    expect(second.question.questionId).toBe(first.question.questionId);
    expect(second.providerResult.primaryReason).toBe(first.providerResult.primaryReason);
    expect(second.providerResult.accumulatedEvidence).toEqual(first.providerResult.accumulatedEvidence);
  });

  it("isolation: another student's three incorrect answers never create evidence for this student", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"]], { studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT, idPrefix: "other" });
    const r = await adaptive(world);
    expect(r.providerResult.recentEvidence).toBeNull();
    expect(r.providerResult.accumulatedEvidence).toBeNull();
    expect(r.providerResult.primaryReason).not.toMatch(/repeated_error|accuracy_weakness|recent_/);
  });

  it("published-only still holds: an unpublished question that would be the best match is never recommended", async () => {
    const world = poolWorld();
    world.addQuestion({ id: "q-draft", validationState: "ai_validated", dna: { difficultyTier: "standard", patternFamilyName: "Draft", patternTaxonomyCellId: "cell-d", trapErrorTaxonomyCode: "misread_question" } });
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"]]);
    const r = await adaptive(world);
    expect(r.question.questionId).not.toBe("q-draft");
  });

  it("no answer key or solution reaches the recommendation result", async () => {
    const world = poolWorld();
    await play(world, [["q-advA", "w"], ["q-advB", "w"], ["q-advA", "w"]]);
    const text = JSON.stringify(await adaptive(world));
    expect(text).not.toContain(ANSWER_KEY);
    expect(text).not.toMatch(/correctAnswer|solutionSteps|groundTruth/);
  });
});
