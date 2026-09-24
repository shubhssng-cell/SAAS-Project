import { orchestrateNextTrainingAction } from "@ipmat/training-orchestration";
import { describe, expect, it } from "vitest";
import { composeTrainingOrchestrationInput } from "../src/compose.js";
import { TrainingRecommendationService } from "../src/service.js";
import { TrainingRecommendationError } from "../src/types.js";
import { ANSWER_KEY, ENROLLMENT, OTHER_ENROLLMENT, STUDENT, storedRepairPlan, t, World } from "./fixtures.js";

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };

describe("TrainingRecommendationService.recommendNextTrainingAction — end to end over persisted state", () => {
  it("no published questions -> orchestration's own no_action: no_candidates_supplied", async () => {
    const world = new World();
    const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(request);

    expect(result.status).toBe("no_action");
    if (result.status === "no_action") expect(result.reason).toBe("no_candidates_supplied");
  });

  it("a confirmed RepairPlan with a matching published question -> targeted_repair", async () => {
    const world = new World();
    world.addQuestion({ id: "q-repair" });
    world.repairPlans = [storedRepairPlan()];

    const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(request);

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.actionType).toBe("targeted_repair");
      expect(result.question.questionId).toBe("q-repair");
    }
    expect(result.diagnostics.repairPlansSupplied).toBe(1);
  });

  it("only an unconfirmed/pre-D-039 RepairPlan -> nothing reaches repair selection; a non-repair action is chosen", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    world.repairPlans = [storedRepairPlan({ confirmedAt: null }), storedRepairPlan({ id: "rp-old", priority: null })];

    const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(request);

    expect(result.diagnostics.repairPlansSupplied).toBe(0);
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(result.status === "selected" && result.actionType === "targeted_repair").toBe(false);
  });

  it("returns orchestrateNextTrainingAction()'s result VERBATIM for the composed input (golden path, no wrapper)", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    world.addQuestion({ id: "q-2", dna: { testingModes: ["time_pressured"], patternFamilyName: "Successive Change" } });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", correct: false, start: 0, finalize: 300 });
    await world.finalizedAttempt({ id: "a-2", questionId: "q-2", correct: true, start: 400, finalize: 430 });
    await world.sessions.create({ id: "session-1", enrollmentId: ENROLLMENT, now: t(1_000) });
    await world.blocks.create({ id: "block-1", practiceSessionId: "session-1", now: t(1_000), blockTimeBudgetSeconds: 300 });
    await world.finalizedAttempt({ id: "b-1", questionId: "q-1", start: 1_010, finalize: 1_100, practiceBlockId: "block-1" });
    await world.finalizedAttempt({ id: "b-2", questionId: "q-2", correct: false, start: 1_105, finalize: 1_300, practiceBlockId: "block-1" });
    world.repairPlans = [storedRepairPlan({ targetTaxonomyCellId: "cell-that-has-no-questions" })];

    const deps = world.deps();
    const expected = orchestrateNextTrainingAction(await composeTrainingOrchestrationInput(deps, request));
    const actual = await new TrainingRecommendationService(deps).recommendNextTrainingAction(request);

    expect(actual).toEqual(expected);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  });

  it("the answer key never appears in the returned result", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", correct: true, start: 0, finalize: 60 });
    world.repairPlans = [storedRepairPlan()];

    const result = await new TrainingRecommendationService(world.deps()).recommendNextTrainingAction(request);
    expect(JSON.stringify(result)).not.toContain(ANSWER_KEY);
  });

  it("an enrollment/student mismatch rejects with a typed error and never reaches orchestration", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await expect(new TrainingRecommendationService(world.deps()).recommendNextTrainingAction({ studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT })).rejects.toBeInstanceOf(
      TrainingRecommendationError
    );
  });

  it("is a snapshot read: two identical calls over unchanged state return equal results", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", start: 0, finalize: 60 });
    const service = new TrainingRecommendationService(world.deps());

    expect(await service.recommendNextTrainingAction(request)).toEqual(await service.recommendNextTrainingAction(request));
  });
});
