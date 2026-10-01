import { AUTOPSY_THRESHOLDS } from "@ipmat/autopsy";
import { runTrainingSystemProvider } from "@ipmat/training-systems";
import type { TrainingSystemContext } from "@ipmat/training-systems";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateTrapLab } from "../src/applicability.js";
import { TrapLabProvider } from "../src/provider.js";
import { computeTrapAssociatedFailureRecurrence } from "../src/trapEvidence.js";
import { makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

/**
 * Phase 5 Unit 4 (student-facing Trap Lab) leaves the provider UNCHANGED. These tests pin the semantics the student-facing layer relies on, so a
 * later change cannot quietly alter them: the canonical recurrence gate, no recency/decay, cell diversity and resistance as diagnostics only, the
 * evaluate-is-the-only-authority contract, and the absence of any stage / score / psychological vocabulary.
 */
const MIN = AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT;
function ctx(overrides: Partial<TrainingSystemContext> = {}): TrainingSystemContext {
  return { studentId: STUDENT, masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}
const failing = (n: number, over: Parameters<typeof makeAttemptRecord>[0] = {}) => Array.from({ length: n }, (_, i) => makeAttemptRecord({ trapErrorTaxonomyCode: "base_confusion", isCorrect: false, questionId: `f-${over.patternTaxonomyCellId ?? "c"}-${i}`, ...over }));

describe("Trap Lab -- semantics preserved for the student-facing layer", () => {
  it("the recurrence gate is exactly AUTOPSY_THRESHOLDS.REPEATED_EVIDENCE_MIN_COUNT distinct failing questions (one fewer is not enough)", () => {
    expect(evaluateTrapLab(ctx({ attemptRecords: failing(MIN - 1) })).applicable).toBe(false);
    expect(evaluateTrapLab(ctx({ attemptRecords: failing(MIN) })).applicable).toBe(true);
    expect(evaluateTrapLab(ctx({ attemptRecords: failing(MIN + 3) })).applicable).toBe(true);
  });

  it("no recency or decay: the same history gives the same decision whatever its order or age", () => {
    const history = failing(MIN);
    const old = history.map((r) => ({ ...r, contribution: { ...r.contribution, finalizedAt: "2001-01-01T00:00:00.000Z" } }));
    const recent = history.map((r) => ({ ...r, contribution: { ...r.contribution, finalizedAt: "2099-01-01T00:00:00.000Z" } }));
    for (const variant of [old, recent, [...history].reverse()]) expect(JSON.stringify(evaluateTrapLab(ctx({ attemptRecords: variant })))).toBe(JSON.stringify(evaluateTrapLab(ctx({ attemptRecords: history }))));
  });

  it("taxonomy-cell diversity is diagnostic-only: failures that all share ONE cell still activate it", () => {
    const sameCell = failing(MIN, { patternTaxonomyCellId: "only-cell" });
    expect(computeTrapAssociatedFailureRecurrence(STUDENT, sameCell, undefined)[0]!.distinctPatternTaxonomyCellIds).toHaveLength(1);
    expect(evaluateTrapLab(ctx({ attemptRecords: sameCell })).applicable).toBe(true);
  });

  it("hint-free / hint-assisted resistance is diagnostic-only: it neither gates nor cancels a recurrence", () => {
    const resisted = [...failing(MIN), makeAttemptRecord({ trapErrorTaxonomyCode: "base_confusion", isCorrect: true, hintsUsed: 0 }), makeAttemptRecord({ trapErrorTaxonomyCode: "base_confusion", isCorrect: true, hintsUsed: 2 })];
    expect(evaluateTrapLab(ctx({ attemptRecords: resisted })).applicable).toBe(true);
    expect(evaluateTrapLab(ctx({ attemptRecords: [...failing(1), ...resisted.slice(MIN)] })).applicable).toBe(false); // resistance alone never creates a recurrence
  });

  it("evaluate() is the sole authority: select() is never reached when it says not applicable, and select() cannot express not_applicable", () => {
    let selectCalls = 0;
    class Spy extends TrapLabProvider {
      override select(...args: Parameters<TrapLabProvider["select"]>) {
        selectCalls += 1;
        return super.select(...args);
      }
    }
    expect(runTrainingSystemProvider(new Spy(), ctx()).status).toBe("not_applicable");
    expect(selectCalls).toBe(0);
    const applicable = runTrainingSystemProvider(new Spy(), ctx({ attemptRecords: failing(MIN), candidates: [makeCandidate({ trapErrorTaxonomyCode: "base_confusion" })] }));
    expect(selectCalls).toBe(1);
    expect(["selected", "no_eligible_question", "error"]).toContain(applicable.status); // never "not_applicable" from select()
  });

  it("a requirement select() did not get from evaluate() is an `error` (impossible execution), never a quiet 'no match'", () => {
    const out = new TrapLabProvider().select(ctx(), { requirement: { notes: [] } as never, explanation: "x" });
    expect(out).toMatchObject({ status: "error", code: "invalid_context" });
  });

  it("has no stage / progression / score / confidence vocabulary and no randomness or clock in its source", () => {
    const src = join(dirname(dirname(fileURLToPath(import.meta.url))), "src");
    for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
      const code = readFileSync(join(src, file), "utf-8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
      expect(code, `${file} stage`).not.toMatch(/\bstage\b|steady_pace|foundational|time_pressured_stage|resistanceScore|trapScore|confidence|priorityScore/);
      expect(code, `${file} random`).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    }
  });
});
