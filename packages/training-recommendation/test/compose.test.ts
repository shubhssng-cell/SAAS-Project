import type { AttemptState } from "@ipmat/attempt";
import { PersistenceError } from "@ipmat/db";
import { computeMasteryState } from "@ipmat/mastery";
import { deriveBlockActiveSolvingTimeSeconds, deriveBlockWallClockDurationSeconds, deriveInterAttemptGapsSeconds } from "@ipmat/practice-block";
import { describe, expect, it, vi } from "vitest";
import { composeTrainingOrchestrationInput } from "../src/compose.js";
import { TrainingRecommendationError, type TrainingRecommendationDependencies } from "../src/types.js";
import { ANSWER_KEY, dna, ENROLLMENT, EXAM, NOW, OTHER_ENROLLMENT, OTHER_EXAM, OTHER_STUDENT, PERCENTAGES, RATIO, STUDENT, storedRepairPlan, t, World } from "./fixtures.js";

const request = { studentId: STUDENT, enrollmentId: ENROLLMENT };

async function expectCode(promise: Promise<unknown>, code: TrainingRecommendationError["code"]): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(TrainingRecommendationError);
  expect((error as TrainingRecommendationError).code).toBe(code);
}

/** Wraps every reader method with a spy, so a test can assert which reads did (or did not) happen. */
function spyOnReads(deps: TrainingRecommendationDependencies) {
  return {
    enrollment: vi.spyOn(deps.enrollmentReader, "findById"),
    finalized: vi.spyOn(deps.attemptHistoryReader, "findFinalizedByStudentId"),
    blockAttempts: vi.spyOn(deps.attemptHistoryReader, "findByPracticeBlockId"),
    repairPlans: vi.spyOn(deps.repairPlanReader, "findConfirmedActiveByStudentId"),
    questions: vi.spyOn(deps.trainingQuestionReader, "findPublishedByExamId"),
    canonical: vi.spyOn(deps.questionReader, "findById"),
    concepts: vi.spyOn(deps.conceptReader, "findWithPublishedQuestionsByExamId"),
    session: vi.spyOn(deps.practiceSessionReader, "findActiveByEnrollmentId"),
    blocks: vi.spyOn(deps.practiceBlockReader, "findBySessionId")
  };
}

describe("composeTrainingOrchestrationInput — enrollment ownership (checked first)", () => {
  it("succeeds for the owning student and scopes every read to the verified enrollment/student/exam", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    const deps = world.deps();
    const spies = spyOnReads(deps);

    const input = await composeTrainingOrchestrationInput(deps, request);

    expect(input.studentId).toBe(STUDENT);
    expect(input.prepPhase).toBeNull();
    expect(input).not.toHaveProperty("errorTaxonomy");
    expect(spies.enrollment).toHaveBeenCalledWith(ENROLLMENT);
    expect(spies.finalized).toHaveBeenCalledWith(STUDENT);
    expect(spies.repairPlans).toHaveBeenCalledWith(STUDENT);
    expect(spies.questions).toHaveBeenCalledWith(EXAM);
    expect(spies.concepts).toHaveBeenCalledWith(EXAM);
    expect(spies.session).toHaveBeenCalledWith(ENROLLMENT);
  });

  it("missing enrollment fails closed before ANY other read", async () => {
    const world = new World();
    const deps = world.deps();
    const spies = spyOnReads(deps);

    await expectCode(composeTrainingOrchestrationInput(deps, { studentId: STUDENT, enrollmentId: "no-such-enrollment" }), "enrollment_not_found");
    for (const [name, spy] of Object.entries(spies)) {
      if (name !== "enrollment") expect(spy, name).not.toHaveBeenCalled();
    }
  });

  it("enrollment owned by another student fails closed before ANY other read", async () => {
    const world = new World();
    const deps = world.deps();
    const spies = spyOnReads(deps);

    await expectCode(composeTrainingOrchestrationInput(deps, { studentId: STUDENT, enrollmentId: OTHER_ENROLLMENT }), "enrollment_ownership_mismatch");
    for (const [name, spy] of Object.entries(spies)) {
      if (name !== "enrollment") expect(spy, name).not.toHaveBeenCalled();
    }
  });

  it("an EnrollmentReader returning a different enrollment than requested fails closed", async () => {
    const world = new World();
    const deps = world.deps({
      enrollmentReader: { findById: async () => ({ id: "some-other-enrollment", studentId: STUDENT, examId: EXAM }) }
    });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it.each([
    [{ studentId: "", enrollmentId: ENROLLMENT }],
    [{ studentId: STUDENT, enrollmentId: "   " }]
  ])("rejects a blank id without reading anything (%j)", async (badRequest) => {
    const world = new World();
    const deps = world.deps();
    const spies = spyOnReads(deps);
    await expectCode(composeTrainingOrchestrationInput(deps, badRequest), "invalid_request");
    expect(spies.enrollment).not.toHaveBeenCalled();
  });
});

describe("composeTrainingOrchestrationInput — empty states are valid", () => {
  it("no attempts, no plans, no session, no questions -> empty arrays, one (insufficient-data) mastery result per concept", async () => {
    const world = new World();
    const deps = world.deps();
    const spies = spyOnReads(deps);

    const input = await composeTrainingOrchestrationInput(deps, request);

    expect(input.attemptRecords).toEqual([]);
    expect(input.activeRepairPlans).toEqual([]);
    expect(input.candidates).toEqual([]);
    expect(input.practiceBlocks).toEqual([]);
    expect(input.masteryByConcept.map((m) => m.conceptId)).toEqual([PERCENTAGES.id, RATIO.id]);
    for (const mastery of input.masteryByConcept) {
      expect(Object.values(mastery.measures).every((measure) => measure === null)).toBe(true);
    }
    expect(spies.blocks).not.toHaveBeenCalled();
    expect(spies.blockAttempts).not.toHaveBeenCalled();
  });

  it("an active session with no blocks -> practiceBlocks []", async () => {
    const world = new World();
    await world.sessions.create({ id: "session-1", enrollmentId: ENROLLMENT, now: t(0) });
    const deps = world.deps();
    const spies = spyOnReads(deps);

    const input = await composeTrainingOrchestrationInput(deps, request);

    expect(spies.blocks).toHaveBeenCalledWith("session-1");
    expect(spies.blockAttempts).not.toHaveBeenCalled();
    expect(input.practiceBlocks).toEqual([]);
  });

  it("another enrollment's active session is never read as this one's", async () => {
    const world = new World();
    await world.sessions.create({ id: "session-other", enrollmentId: OTHER_ENROLLMENT, now: t(0) });
    const deps = world.deps();
    const spies = spyOnReads(deps);

    const input = await composeTrainingOrchestrationInput(deps, request);
    expect(spies.blocks).not.toHaveBeenCalled();
    expect(input.practiceBlocks).toEqual([]);
  });
});

describe("composeTrainingOrchestrationInput — questions and candidates", () => {
  it("only published records become candidates, rebuilt with exactly the three contract fields", async () => {
    const world = new World();
    world.addQuestion({ id: "q-published" });
    const draft = { question: dna("q-draft"), expectedTimeSeconds: 90, validationState: "draft" as const };
    const withExtraField = { question: dna("q-extra"), expectedTimeSeconds: 60, validationState: "published" as const, correctAnswer: ANSWER_KEY };
    const deps = world.deps({ trainingQuestionReader: { findPublishedByExamId: async () => [draft, withExtraField] } });

    const input = await composeTrainingOrchestrationInput(deps, request);

    expect(input.candidates.map((c) => c.question.questionId)).toEqual(["q-extra"]);
    expect(Object.keys(input.candidates[0] ?? {}).sort()).toEqual(["expectedTimeSeconds", "question", "validationState"]);
  });

  it("questions for another exam are never candidates", async () => {
    const world = new World();
    world.addQuestion({ id: "q-mine" });
    world.addQuestion({ id: "q-other-exam", exam: OTHER_EXAM });

    const input = await composeTrainingOrchestrationInput(world.deps(), request);
    expect(input.candidates.map((c) => c.question.questionId)).toEqual(["q-mine"]);
  });

  it("the answer key never appears anywhere in the composed input", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", correct: true, start: 0, finalize: 60 });
    world.repairPlans = [storedRepairPlan()];

    const input = await composeTrainingOrchestrationInput(world.deps(), request);

    expect(input.attemptRecords).toHaveLength(1);
    expect(JSON.stringify(input)).not.toContain(ANSWER_KEY);
  });
});

describe("composeTrainingOrchestrationInput — mastery composition", () => {
  it("builds attempt records in finalizedAt ASC order and computes mastery with the existing computeMasteryState()", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    world.addQuestion({ id: "q-2" });
    world.addQuestion({ id: "q-ratio", concept: RATIO, dna: { patternFamilyName: "Ratio Split" } });
    // Persisted deliberately out of finalizedAt order.
    await world.finalizedAttempt({ id: "a-late", questionId: "q-2", correct: false, start: 300, finalize: 400 });
    await world.finalizedAttempt({ id: "a-early", questionId: "q-1", correct: true, start: 0, finalize: 45 });
    await world.finalizedAttempt({ id: "a-skip", questionId: "q-ratio", skip: true, start: 100, finalize: 130 });
    await world.openAttempt({ id: "a-open", questionId: "q-1", start: 500 });

    const input = await composeTrainingOrchestrationInput(world.deps(), request);

    expect(input.attemptRecords.map((r) => r.contribution.attemptId)).toEqual(["a-early", "a-skip", "a-late"]);
    const early = input.attemptRecords[0];
    expect(early?.contribution).toMatchObject({ studentId: STUDENT, conceptId: PERCENTAGES.id, questionId: "q-1", status: "submitted", isCorrect: true, timeTakenSeconds: 45, expectedTimeSeconds: 90 });
    expect(early?.question).toEqual(dna("q-1"));
    expect(input.attemptRecords[1]?.contribution).toMatchObject({ conceptId: RATIO.id, status: "skipped", skipped: true, isCorrect: null });

    expect(input.masteryByConcept).toEqual([
      computeMasteryState(input.attemptRecords, { studentId: STUDENT, conceptId: PERCENTAGES.id, conceptName: PERCENTAGES.name, now: NOW }),
      computeMasteryState(input.attemptRecords, { studentId: STUDENT, conceptId: RATIO.id, conceptName: RATIO.name, now: NOW })
    ]);
    expect(input.masteryByConcept[0]?.detail).toBeDefined();
    expect(input.masteryByConcept[0]).not.toHaveProperty("overall");
  });

  it("preserves the history reader's order exactly (no re-sorting of the finalizedAt ASC contract)", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    const a = await world.finalizedAttempt({ id: "a-1", questionId: "q-1", start: 0, finalize: 10 });
    const b = await world.finalizedAttempt({ id: "a-2", questionId: "q-1", start: 20, finalize: 30 });
    const c = await world.finalizedAttempt({ id: "a-3", questionId: "q-1", start: 40, finalize: 50 });
    const deps = world.deps({ attemptHistoryReader: { findFinalizedByStudentId: async () => [a, b, c], findByPracticeBlockId: async () => [] } });

    const input = await composeTrainingOrchestrationInput(deps, request);
    expect(input.attemptRecords.map((r) => r.contribution.attemptId)).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("excludes (never invents context for) attempts whose question is outside the published pool, has no canonical row, or whose concept link is broken", async () => {
    const world = new World();
    world.addQuestion({ id: "q-good" });
    world.addQuestion({ id: "q-no-canonical", canonical: false });
    world.addQuestion({ id: "q-broken-concept", concept: RATIO, dna: { conceptName: "Percentages" } });
    world.addQuestion({ id: "q-other-exam", exam: OTHER_EXAM });
    await world.finalizedAttempt({ id: "a-good", questionId: "q-good", start: 0, finalize: 10 });
    await world.finalizedAttempt({ id: "a-no-canonical", questionId: "q-no-canonical", start: 20, finalize: 30 });
    await world.finalizedAttempt({ id: "a-broken", questionId: "q-broken-concept", start: 40, finalize: 50 });
    await world.finalizedAttempt({ id: "a-other-exam", questionId: "q-other-exam", start: 60, finalize: 70 });
    await world.finalizedAttempt({ id: "a-unknown", questionId: "q-never-existed", start: 80, finalize: 90 });

    const input = await composeTrainingOrchestrationInput(world.deps(), request);
    expect(input.attemptRecords.map((r) => r.contribution.attemptId)).toEqual(["a-good"]);
  });

  it("loads each canonical question once, however many attempts reference it", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", start: 0, finalize: 10 });
    await world.finalizedAttempt({ id: "a-2", questionId: "q-1", start: 20, finalize: 30 });
    const deps = world.deps();
    const spies = spyOnReads(deps);

    await composeTrainingOrchestrationInput(deps, request);
    expect(spies.canonical).toHaveBeenCalledTimes(1);
  });

  it("another student's finalized attempts never enter this student's records", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.finalizedAttempt({ id: "a-mine", questionId: "q-1", start: 0, finalize: 10 });
    await world.finalizedAttempt({ id: "a-theirs", questionId: "q-1", start: 0, finalize: 10, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });

    const input = await composeTrainingOrchestrationInput(world.deps(), request);
    expect(input.attemptRecords.map((r) => r.contribution.attemptId)).toEqual(["a-mine"]);
  });

  it("fails closed if the history reader returns another student's attempt", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    const theirs = await world.finalizedAttempt({ id: "a-theirs", questionId: "q-1", start: 0, finalize: 10, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT });
    const deps = world.deps({ attemptHistoryReader: { findFinalizedByStudentId: async () => [theirs], findByPracticeBlockId: async () => [] } });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it("fails closed if the history reader returns a non-finalized attempt", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    const open = await world.openAttempt({ id: "a-open", questionId: "q-1", start: 0 });
    const deps = world.deps({ attemptHistoryReader: { findFinalizedByStudentId: async () => [open], findByPracticeBlockId: async () => [] } });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "repository_contract_violation");
  });
});

describe("composeTrainingOrchestrationInput — RepairPlans", () => {
  it("includes a fully confirmed plan; excludes a plan whose Autopsy has no confirmedAt and a pre-D-039 plan with null snapshot fields", async () => {
    const world = new World();
    world.repairPlans = [
      storedRepairPlan({ id: "rp-confirmed" }),
      storedRepairPlan({ id: "rp-unconfirmed", confirmedAt: null }),
      storedRepairPlan({ id: "rp-pre-d039", targetPatternFamilyName: null, recommendedTrainingMode: null, priority: null })
    ];

    const input = await composeTrainingOrchestrationInput(world.deps(), request);

    expect(input.activeRepairPlans).toHaveLength(1);
    expect(input.activeRepairPlans[0]).toEqual({
      plan: {
        targetConceptName: PERCENTAGES.name,
        targetPatternFamilyName: "Reverse Percentage",
        targetTaxonomyCellId: "cell-reverse-standard",
        targetErrorCategory: "misconception",
        targetErrorTaxonomyCode: "base_confusion",
        recommendedTrainingMode: "guided_hint_first",
        priority: "high",
        rationale: [],
        prerequisites: [],
        confirmationSource: { attemptId: "diagnosed-attempt", hypothesisConfirmedAt: t(4_000) }
      }
    });
  });

  it("fails closed if the RepairPlan reader returns another student's plan", async () => {
    const world = new World();
    const deps = world.deps({ repairPlanReader: { findConfirmedActiveByStudentId: async () => [storedRepairPlan({ studentId: OTHER_STUDENT })] } });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });
});

describe("composeTrainingOrchestrationInput — active session / practice blocks", () => {
  async function worldWithTwoBlocks() {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    world.addQuestion({ id: "q-2" });
    world.addQuestion({ id: "q-3" });
    await world.sessions.create({ id: "session-1", enrollmentId: ENROLLMENT, now: t(0) });
    await world.blocks.create({ id: "block-1", practiceSessionId: "session-1", now: t(0), blockTimeBudgetSeconds: 600, targetQuestionCount: 3 });
    await world.finalizedAttempt({ id: "b1-a1", questionId: "q-1", start: 10, finalize: 70, practiceBlockId: "block-1" });
    await world.finalizedAttempt({ id: "b1-a2", questionId: "q-2", correct: false, start: 80, finalize: 200, practiceBlockId: "block-1" });
    await world.finalizedAttempt({ id: "b1-a3", questionId: "q-3", start: 215, finalize: 260, practiceBlockId: "block-1" });
    await world.blocks.complete("block-1", { now: t(300) });
    await world.blocks.create({ id: "block-2", practiceSessionId: "session-1", now: t(400) });
    await world.finalizedAttempt({ id: "b2-a1", questionId: "q-1", start: 410, finalize: 450, practiceBlockId: "block-2" });
    await world.finalizedAttempt({ id: "b2-a2", questionId: "q-2", start: 460, finalize: 500, practiceBlockId: "block-2" });
    return world;
  }

  it("builds one context per block, in sequence order, with time measures from @ipmat/practice-block's own derive functions", async () => {
    const world = await worldWithTwoBlocks();
    const input = await composeTrainingOrchestrationInput(world.deps(), request);

    expect(input.practiceBlocks?.map((b) => b.practiceBlockId)).toEqual(["block-1", "block-2"]);
    const [block1, block2] = input.practiceBlocks ?? [];

    const block1State = await world.blocks.findById("block-1");
    const block1Attempts = await world.attempts.findByPracticeBlockId("block-1");
    expect(block1).toEqual({
      practiceBlockId: "block-1",
      attemptIdsInOrder: ["b1-a1", "b1-a2", "b1-a3"],
      targetQuestionCount: 3,
      blockTimeBudgetSeconds: 600,
      wallClockDurationSeconds: block1State ? deriveBlockWallClockDurationSeconds(block1State) : undefined,
      activeSolvingTimeSeconds: deriveBlockActiveSolvingTimeSeconds(block1Attempts),
      interAttemptGapsSeconds: deriveInterAttemptGapsSeconds(
        block1Attempts.map((a) => ({ blockSequenceNumber: a.blockMembership?.blockSequenceNumber ?? 0, startedAt: a.startedAt, finalizedAt: a.finalizedAt }))
      )
    });
    expect(block1?.wallClockDurationSeconds).toBe(300);
    expect(block1?.activeSolvingTimeSeconds).toBe(60 + 120 + 45);
    expect(block1?.interAttemptGapsSeconds).toEqual([10, 15]);
    expect(block2?.wallClockDurationSeconds).toBeNull(); // still active

    // Contract: every block attempt id also appears in attemptRecords.
    const recordIds = new Set(input.attemptRecords.map((r) => r.contribution.attemptId));
    for (const block of input.practiceBlocks ?? []) {
      expect(block.attemptIdsInOrder.every((id) => recordIds.has(id))).toBe(true);
    }
  });

  it("orders block attempts by blockSequenceNumber and blocks by sequenceNumber even if a reader returns them shuffled", async () => {
    const world = await worldWithTwoBlocks();
    const blocks = await world.blocks.findBySessionId("session-1");
    const deps = world.deps({
      practiceBlockReader: { findBySessionId: async () => [...blocks].reverse() },
      attemptHistoryReader: {
        findFinalizedByStudentId: (studentId) => world.attempts.findFinalizedByStudentId(studentId),
        findByPracticeBlockId: async (blockId) => [...(await world.attempts.findByPracticeBlockId(blockId))].reverse()
      }
    });

    const input = await composeTrainingOrchestrationInput(deps, request);
    expect(input.practiceBlocks?.map((b) => b.practiceBlockId)).toEqual(["block-1", "block-2"]);
    expect(input.practiceBlocks?.[0]?.attemptIdsInOrder).toEqual(["b1-a1", "b1-a2", "b1-a3"]);
  });

  it("omits a block with an in-progress attempt or with no attempts (its evidence cannot satisfy the attemptRecords contract)", async () => {
    const world = await worldWithTwoBlocks();
    await world.blocks.complete("block-2", { now: t(510) });
    await world.blocks.create({ id: "block-3", practiceSessionId: "session-1", now: t(520) });
    await world.finalizedAttempt({ id: "b3-a1", questionId: "q-1", start: 530, finalize: 560, practiceBlockId: "block-3" });
    await world.openAttempt({ id: "b3-a2", questionId: "q-2", start: 570, practiceBlockId: "block-3" });
    await world.blocks.complete("block-3", { now: t(600) });
    await world.blocks.create({ id: "block-4", practiceSessionId: "session-1", now: t(610) });

    const input = await composeTrainingOrchestrationInput(world.deps(), request);
    expect(input.practiceBlocks?.map((b) => b.practiceBlockId)).toEqual(["block-1", "block-2"]);
  });

  it("blocks of a completed (non-active) session are never read", async () => {
    const world = new World();
    await world.sessions.create({ id: "session-old", enrollmentId: ENROLLMENT, now: t(0) });
    await world.sessions.complete("session-old", { now: t(10) });
    const deps = world.deps();
    const spies = spyOnReads(deps);

    const input = await composeTrainingOrchestrationInput(deps, request);
    expect(spies.blocks).not.toHaveBeenCalled();
    expect(input.practiceBlocks).toEqual([]);
  });

  it("fails closed when a block's attempt belongs to another student", async () => {
    const world = await worldWithTwoBlocks();
    const foreign: AttemptState = {
      ...(await world.finalizedAttempt({ id: "foreign", questionId: "q-1", start: 0, finalize: 5, studentId: OTHER_STUDENT, enrollmentId: OTHER_ENROLLMENT })),
      blockMembership: { practiceBlockId: "block-1", blockSequenceNumber: 4 }
    };
    const deps = world.deps({
      attemptHistoryReader: {
        findFinalizedByStudentId: (studentId) => world.attempts.findFinalizedByStudentId(studentId),
        findByPracticeBlockId: async (blockId) => [...(await world.attempts.findByPracticeBlockId(blockId)), ...(blockId === "block-1" ? [foreign] : [])]
      }
    });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it("fails closed when a block's attempt belongs to the same student but a different enrollment", async () => {
    const world = await worldWithTwoBlocks();
    const block1 = await world.attempts.findByPracticeBlockId("block-1");
    const crossEnrollment = block1.map((a, i) => (i === 0 ? { ...a, enrollmentId: "enrollment-of-another-exam" } : a));
    const deps = world.deps({
      attemptHistoryReader: {
        findFinalizedByStudentId: (studentId) => world.attempts.findFinalizedByStudentId(studentId),
        findByPracticeBlockId: async (blockId) => (blockId === "block-1" ? crossEnrollment : world.attempts.findByPracticeBlockId(blockId))
      }
    });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it("fails closed when an attempt returned for a block records membership in a different block", async () => {
    const world = await worldWithTwoBlocks();
    const block2 = await world.attempts.findByPracticeBlockId("block-2");
    const deps = world.deps({
      attemptHistoryReader: {
        findFinalizedByStudentId: (studentId) => world.attempts.findFinalizedByStudentId(studentId),
        findByPracticeBlockId: async (blockId) => (blockId === "block-1" ? block2 : world.attempts.findByPracticeBlockId(blockId))
      }
    });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it("fails closed when the block reader returns a block from another session", async () => {
    const world = await worldWithTwoBlocks();
    const blocks = await world.blocks.findBySessionId("session-1");
    const deps = world.deps({
      practiceBlockReader: { findBySessionId: async () => [...blocks, { ...blocks[0]!, id: "block-x", practiceSessionId: "session-of-someone-else", sequenceNumber: 9 }] }
    });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it("fails closed when the session reader returns another enrollment's session", async () => {
    const world = new World();
    const deps = world.deps({
      practiceSessionReader: {
        findActiveByEnrollmentId: async () => ({ id: "s-x", enrollmentId: OTHER_ENROLLMENT, status: "active", startedAt: t(0), endedAt: null, sessionTimeBudgetSeconds: null })
      }
    });
    await expectCode(composeTrainingOrchestrationInput(deps, request), "ownership_inconsistency");
  });

  it("propagates the repository's fail-closed error when an enrollment has two active sessions", async () => {
    const world = new World();
    await world.sessions.create({ id: "session-a", enrollmentId: ENROLLMENT, now: t(0) });
    await world.sessions.create({ id: "session-b", enrollmentId: ENROLLMENT, now: t(10) });
    await expect(composeTrainingOrchestrationInput(world.deps(), request)).rejects.toThrow(PersistenceError);
  });
});

describe("composeTrainingOrchestrationInput — repository failures propagate, never swallowed", () => {
  const failure = new Error("simulated database outage");
  const failingOverrides: Array<[string, (world: World) => Partial<TrainingRecommendationDependencies>]> = [
    ["enrollmentReader", () => ({ enrollmentReader: { findById: () => Promise.reject(failure) } })],
    ["findFinalizedByStudentId", (w) => ({ attemptHistoryReader: { findFinalizedByStudentId: () => Promise.reject(failure), findByPracticeBlockId: (id) => w.attempts.findByPracticeBlockId(id) } })],
    ["repairPlanReader", () => ({ repairPlanReader: { findConfirmedActiveByStudentId: () => Promise.reject(failure) } })],
    ["trainingQuestionReader", () => ({ trainingQuestionReader: { findPublishedByExamId: () => Promise.reject(failure) } })],
    ["questionReader", () => ({ questionReader: { findById: () => Promise.reject(failure) } })],
    ["conceptReader", () => ({ conceptReader: { findWithPublishedQuestionsByExamId: () => Promise.reject(failure) } })],
    ["practiceSessionReader", () => ({ practiceSessionReader: { findActiveByEnrollmentId: () => Promise.reject(failure) } })],
    ["practiceBlockReader", () => ({ practiceBlockReader: { findBySessionId: () => Promise.reject(failure) } })],
    ["findByPracticeBlockId", (w) => ({ attemptHistoryReader: { findFinalizedByStudentId: (id) => w.attempts.findFinalizedByStudentId(id), findByPracticeBlockId: () => Promise.reject(failure) } })]
  ];

  it.each(failingOverrides)("%s failure rejects with the original error", async (_name, override) => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.sessions.create({ id: "session-1", enrollmentId: ENROLLMENT, now: t(0) });
    await world.blocks.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", start: 10, finalize: 20, practiceBlockId: "block-1" });

    await expect(composeTrainingOrchestrationInput(world.deps(override(world)), request)).rejects.toBe(failure);
  });
});

describe("composeTrainingOrchestrationInput — read-only", () => {
  it("never calls a write method on any repository it is given", async () => {
    const world = new World();
    world.addQuestion({ id: "q-1" });
    await world.sessions.create({ id: "session-1", enrollmentId: ENROLLMENT, now: t(0) });
    await world.blocks.create({ id: "block-1", practiceSessionId: "session-1", now: t(0) });
    await world.finalizedAttempt({ id: "a-1", questionId: "q-1", start: 10, finalize: 20, practiceBlockId: "block-1" });
    const writes = [
      vi.spyOn(world.attempts, "save"),
      vi.spyOn(world.sessions, "create"),
      vi.spyOn(world.sessions, "complete"),
      vi.spyOn(world.sessions, "abandon"),
      vi.spyOn(world.blocks, "create"),
      vi.spyOn(world.blocks, "complete"),
      vi.spyOn(world.blocks, "abandon")
    ];

    await composeTrainingOrchestrationInput(world.deps(), request);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
  });
});
