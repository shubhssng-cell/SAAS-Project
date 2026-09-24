import { describe, expect, it, vi } from "vitest";

vi.mock("@ipmat/training-orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ipmat/training-orchestration")>();
  return { ...actual, orchestrateNextTrainingAction: vi.fn(actual.orchestrateNextTrainingAction) };
});

const { orchestrateNextTrainingAction } = await import("@ipmat/training-orchestration");
const { composeTrainingOrchestrationInput } = await import("../src/compose.js");
const { TrainingRecommendationService } = await import("../src/service.js");
const { ENROLLMENT, OTHER_ENROLLMENT, STUDENT, World } = await import("./fixtures.js");

describe("TrainingRecommendationService — orchestration invocation", () => {
  it("calls orchestrateNextTrainingAction() exactly once, with exactly the composed input, and returns its return value as-is", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    const deps = world.deps();
    const composed = await composeTrainingOrchestrationInput(deps, { studentId: STUDENT, enrollmentId: ENROLLMENT });
    const orchestrate = vi.mocked(orchestrateNextTrainingAction);
    orchestrate.mockClear();

    const result = await new TrainingRecommendationService(deps).recommendNextTrainingAction({ studentId: STUDENT, enrollmentId: ENROLLMENT });

    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0]?.[0]).toEqual(composed);
    expect(result).toBe(orchestrate.mock.results[0]?.value);
  });

  it("never invokes orchestration when ownership verification fails", async () => {
    const world = new World();
    const orchestrate = vi.mocked(orchestrateNextTrainingAction);
    orchestrate.mockClear();

    await expect(new TrainingRecommendationService(world.deps()).recommendNextTrainingAction({ studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT })).rejects.toThrow();
    expect(orchestrate).not.toHaveBeenCalled();
  });
});
