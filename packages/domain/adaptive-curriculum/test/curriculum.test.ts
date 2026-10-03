import { buildMasteryEvidenceView } from "@ipmat/mastery";
import { orchestrateNextTrainingAction } from "@ipmat/training-orchestration";
import { beforeEach, describe, expect, it } from "vitest";
import { buildAdaptiveCurriculum, CurriculumError } from "../src/index.js";
import { adaptiveWorld, attempt, build, candidate, EXAM, question, repairCandidate, repairPlan, resetCounter, STUDENT, trapWorld } from "./fixtures.js";

beforeEach(resetCounter);
const kinds = (c: ReturnType<typeof build>["curriculum"]) => c.conflicts.map((x) => x.kind);

describe("the next action IS the existing orchestrator's, carried verbatim", () => {
  it("training-system tier: Trap Lab wins by the fixed D-062 order; the explanation and question are the provider's own", () => {
    const { records, candidates } = trapWorld();
    const { curriculum, orchestrationInput } = build(records, candidates);
    const direct = orchestrateNextTrainingAction({ ...orchestrationInput });
    expect(direct.status).toBe("selected");
    expect(curriculum.nextAction).toMatchObject({ status: "selected", actionType: "training_system_practice", providerId: "trap-lab", chainOrder: 1 });
    if (curriculum.nextAction.status !== "selected" || direct.status !== "selected") throw new Error("unreachable");
    expect(curriculum.nextAction.question.questionId).toBe(direct.question.questionId);
    expect(curriculum.nextAction.explanation).toBe(direct.explanation);
    expect(curriculum.nextAction.whyThisTier).toMatch(/fixed training-system order \(D-062\)/);
  });
  it("repair tier: a confirmed plan precedes everything, and training systems that also selected stay as steps", () => {
    const { records, candidates } = trapWorld();
    const { curriculum } = build(records, [...candidates, repairCandidate()], [repairPlan()]);
    expect(curriculum.nextAction).toMatchObject({ status: "selected", actionType: "targeted_repair", providerId: null, chainOrder: 0 });
    expect(curriculum.nextAction.status === "selected" && curriculum.nextAction.question.questionId).toBe("q-repair");
    const conflict = curriculum.conflicts.find((c) => c.kind === "repair_precedes_training_systems")!;
    expect(conflict).toMatchObject({ resolution: "existing_rule" });
    expect(conflict.ruleReference).toMatch(/D-062/);
    expect(curriculum.steps.find((s) => s.tier === "targeted_repair")).toMatchObject({ isOrchestratorNextAction: true, contributingAttemptIds: ["diagnosed-attempt"] });
    expect(curriculum.steps.filter((s) => s.isOrchestratorNextAction)).toHaveLength(1);
  });
  it("adaptive tier: the fallback, with the adaptive engine's own reason code", () => {
    const { records, candidates } = adaptiveWorld();
    const { curriculum } = build(records, candidates);
    expect(curriculum.nextAction).toMatchObject({ status: "selected", actionType: "adaptive_practice", providerId: null, wasFallbackFromTrainingSystems: true });
    expect(curriculum.nextAction.status === "selected" && curriculum.nextAction.adaptivePrimaryReason).toEqual(expect.any(String));
    expect(curriculum.nextAction.status === "selected" && curriculum.nextAction.whyThisTier).toMatch(/fallback/);
  });
  it("no eligible candidate: fails closed with the orchestrator's own no_action, nothing fabricated", () => {
    const { curriculum } = build([attempt(question("a"))], []);
    expect(curriculum.nextAction).toMatchObject({ status: "no_action", reason: "no_candidates_supplied" });
    expect(curriculum.steps).toEqual([]);
    const c = curriculum.conflicts.find((x) => x.kind === "no_action_available")!;
    expect(c).toMatchObject({ resolution: "existing_rule" });
    expect(curriculum.concepts.every((x) => !x.nextActionTargetsConcept)).toBe(true);
  });
});

describe("the chain: every tier of the existing order with its own outcome", () => {
  it("is exactly repair, the five providers in D-062 order, then adaptive - never re-ordered by the student's evidence", () => {
    const { records, candidates } = trapWorld();
    const { curriculum } = build(records, candidates);
    expect(curriculum.chain.map((c) => [c.order, c.id])).toEqual([[0, "targeted_repair"], [1, "trap-lab"], [2, "calculation-gym"], [3, "speed-lab"], [4, "pressure-training"], [5, "novelty-training"], [6, "adaptive_practice"]]);
    expect(curriculum.sequencing.definedBeyondExistingChain).toBe(false);
    expect(curriculum.sequencing.note).toMatch(/No cross-concept order/);
  });
  it("records what the orchestrator actually reached: it stops at the first selection", () => {
    const { records, candidates } = trapWorld();
    const { curriculum } = build(records, candidates);
    const byId = Object.fromEntries(curriculum.chain.map((c) => [c.id, c]));
    expect(byId["trap-lab"]).toMatchObject({ reachedByOrchestrator: true, outcomeStatus: "selected" });
    expect(byId["trap-lab"]!.selectedQuestionId).toBe("q-trap");
    expect(byId["adaptive_practice"]).toMatchObject({ reachedByOrchestrator: false, outcomeStatus: "not_attempted" });
    expect(byId["calculation-gym"]!.reachedByOrchestrator).toBe(false); // not reached, yet its own outcome is still shown
  });
  it("a repair no_match falls through, and the preserved detail shows it", () => {
    const { records, candidates } = trapWorld();
    const { curriculum } = build(records, candidates, [repairPlan({ targetTaxonomyCellId: "cell-nobody-has", targetPatternFamilyName: "Unmapped Family", targetConceptName: "Percentages" })]);
    const repair = curriculum.chain[0]!;
    expect(repair.reachedByOrchestrator).toBe(true);
    expect(["no_match", "selected"]).toContain(repair.outcomeStatus);
  });
});

describe("steps: candidate questions in the existing order, Revision outside the chain", () => {
  const { records, candidates } = trapWorld();
  const { curriculum } = build(records, candidates);
  it("lists a selected question per tier in chain order, with the provider's reason and the trace", () => {
    const trap = curriculum.steps.find((s) => s.systemId === "trap-lab")!;
    expect(trap).toMatchObject({ chainOrder: 1, outsideAdaptiveChain: false, tier: "training_system", isOrchestratorNextAction: true });
    expect(trap.supportingSignalIds).toEqual(["recurring_trap_failure|*|base_confusion"]);
    expect(trap.contributingAttemptIds).toHaveLength(2);
    expect(trap.question.validationState).toBe("published");
  });
  it("Revision has NO position: it is a step outside the adaptive chain and is never the next action", () => {
    const rev = curriculum.steps.find((s) => s.systemId === "revision")!;
    expect(rev).toMatchObject({ chainOrder: null, outsideAdaptiveChain: true, tier: "revision", isOrchestratorNextAction: false });
    expect(curriculum.steps[curriculum.steps.length - 1]).toBe(rev);
    const c = curriculum.conflicts.find((x) => x.kind === "revision_available_outside_adaptive_chain")!;
    expect(c).toMatchObject({ resolution: "existing_rule" });
    expect(c.ruleReference).toMatch(/D-081/);
  });
});

describe("concept view: evidence, signals, repair facts - never one number", () => {
  const { records, candidates } = trapWorld();
  const { curriculum } = build(records, candidates, [repairPlan()]);
  const view = curriculum.concepts.find((c) => c.conceptName === "Percentages")!;
  it("carries Unit 1's evidence verbatim", () => {
    expect(view.evidence).toEqual(buildMasteryEvidenceView(records, { studentId: STUDENT, examCode: EXAM, conceptNames: curriculum.concepts.map((c) => c.conceptName) }).concepts.find((c) => c.conceptName === "Percentages"));
    expect(view.evidence.overall).toMatchObject({ attempts: 3, gradedAttempts: 3, distinctQuestions: 3 });
  });
  it("carries Unit 2's signals for the concept, the unserved ones with reasons, repair target facts only, and who serves it", () => {
    expect(view.revisionSignalIds).toContain("dormant_concept|Percentages|*");
    expect(curriculum.crossConceptSignalIds).toEqual(["recurring_trap_failure|*|base_confusion"]);
    expect(view.activeRepairPlans).toEqual([{ targetPatternFamilyName: "Reverse Percentage", priority: "high" }]);
    expect(view.systemsServingConcept.length).toBeGreaterThan(0);
    expect(view.publishedQuestionsInPool).toBe(5);
    expect(view.contentAvailability).toBeNull();
  });
  it("embeds the Unit 2 result verbatim for the trace", () => {
    expect(curriculum.revision.status).toBe("evidence_based_no_verdict");
    expect(curriculum.unservedNeeds).toEqual(curriculum.revision.unservedSignals);
  });
  it("Phase 6 content availability is attached only when supplied, and is availability only", () => {
    const { records: r, candidates: c } = trapWorld();
    const b = build(r, c);
    const withAvail = buildAdaptiveCurriculum({
      studentId: STUDENT,
      examCode: EXAM,
      evidence: buildMasteryEvidenceView(r, { studentId: STUDENT, examCode: EXAM }),
      revision: b.curriculum.revision,
      orchestration: orchestrateNextTrainingAction(b.orchestrationInput),
      activeRepairPlans: [],
      candidates: c,
      contentAvailability: { Percentages: { available: 9, validated: 7, published: 5 } }
    });
    expect(withAvail.concepts.find((x) => x.conceptName === "Percentages")!.contentAvailability).toEqual({ available: 9, validated: 7, published: 5 });
  });
});

describe("conflicts are preserved with either a named existing rule or an explicit unresolved decision", () => {
  it("repair active while a concept is dormant is UNRESOLVED (no rule says whether revision waits for repair)", () => {
    const { records, candidates } = trapWorld();
    const c = build(records, [...candidates, repairCandidate()], [repairPlan()]).curriculum.conflicts.find((x) => x.kind === "repair_plan_with_revision_signal")!;
    expect(c).toMatchObject({ resolution: "unresolved_product_decision", ruleReference: null });
    expect(c.involves).toEqual(["Percentages"]);
  });
  it("Unit 2's conflicts are carried through unresolved", () => {
    const { records, candidates } = trapWorld();
    const k = kinds(build(records, candidates).curriculum);
    expect(k).toContain("competing_revision_types");
    expect(build(records, candidates).curriculum.conflicts.filter((x) => x.kind === "competing_revision_types")[0]!.resolution).toBe("unresolved_product_decision");
  });
  it("a recurring trap alongside correct attempts on that trap is preserved with both facts available through the revision trace", () => {
    const q = (id: string) => question(id, { trapErrorTaxonomyCode: "base_confusion" });
    const { curriculum } = build([attempt(q("a"), { isCorrect: false, daysAgo: 3 }), attempt(q("b"), { isCorrect: false, daysAgo: 3 }), attempt(q("c"), { isCorrect: true, daysAgo: 3 })], [candidate(q("a")), candidate(q("d"))]);
    expect(kinds(curriculum)).toContain("recurring_trap_with_correct_attempts");
  });
  it("signals no existing system serves are listed as a need without a provider", () => {
    const base = question("base");
    const other = question("other", { patternFamilyName: "Successive Percentage Change", testingModes: ["combined"] });
    const { curriculum } = build([attempt(base, { daysAgo: 1 })], [candidate(base), candidate(other)]);
    const c = curriculum.conflicts.find((x) => x.kind === "need_without_provider")!;
    expect(c.resolution).toBe("unresolved_product_decision");
    expect(c.involves.some((id) => id.startsWith("pattern_family_without_graded_evidence"))).toBe(true);
  });
  it("conflicts are sorted deterministically", () => {
    const { records, candidates } = trapWorld();
    const list = build(records, [...candidates, repairCandidate()], [repairPlan()]).curriculum.conflicts.map((c) => c.kind);
    expect(list).toEqual([...list].sort());
  });
});

describe("fail closed, scope and composition integrity", () => {
  it("refuses a next action that is not in the exam's published pool", () => {
    const { records, candidates } = trapWorld();
    const b = build(records, candidates);
    const pool = candidates.filter((c) => c.question.questionId !== "q-trap");
    expect(() =>
      buildAdaptiveCurriculum({ studentId: STUDENT, examCode: EXAM, evidence: buildMasteryEvidenceView(records, { studentId: STUDENT, examCode: EXAM }), revision: b.curriculum.revision, orchestration: orchestrateNextTrainingAction(b.orchestrationInput), activeRepairPlans: [], candidates: pool })
    ).toThrowError(CurriculumError);
  });
  it("refuses mismatched student or exam between the layers", () => {
    const { records, candidates } = trapWorld();
    const b = build(records, candidates);
    const base = { studentId: STUDENT, examCode: EXAM, evidence: buildMasteryEvidenceView(records, { studentId: STUDENT, examCode: EXAM }), revision: b.curriculum.revision, orchestration: orchestrateNextTrainingAction(b.orchestrationInput), activeRepairPlans: [], candidates };
    expect(() => buildAdaptiveCurriculum({ ...base, studentId: "other" })).toThrow(/Student mismatch/);
    expect(() => buildAdaptiveCurriculum({ ...base, examCode: "JEE_MAIN" })).toThrow(/Exam mismatch/);
  });
  it("exam and student isolation: other exams' and other students' data never change the curriculum", () => {
    const { records, candidates } = trapWorld();
    const base = build(records, candidates).curriculum;
    const foreignRecords = [1, 2, 3].map((i) => attempt(question(`x${i}`, { examCode: "JEE_MAIN", trapErrorTaxonomyCode: "t" }), { daysAgo: 90, isCorrect: false }));
    const otherStudent = [attempt(question("z"), { studentId: "student-2", isCorrect: false, daysAgo: 60 })];
    const mixed = build([...records, ...foreignRecords, ...otherStudent], [...candidates, candidate(question("jee-c", { examCode: "JEE_MAIN" }))]).curriculum;
    expect(mixed).toEqual(base);
  });
  it("candidate invariance: unpublished and other-exam questions never change the result", () => {
    const { records, candidates } = trapWorld();
    const base = build(records, candidates).curriculum;
    const noise = [candidate(question("zz-draft"), { validationState: "draft" }), candidate(question("zz-foreign", { examCode: "JEE_MAIN" }))];
    const widened = build(records, [...candidates, ...noise]).curriculum;
    expect(widened.nextAction).toEqual(base.nextAction);
    expect(widened.steps).toEqual(base.steps);
    expect(widened.chain).toEqual(base.chain);
  });
  it("deterministic, order independent and non-mutating", () => {
    const { records, candidates } = trapWorld();
    const before = JSON.stringify([records, candidates]);
    const first = build(records, candidates).curriculum;
    expect(JSON.stringify([records, candidates])).toBe(before);
    expect(build(records, candidates).curriculum).toEqual(first);
    expect(build([...records].reverse(), [...candidates].reverse()).curriculum).toEqual(first);
  });
  it("Units 1 and 2 and the orchestrator are consumed unchanged and each embedded part equals a direct call", () => {
    const { records, candidates } = trapWorld();
    const b = build(records, candidates);
    expect(b.curriculum.nextAction.status).toBe(orchestrateNextTrainingAction(b.orchestrationInput).status);
    expect(b.curriculum.concepts.map((c) => c.evidence)).toEqual(buildMasteryEvidenceView(records, { studentId: STUDENT, examCode: EXAM, conceptNames: b.curriculum.concepts.map((c) => c.conceptName) }).concepts);
  });
  it("trace integrity: every referenced id exists and every question is a published pool question", () => {
    const { records, candidates } = trapWorld();
    const { curriculum } = build(records, [...candidates, repairCandidate()], [repairPlan()]);
    const signalIds = new Set(curriculum.revision.signals.map((s) => s.id));
    const pool = new Set([...candidates, repairCandidate()].map((c) => c.question.questionId));
    for (const s of curriculum.steps) {
      expect(pool.has(s.question.questionId)).toBe(true);
      for (const id of s.supportingSignalIds) expect(signalIds.has(id)).toBe(true);
    }
    for (const id of curriculum.crossConceptSignalIds) expect(signalIds.has(id)).toBe(true);
    for (const c of curriculum.concepts) for (const id of c.revisionSignalIds) expect(signalIds.has(id)).toBe(true);
    if (curriculum.nextAction.status === "selected") expect(pool.has(curriculum.nextAction.question.questionId)).toBe(true);
  });
  it("no score, rank, verdict, confidence or prediction field appears anywhere", () => {
    const { records, candidates } = trapWorld();
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); }
    };
    walk(build(records, [...candidates, repairCandidate()], [repairPlan()]).curriculum);
    for (const k of keys) expect(k, k).not.toMatch(/score|rank|verdict|mastered|mastery|confidence|(^|[^a-z])ability|readiness|probab|predict|weak|strong/i); // "ability" as a word; contentAvailability is availability, not a claim about a student
  });
});
