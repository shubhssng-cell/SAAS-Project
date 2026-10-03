import { beforeEach, describe, expect, it } from "vitest";
import { buildRevisionIntelligence, scopeContextToExam, REVISION_EXPOSURE_TYPES, REVISION_INTELLIGENCE_SYSTEM_IDS, RevisionIntelligenceError } from "../src/index.js";
import { attempt, candidate, contextOf, dormantWorld, evidenceOf, EXAM, question, realRuns, resetCounter, selectedOutcome, STUDENT } from "./fixtures.js";

beforeEach(resetCounter);

function run(records: ReturnType<typeof attempt>[], candidates: ReturnType<typeof candidate>[], runs?: ReturnType<typeof realRuns>, ctx: Parameters<typeof contextOf>[2] = {}) {
  const context = contextOf(records, candidates, ctx);
  return buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence: evidenceOf(records), context, runs: runs ?? realRuns(context) });
}

describe("with the REAL providers: revision and trap recurrence", () => {
  const { records, candidates } = dormantWorld();
  const result = run(records, candidates);

  it("marks itself evidence-based with NO verdict and NO priority", () => {
    expect(result.status).toBe("evidence_based_no_verdict");
    expect(result.priority.defined).toBe(false);
    expect(result.priority.note).toMatch(/No priority/);
    expect(result.evaluatedAt).toBe("2026-10-03T12:00:00.000Z");
  });

  it("consults every existing system once and records each provider's own outcome", () => {
    expect(result.providerOutcomes.map((p) => p.systemId)).toEqual([...REVISION_INTELLIGENCE_SYSTEM_IDS]);
    const byId = Object.fromEntries(result.providerOutcomes.map((p) => [p.systemId, p]));
    expect(byId.revision!.status).toBe("selected");
    expect(byId["trap-lab"]!.status).toBe("selected");
    expect(byId.revision!.explanation).toMatch(/longest-dormant/);
  });

  it("recommendations come ONLY from providers that selected, listed alphabetically (which carries no meaning)", () => {
    expect(result.recommendations.map((r) => r.systemId)).toEqual(["revision", "trap-lab"]);
    for (const r of result.recommendations) {
      expect(r.producedBy).toBe(r.systemId);
      expect(r.exposureType).toBe(REVISION_EXPOSURE_TYPES[r.systemId]);
    }
  });

  it("revision: why this concept, which signal, which attempts, which question", () => {
    const r = result.recommendations.find((x) => x.systemId === "revision")!;
    expect(r.targetConceptName).toBe("Percentages");
    expect(r.supportingSignalIds).toEqual(["dormant_concept|Percentages|*"]);
    expect(r.evidenceDimensions).toEqual(["concept"]);
    expect(r.contributingAttemptIds).toEqual(records.map((x) => x.contribution.attemptId).reverse().length ? result.signals.find((s) => s.id === r.supportingSignalIds[0])!.contributingAttemptIds : []);
    expect(r.contributingAttemptIds).toHaveLength(3);
    expect(r.contributingAttemptsNote).toBeNull();
    expect(r.providerExplanation).toMatch(/Percentages/);
    expect(candidates.some((c) => c.question.questionId === r.question.questionId)).toBe(true);
    expect(r.question.validationState).toBe("published");
  });

  it("trap: why this error code, which attempts", () => {
    const r = result.recommendations.find((x) => x.systemId === "trap-lab")!;
    expect(r.targetErrorTaxonomyCode).toBe("base_confusion");
    expect(r.supportingSignalIds).toEqual(["recurring_trap_failure|*|base_confusion"]);
    expect(r.evidenceDimensions).toEqual(["error_code"]);
    expect(r.contributingAttemptIds).toHaveLength(2);
  });

  it("two applicable systems are kept as an explicit, UNRESOLVED conflict - never ranked", () => {
    const c = result.conflicts.find((x) => x.kind === "competing_revision_types")!;
    expect(c).toMatchObject({ involves: ["revision", "trap-lab"], resolution: "unresolved_product_decision" });
  });

  it("a recurring trap alongside correct attempts on that trap is preserved as a conflict with both counts", () => {
    const q = (id: string) => question(id, { trapErrorTaxonomyCode: "base_confusion" });
    const r = run([attempt(q("a"), { isCorrect: false }), attempt(q("b"), { isCorrect: false }), attempt(q("c"), { isCorrect: true })], [candidate(q("a")), candidate(q("d"))]);
    const c = r.conflicts.find((x) => x.kind === "recurring_trap_with_correct_attempts")!;
    expect(c.facts).toMatchObject({ errorCode: "base_confusion", correctGradedAttempts: 1, incorrectGradedAttempts: 2 });
    expect(c.resolution).toBe("unresolved_product_decision");
  });

  it("signals no provider serves are listed as unserved with the reason (no invented pattern/mode revision type)", () => {
    const un = Object.fromEntries(result.unservedSignals.map((u) => [u.signalId, u]));
    const gap = result.unservedSignals.find((u) => u.signalId.startsWith("pattern_family_without_graded_evidence") || u.signalId.startsWith("testing_mode_without_graded_evidence"));
    if (gap) {
      expect(gap.possibleSystemId).toBeNull();
      expect(gap.reason).toMatch(/undefined product decision/);
    }
    for (const rec of result.recommendations) for (const id of rec.supportingSignalIds) expect(un[id]).toBeUndefined();
  });
});

describe("no eligible candidate, not applicable and content gaps", () => {
  it("nothing applicable: no recommendations, no conflicts, every system recorded with its own reason", () => {
    const r = run([attempt(question("a"), { daysAgo: 1 })], [candidate(question("b"))]);
    expect(r.recommendations).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.providerOutcomes.every((p) => p.status !== "selected")).toBe(true);
  });
  it("applicable but the published pool has no question for the target: reported as a content gap, distinct from not applicable", () => {
    const { records } = dormantWorld();
    const r = run(records, []);
    expect(r.noEligibleCandidate).toContain("revision");
    expect(r.providerOutcomes.find((p) => p.systemId === "revision")!.status).toBe("no_eligible_question");
    expect(r.recommendations.find((x) => x.systemId === "revision")).toBeUndefined();
    expect(r.unservedSignals.find((u) => u.signalId === "dormant_concept|Percentages|*")!.reason).toMatch(/no_eligible_question/);
  });
  it("an unpublished question is never recommended", () => {
    const { records, candidates } = dormantWorld();
    const draft = [candidate(question("draft-q"), { validationState: "draft" })];
    expect(run(records, draft).recommendations).toEqual([]);
    expect(run(records, [...candidates, ...draft]).recommendations.map((r) => r.question.questionId)).not.toContain("draft-q");
  });
  it("another exam's question is never recommended once the context is scoped to the exam; unscoped, a provider picking it is refused (fail closed)", () => {
    const { records } = dormantWorld();
    const foreign = [candidate(question("jee-q", { examCode: "JEE_MAIN" }))];
    const scoped = scopeContextToExam(contextOf(records, foreign), EXAM);
    expect(scoped.candidates).toEqual([]);
    expect(buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence: evidenceOf(records), context: scoped, runs: realRuns(scoped) }).recommendations).toEqual([]);
    // the existing Revision provider does not filter by exam itself (its caller supplies an exam-scoped pool), so an unscoped foreign pick is caught here:
    expect(() => run(records, foreign)).toThrow(/not a published question of this exam's pool/);
  });
  it("scoping removes only other-exam and other-student data and leaves everything else untouched", () => {
    const { records, candidates } = dormantWorld();
    const mixed = contextOf([...records, attempt(question("x", { examCode: "JEE_MAIN" })), attempt(question("y"), { studentId: "student-2" })], [...candidates, candidate(question("c", { examCode: "JEE_MAIN" }))]);
    const scoped = scopeContextToExam(mixed, EXAM);
    expect(scoped.attemptRecords).toEqual(records);
    expect(scoped.candidates).toEqual(candidates);
    expect(scoped.now).toBe(mixed.now);
    expect(mixed.attemptRecords).toHaveLength(records.length + 2);
  });
  it("a provider that selects a non-published or other-exam question is refused (fail closed)", () => {
    const { records, candidates } = dormantWorld();
    const context = contextOf(records, [...candidates, candidate(question("d"), { validationState: "draft" })]);
    const evidence = evidenceOf(records);
    const bad = (q: ReturnType<typeof question>) => () => buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence, context, runs: [{ systemId: "speed-lab", outcome: selectedOutcome(q) }] });
    expect(bad(question("d"))).toThrowError(RevisionIntelligenceError);
    expect(bad(question("never-in-pool"))).toThrowError(/not a published question/);
  });
});

describe("scripted outcomes from other systems", () => {
  it("novelty exposure links to its novelty gap signal when one exists; calculation/speed/pressure link none and say so", () => {
    const base = question("base");
    const novel = question("n", { noveltyLevel: "novel_context" });
    const records = [attempt(base, { daysAgo: 1 })];
    const context = contextOf(records, [candidate(base), candidate(novel)]);
    const r = buildRevisionIntelligence({
      studentId: STUDENT,
      examCode: EXAM,
      evidence: evidenceOf(records),
      context,
      runs: [
        { systemId: "novelty-training", outcome: selectedOutcome(novel, { targetConceptName: "Percentages", targetNoveltyLevel: "novel_context" }, "novelty rule") },
        { systemId: "speed-lab", outcome: selectedOutcome(base, { testingModes: ["direct"] }, "pace rule") }
      ]
    });
    const nov = r.recommendations.find((x) => x.systemId === "novelty-training")!;
    expect(nov.supportingSignalIds).toEqual(["novelty_level_without_graded_evidence|Percentages|novel_context"]);
    expect(nov.evidenceDimensions).toEqual(["concept", "novelty_level"]);
    const pace = r.recommendations.find((x) => x.systemId === "speed-lab")!;
    expect(pace.supportingSignalIds).toEqual([]);
    expect(pace.contributingAttemptsNote).toMatch(/provider-owned/);
    expect(pace.evidenceDimensions).toEqual(["testing_mode"]);
    expect(pace.providerExplanation).toBe("pace rule");
    expect(r.providerOutcomes.find((p) => p.systemId === "calculation-gym")!.status).toBe("not_run");
  });
  it("a provider error and a system without a provider are recorded, never hidden or thrown", () => {
    const records = [attempt(question("a"))];
    const context = contextOf(records, [candidate(question("a"))]);
    const r = buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence: evidenceOf(records), context, runs: [{ systemId: "speed-lab", outcome: { status: "error", code: "invalid_context", explanation: "bad" } }, { systemId: "pressure-training", outcome: null }] });
    expect(r.providerOutcomes.find((p) => p.systemId === "speed-lab")).toMatchObject({ status: "error", reason: "invalid_context" });
    expect(r.providerOutcomes.find((p) => p.systemId === "pressure-training")!.status).toBe("not_built");
  });
  it("an unknown system id is refused", () => {
    const records = [attempt(question("a"))];
    const context = contextOf(records, []);
    expect(() => buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence: evidenceOf(records), context, runs: [{ systemId: "mock-simulation", outcome: null }] })).toThrow(/not a system this layer consults/);
  });
});

describe("scope, invariance, determinism and Unit 1 compatibility", () => {
  const { records, candidates } = dormantWorld();
  it("refuses mismatched student or exam", () => {
    const context = contextOf(records, candidates);
    const evidence = evidenceOf(records);
    expect(() => buildRevisionIntelligence({ studentId: "other", examCode: EXAM, evidence, context, runs: [] })).toThrow(RevisionIntelligenceError);
    expect(() => buildRevisionIntelligence({ studentId: STUDENT, examCode: "JEE_MAIN", evidence, context, runs: [] })).toThrow(/different exam/);
  });
  it("exam isolation: another exam's attempts and questions change nothing", () => {
    const base = run(records, candidates);
    const foreignRecords = [1, 2, 3].map((i) => attempt(question(`x${i}`, { examCode: "JEE_MAIN", conceptName: "Percentages", trapErrorTaxonomyCode: "base_confusion" }), { daysAgo: 90, isCorrect: false }));
    const foreignCandidates = [candidate(question("xp", { examCode: "JEE_MAIN" }))];
    const context = contextOf([...records, ...foreignRecords], [...candidates, ...foreignCandidates]);
    const mixed = buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence: evidenceOf(records), context, runs: realRuns(contextOf(records, candidates)) });
    expect(mixed).toEqual(base);
  });
  it("candidate invariance: adding questions that are not selected (unpublished, other concept) never changes the recommendations", () => {
    const base = run(records, candidates);
    const extra = [candidate(question("zz-draft"), { validationState: "draft" }), candidate(question("zz-ratio", { conceptName: "Ratio" })), candidate(question("zz-novel", { noveltyLevel: "novel_context" }))];
    const widened = run(records, [...candidates, ...extra]);
    expect(widened.recommendations.map((r) => [r.systemId, r.question.questionId])).toEqual(base.recommendations.map((r) => [r.systemId, r.question.questionId]));
  });
  it("is deterministic and independent of record and candidate order", () => {
    const first = run(records, candidates);
    expect(run(records, candidates)).toEqual(first);
    expect(run([...records].reverse(), [...candidates].reverse())).toEqual(first);
  });
  it("Unit 1 evidence is consumed unchanged", () => {
    const evidence = evidenceOf(records);
    const before = JSON.stringify(evidence);
    const context = contextOf(records, candidates);
    buildRevisionIntelligence({ studentId: STUDENT, examCode: EXAM, evidence, context, runs: realRuns(context) });
    expect(JSON.stringify(evidence)).toBe(before);
    expect(evidence.status).toBe("evidence_only");
  });
  it("trace integrity: every referenced signal and attempt exists, and every question is in the published pool", () => {
    const r = run(records, candidates);
    const signalIds = new Set(r.signals.map((s) => s.id));
    const attemptIds = new Set(records.map((x) => x.contribution.attemptId));
    for (const rec of r.recommendations) {
      for (const id of rec.supportingSignalIds) expect(signalIds.has(id)).toBe(true);
      for (const id of rec.contributingAttemptIds) expect(attemptIds.has(id)).toBe(true);
      expect(candidates.some((c) => c.question.questionId === rec.question.questionId && c.validationState === "published")).toBe(true);
    }
    for (const u of r.unservedSignals) expect(signalIds.has(u.signalId)).toBe(true);
    for (const c of r.conflicts) expect(c.involves.length).toBeGreaterThan(0);
  });
  it("no score, rank, verdict, confidence or prediction field appears anywhere in the output", () => {
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); }
    };
    walk(run(records, candidates));
    for (const k of keys) expect(k, k).not.toMatch(/score|rank|verdict|mastered|mastery|confidence|ability|readiness|probab|predict|weak|strong/i);
  });
});
