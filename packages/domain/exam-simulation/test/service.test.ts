import { describe, expect, it } from "vitest";
import { SimulationService, toFinalizedSimulationEvidence } from "../src/index.js";
import { DURATION, ENROLLMENT, fixtureConfig, fixtureSelection, REQ, STUDENT, world } from "./fixtures.js";

const DEADLINE_MS = DURATION * 1000;
const code = async (p: Promise<unknown>): Promise<string> => p.then(() => "no error", (e: { code?: string }) => e.code ?? "unknown");

describe("start: configured, validated, recoverable", () => {
  it("fails closed when no simulation is configured for the exam (no exam rule is ever assumed)", async () => {
    const w = world();
    w.configs.definition = null;
    expect(await code(w.service.start(REQ))).toBe("no_simulation_configured");
  });
  it("creates an in-progress simulation with the paper's sections, positions and the server deadline", async () => {
    const w = world();
    const { simulation, created } = await w.service.start(REQ);
    expect(created).toBe(true);
    expect(simulation).toMatchObject({ status: "in_progress", examCode: "FIXTURE_EXAM", remainingSeconds: DURATION, resultAvailable: false });
    expect(simulation.sections.map((s) => [s.sectionName, s.positions])).toEqual([["Section A", [1, 2]], ["Section B", [3]]]);
    expect(simulation.questions.every((q) => q.status === "unanswered")).toBe(true);
  });
  it("refuses an invalid paper (unpublished question) and a configuration of another exam", async () => {
    const w = world();
    w.questions.pool = w.questions.pool.map((c) => (c.questionId === "qa2" ? { ...c, validationState: "draft" } : c));
    expect(await code(w.service.start(REQ))).toBe("invalid_paper");
    const w2 = world();
    w2.configs.definition = { config: fixtureConfig({ examCode: "OTHER_EXAM" }), selection: fixtureSelection() };
    w2.enrollments.rows.push({ id: "enr-x", studentId: STUDENT, examCode: "OTHER_EXAM" });
    w2.configs.findDefinition = async () => w2.configs.definition;
    w2.enrollments.rows[0]!.examCode = "FIXTURE_EXAM";
    expect(await code(w2.service.start(REQ))).toBe("invalid_config");
  });
  it("RECOVERS instead of duplicating: a refresh, a reconnect or a double click returns the same simulation", async () => {
    const w = world();
    const a = await w.service.start(REQ);
    w.clock.at(5000);
    const b = await w.service.start(REQ);
    expect(b.created).toBe(false);
    expect(b.simulation.simulationId).toBe(a.simulation.simulationId);
    expect(b.simulation.remainingSeconds).toBe(DURATION - 5);
  });
  it("concurrent starts create exactly one simulation", async () => {
    const w = world();
    const results = await Promise.all(Array.from({ length: 8 }, () => w.service.start(REQ)));
    expect(new Set(results.map((r) => r.simulation.simulationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });
  it("after the deadline passes, the old simulation expires and a new start creates a fresh one", async () => {
    const w = world();
    const first = await w.service.start(REQ);
    w.clock.at(DEADLINE_MS + 1);
    const second = await w.service.start(REQ);
    expect(second.created).toBe(true);
    expect(second.simulation.simulationId).not.toBe(first.simulation.simulationId);
    expect((await w.service.get(REQ, first.simulation.simulationId)).status).toBe("expired");
  });
  it("survives a process restart: a NEW service over the same persisted state resumes it", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    await w.service.answer(REQ, simulation.simulationId, { position: 1, answer: "11" });
    let n = 100;
    const restarted = new SimulationService({ enrollments: w.enrollments, configs: w.configs, questions: w.questions, repository: w.repo, now: w.clock.now, newId: () => `sim-${++n}` });
    const view = await restarted.get(REQ, simulation.simulationId);
    expect(view.questions[0]).toMatchObject({ status: "answered", chosenAnswer: "11" });
    expect((await restarted.start(REQ)).created).toBe(false);
  });
});

describe("answering and submitting", () => {
  async function started() {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    return { w, id: simulation.simulationId };
  }
  it("records, changes, and reports answers; unanswered stay unanswered", async () => {
    const { w, id } = await started();
    expect((await w.service.answer(REQ, id, { position: 1, answer: "10" })).outcome).toBe("recorded");
    w.clock.at(2000);
    const r = await w.service.answer(REQ, id, { position: 1, answer: "11" });
    expect(r.simulation.questions.map((q) => [q.status, q.chosenAnswer])).toEqual([["answered", "11"], ["unanswered", null], ["unanswered", null]]);
  });
  it("rejects invalid positions and options with typed errors, recording nothing", async () => {
    const { w, id } = await started();
    expect(await code(w.service.answer(REQ, id, { position: 9, answer: "11" }))).toBe("invalid_position");
    expect(await code(w.service.answer(REQ, id, { position: 1, answer: "nope" }))).toBe("invalid_answer");
    expect((await w.service.get(REQ, id)).questions.every((q) => q.status === "unanswered")).toBe(true);
  });
  it("refuses to record an answer for a question edited or unpublished after the paper was fixed", async () => {
    const { w, id } = await started();
    w.questions.fingerprintOverride.qa1 = "fp-EDITED";
    expect(await code(w.service.answer(REQ, id, { position: 1, answer: "11" }))).toBe("question_content_changed");
    w.questions.unpublished.add("qa2");
    expect(await code(w.service.answer(REQ, id, { position: 2, answer: "22" }))).toBe("question_content_changed");
  });
  it("submit finalizes with a raw, traceable result and computes no score", async () => {
    const { w, id } = await started();
    await w.service.answer(REQ, id, { position: 1, answer: "11" });
    await w.service.answer(REQ, id, { position: 2, answer: "23" });
    w.clock.at(60_000);
    const s = await w.service.submit(REQ, id);
    expect(s.outcome).toBe("submitted");
    expect(s.result).toMatchObject({ status: "submitted", scoring: { defined: false }, interpretation: "none", totals: { answered: 2, unanswered: 1, correct: 1, incorrect: 1 } });
    expect(s.result!.timing).toMatchObject({ elapsedSeconds: 60, finalizedBy: "student_submit" });
    expect(await w.service.result(REQ, id)).toEqual(s.result);
  });
  it("is idempotent: a repeated or concurrent submit yields ONE finalization and the same result", async () => {
    const { w, id } = await started();
    await w.service.answer(REQ, id, { position: 1, answer: "11" });
    w.clock.at(1000);
    const many = await Promise.all(Array.from({ length: 6 }, () => w.service.submit(REQ, id)));
    expect(many.filter((m) => m.outcome === "submitted")).toHaveLength(1);
    expect(many.filter((m) => m.outcome === "already_submitted")).toHaveLength(5);
    expect(new Set(many.map((m) => JSON.stringify(m.result))).size).toBe(1);
  });
  it("after finalization nothing can change: answers are rejected, events and result stay identical", async () => {
    const { w, id } = await started();
    await w.service.answer(REQ, id, { position: 1, answer: "11" });
    const done = await w.service.submit(REQ, id);
    const before = JSON.stringify(await w.repo.load(id));
    w.clock.at(5000);
    expect((await w.service.answer(REQ, id, { position: 2, answer: "22" })).outcome).toBe("rejected_finalized");
    expect((await w.service.submit(REQ, id)).outcome).toBe("already_submitted");
    expect(JSON.stringify(await w.repo.load(id))).toBe(before);
    expect(done.result!.totals.answered).toBe(1);
  });
  it("answer keys are read only to finalize, never to answer or view", async () => {
    const { w, id } = await started();
    w.questions.answerKeyReads = 0;
    await w.service.answer(REQ, id, { position: 1, answer: "11" });
    await w.service.get(REQ, id);
    expect(w.questions.answerKeyReads).toBe(0);
    await w.service.submit(REQ, id);
    expect(w.questions.answerKeyReads).toBe(1);
  });
});

describe("time: server-authoritative, deterministic expiry and the submit/expiry race", () => {
  async function started() {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    return { w, id: simulation.simulationId };
  }
  it("a submit 1 ms before the deadline wins; at the deadline the simulation is expired and the submit is rejected as too late", async () => {
    const a = await started();
    a.w.clock.at(DEADLINE_MS - 1);
    expect((await a.w.service.submit(REQ, a.id)).outcome).toBe("submitted");
    const b = await started();
    b.w.clock.at(DEADLINE_MS);
    const late = await b.w.service.submit(REQ, b.id);
    expect(late.outcome).toBe("expired_before_submit");
    expect(late.result).toMatchObject({ status: "expired", timing: { finalizedBy: "deadline", elapsedSeconds: DURATION } });
  });
  it("answers accepted before the deadline survive expiry; later ones are rejected and never recorded", async () => {
    const { w, id } = await started();
    w.clock.at(DEADLINE_MS - 1000);
    await w.service.answer(REQ, id, { position: 1, answer: "11" });
    w.clock.at(DEADLINE_MS + 1000);
    const late = await w.service.answer(REQ, id, { position: 2, answer: "22" });
    expect(late.outcome).toBe("rejected_expired");
    expect(late.simulation.status).toBe("expired");
    const r = await w.service.result(REQ, id);
    expect(r.questions.map((q) => q.answered)).toEqual([true, false, false]);
    expect(r.status).toBe("expired");
  });
  it("any access after the deadline finalizes as expired AT the deadline, whenever it is noticed", async () => {
    const { w, id } = await started();
    w.clock.at(DEADLINE_MS * 9);
    expect((await w.service.get(REQ, id)).status).toBe("expired");
    expect((await w.service.result(REQ, id)).timing).toMatchObject({ finalizedAt: new Date(Date.parse((await w.service.result(REQ, id)).timing.startedAt) + DEADLINE_MS).toISOString(), elapsedSeconds: DURATION });
  });
  it("remaining time comes only from the server clock", async () => {
    const { w, id } = await started();
    w.clock.at(100_000);
    expect((await w.service.get(REQ, id)).remainingSeconds).toBe(DURATION - 100);
    w.clock.at(100_000); // time cannot be 'adjusted' by any request: there is no parameter to carry one
    expect((await w.service.get(REQ, id)).remainingSeconds).toBe(DURATION - 100);
  });
  it("concurrent answers and a submit race safely: every accepted answer is in the result iff it preceded finalization, and the result is final", async () => {
    const { w, id } = await started();
    const ops = [
      w.service.answer(REQ, id, { position: 1, answer: "11" }),
      w.service.answer(REQ, id, { position: 2, answer: "22" }),
      w.service.submit(REQ, id),
      w.service.answer(REQ, id, { position: 3, answer: "33" }),
      w.service.submit(REQ, id)
    ];
    await Promise.all(ops);
    const state = (await w.repo.load(id))!;
    const result = state.result!;
    expect(state.status).toBe("submitted");
    // the result's answered count equals the answers recorded as events before finalization (none can be appended afterwards)
    expect(result.totals.answered).toBe(new Set(state.events.map((e) => e.position)).size);
    expect(state.events.every((e) => Date.parse(e.occurredAt) <= Date.parse(state.finalizedAt!))).toBe(true);
    expect((await w.service.submit(REQ, id)).result).toEqual(result);
  });
  it("an answer racing the deadline: exactly the ones before it are accepted", async () => {
    const { w, id } = await started();
    w.clock.at(DEADLINE_MS - 1);
    const early = await w.service.answer(REQ, id, { position: 1, answer: "11" });
    w.clock.at(DEADLINE_MS);
    const atDeadline = await w.service.answer(REQ, id, { position: 2, answer: "22" });
    expect([early.outcome, atDeadline.outcome]).toEqual(["recorded", "rejected_expired"]);
  });
});

describe("ownership and isolation", () => {
  it("enrollment ownership is enforced before anything is read", async () => {
    const w = world();
    expect(await code(w.service.start({ studentId: "student-2", enrollmentId: ENROLLMENT }))).toBe("enrollment_ownership_mismatch");
    expect(await code(w.service.start({ studentId: STUDENT, enrollmentId: "nope" }))).toBe("enrollment_not_found");
  });
  it("another student's simulation is indistinguishable from a missing one, for every operation", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    const other = { studentId: "student-2", enrollmentId: "enrollment-2" };
    const id = simulation.simulationId;
    for (const op of [() => w.service.get(other, id), () => w.service.getQuestion(other, id, 1), () => w.service.answer(other, id, { position: 1, answer: "11" }), () => w.service.submit(other, id), () => w.service.result(other, id)]) {
      expect(await code(op())).toBe("simulation_not_found");
    }
    expect(await code(w.service.get(other, "does-not-exist"))).toBe("simulation_not_found");
    // the owner is unaffected
    expect((await w.service.get(REQ, id)).questions.every((q) => q.status === "unanswered")).toBe(true);
  });
  it("another enrollment of the SAME student, and another exam's enrollment, cannot reach the simulation", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    expect(await code(w.service.get({ studentId: STUDENT, enrollmentId: "enrollment-other-exam" }, simulation.simulationId))).toBe("simulation_not_found");
  });
  it("two students each get their own simulation, and neither sees the other's answers", async () => {
    const w = world();
    const a = await w.service.start(REQ);
    const b = await w.service.start({ studentId: "student-2", enrollmentId: "enrollment-2" });
    expect(a.simulation.simulationId).not.toBe(b.simulation.simulationId);
    await w.service.answer(REQ, a.simulation.simulationId, { position: 1, answer: "11" });
    const bView = await w.service.get({ studentId: "student-2", enrollmentId: "enrollment-2" }, b.simulation.simulationId);
    expect(bView.questions.every((q) => q.status === "unanswered")).toBe(true);
  });
  it("a result is available only to its owner and only once finalized", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    expect(await code(w.service.result(REQ, simulation.simulationId))).toBe("not_finalized");
    await w.service.submit(REQ, simulation.simulationId);
    expect(await code(w.service.result({ studentId: "student-2", enrollmentId: "enrollment-2" }, simulation.simulationId))).toBe("simulation_not_found");
    expect((await w.service.result(REQ, simulation.simulationId)).status).toBe("submitted");
  });
});

describe("content integrity: published, correct version, no answer key", () => {
  it("serves student-safe question content only while in progress, with no answer-bearing field", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    const q = await w.service.getQuestion(REQ, simulation.simulationId, 1);
    expect(q).toEqual({ position: 1, sectionName: "Section A", prompt: "Prompt of qa1", answerFormat: "multiple_choice", options: ["10", "11", "12"] });
    expect(JSON.stringify(q)).not.toMatch(/correct|answerKey|fingerprint|solution/i);
    await w.service.submit(REQ, simulation.simulationId);
    expect(await code(w.service.getQuestion(REQ, simulation.simulationId, 1))).toBe("simulation_finalized");
  });
  it("refuses to serve a question edited or unpublished after the paper was fixed", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    w.questions.fingerprintOverride.qa1 = "fp-EDITED";
    expect(await code(w.service.getQuestion(REQ, simulation.simulationId, 1))).toBe("question_content_changed");
    expect(await code(w.service.getQuestion(REQ, simulation.simulationId, 9))).toBe("invalid_position");
  });
  it("no view, question or result field carries the answer key, a fingerprint or provenance detail", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    await w.service.answer(REQ, simulation.simulationId, { position: 1, answer: "11" });
    const done = await w.service.submit(REQ, simulation.simulationId);
    const text = JSON.stringify([simulation, done.simulation, await w.service.getQuestion(REQ, simulation.simulationId, 1).catch(() => null)]);
    expect(text).not.toMatch(/correctAnswer|fp-qa|contentFingerprint|provenance|sourceType|"33"/);
  });
});

describe("downstream integration is explicit and only for finalized simulations", () => {
  it("nothing feeds other systems implicitly: the service has no dependency on training, adaptive, revision, repair, mastery or attempts", async () => {
    const w = world();
    const { simulation } = await w.service.start(REQ);
    await w.service.answer(REQ, simulation.simulationId, { position: 1, answer: "11" });
    await w.service.submit(REQ, simulation.simulationId);
    const state = (await w.repo.load(simulation.simulationId))!;
    const evidence = toFinalizedSimulationEvidence(state);
    expect(evidence).toMatchObject({ contract: "finalized_simulation_evidence_v1", studentId: STUDENT, interpretation: "none" });
    // an in-progress simulation is partial and is never evidence
    const second = (await w.service.start(REQ)).simulation.simulationId;
    expect(() => toFinalizedSimulationEvidence((async () => (await w.repo.load(second))!) as never)).toThrow();
    const open = (await w.repo.load(second))!;
    expect(open.status).toBe("in_progress");
    expect(() => toFinalizedSimulationEvidence(open)).toThrowError(/Only a finalized simulation/);
  });
});
