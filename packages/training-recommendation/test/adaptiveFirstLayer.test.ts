import { describe, expect, it } from "vitest";
import { TrainingRecommendationService } from "../src/service.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, OTHER_STUDENT, STUDENT, World } from "./fixtures.js";

/**
 * Phase 3.1 -- the first adaptive layer, end to end through the REAL TrainingRecommendationService: persisted-style attempt
 * history (real attempt lifecycle records in the in-memory repository) -> composed orchestration input -> orchestration ->
 * adaptive selection. The next recommendation reacts to the student's most recent finalized attempt.
 */

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };

/** A small published pool: one standard question and two advanced ones, all Percentages (expected time 90s each). */
function poolWorld(): World {
  const world = new World();
  world.addQuestion({ id: "q-std", dna: { difficultyTier: "standard", patternFamilyName: "Point", patternTaxonomyCellId: "cell-point" } });
  world.addQuestion({ id: "q-advA", dna: { difficultyTier: "advanced", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-succ" } });
  world.addQuestion({ id: "q-advB", dna: { difficultyTier: "advanced", patternFamilyName: "Reverse", patternTaxonomyCellId: "cell-rev" } });
  return world;
}

async function recommend(world: World) {
  const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(request);
  if (result.status !== "selected" || result.actionType !== "adaptive_practice") throw new Error(`expected an adaptive selection, got ${result.status}`);
  return result;
}

describe("first adaptive layer through the real recommendation service", () => {
  it("no prior performance: a valid published question is recommended, with no recent evidence", async () => {
    const result = await recommend(poolWorld());
    expect(["q-std", "q-advA", "q-advB"]).toContain(result.question.questionId);
    expect(result.providerResult.recentEvidence).toBeNull();
    expect(result.providerResult.primaryReason).not.toMatch(/^recent_/);
  });

  it("INCORRECT answer on an advanced question -> a related question that is not harder (the easier one), not the missed question", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: false, start: 0, finalize: 60 });
    const result = await recommend(world);
    expect(result.providerResult.primaryReason).toBe("recent_incorrect");
    expect(result.question.questionId).toBe("q-std");
    expect(result.providerResult.recentEvidence?.signal).toBe("incorrect");
  });

  it("SKIP is its own evidence: reason recent_skip, not the incorrect-answer path", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", skip: true, start: 0, finalize: 20 });
    const result = await recommend(world);
    expect(result.providerResult.primaryReason).toBe("recent_skip");
    expect(result.providerResult.recentEvidence?.signal).toBe("skipped");
    expect(result.question.questionId).toBe("q-std");
  });

  it("SLOW correct answer (elapsed >= 1.3x expected, from the persisted attempt timestamps) -> stays at the same tier instead of stepping up", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: true, start: 0, finalize: 150 }); // 150s vs 90s expected
    const slow = await recommend(world);
    expect(slow.providerResult.recentEvidence?.signal).toBe("correct_slow");
    expect(slow.providerResult.primaryReason).toBe("recent_slow");
    expect(slow.question.questionId).toBe("q-advB"); // same tier + concept, not the standard one and not the same question

    const fast = poolWorld();
    await fast.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: true, start: 0, finalize: 40 }); // 40s vs 90s expected
    const onPace = await recommend(fast);
    expect(onPace.providerResult.recentEvidence?.signal).toBe("correct_on_pace");
    expect(onPace.providerResult.primaryReason).not.toBe("recent_slow");
  });

  it("CORRECT within the expected time is not treated as weak: no weakness/problem reason, and the answered question is not re-served", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-std", correct: true, start: 0, finalize: 30 });
    const result = await recommend(world);
    expect(["recent_incorrect", "recent_skip", "recent_slow", "accuracy_weakness", "repeated_error", "speed_weakness"]).not.toContain(result.providerResult.primaryReason);
    expect(result.question.questionId).not.toBe("q-std");
  });

  it("reacts to the MOST RECENT attempt: an earlier incorrect answer followed by a correct on-pace one is no longer a recent_incorrect situation", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: false, start: 0, finalize: 60 });
    await world.finalizedAttempt({ id: "a2", questionId: "q-std", correct: true, start: 100, finalize: 130 });
    const result = await recommend(world);
    expect(result.providerResult.recentEvidence?.question.questionId).toBe("q-std");
    expect(result.providerResult.primaryReason).not.toBe("recent_incorrect");
  });

  it("published-only filtering still holds: an unpublished question that would be the best recent match is never recommended", async () => {
    const world = poolWorld();
    world.addQuestion({ id: "q-draft", validationState: "ai_validated", dna: { difficultyTier: "standard", patternFamilyName: "Successive", patternTaxonomyCellId: "cell-d" } });
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: false, start: 0, finalize: 60 });
    const result = await recommend(world);
    expect(result.question.questionId).not.toBe("q-draft");
  });

  it("a fresh service instance over the same persisted history gives the same recommendation (no process-local state)", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: false, start: 0, finalize: 60 });
    const first = await recommend(world);
    const second = await recommend(world); // a brand-new TrainingRecommendationService each call, reading only the repositories
    expect(second.question.questionId).toBe(first.question.questionId);
    expect(second.providerResult.primaryReason).toBe(first.providerResult.primaryReason);
  });

  it("another student's attempts never influence this student's recommendation", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "x1", questionId: "q-advA", correct: false, start: 0, finalize: 60, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const result = await recommend(world);
    expect(result.providerResult.recentEvidence).toBeNull();
  });

  it("nothing about the answer key or solution reaches the recommendation result", async () => {
    const world = poolWorld();
    await world.finalizedAttempt({ id: "a1", questionId: "q-advA", correct: false, start: 0, finalize: 60 });
    const result = await recommend(world);
    expect(JSON.stringify(result)).not.toContain(ANSWER_KEY);
    expect(JSON.stringify(result)).not.toMatch(/correctAnswer|solutionSteps|groundTruth/);
  });
});
