import { describe, expect, it } from "vitest";
import { buildTrainingSystemDiagnostics } from "../src/diagnostics.js";
import { runTrainingSystemProvider } from "../src/runProvider.js";
import type { TrainingSystemOutcome, TrainingSystemSelectionOutcome } from "../src/types.js";
import { baseContext, makeCandidate, makeMockProvider } from "./fixtures.js";

describe("runTrainingSystemProvider — evaluate() is the ONE authoritative applicability decision", () => {
  it("not_applicable: select() is never called at all", () => {
    const { provider, selectCallCount } = makeMockProvider({ applicable: false, applicabilityReason: "mastery_not_weak_enough" });
    const outcome = runTrainingSystemProvider(provider, baseContext());

    expect(outcome.status).toBe("not_applicable");
    if (outcome.status === "not_applicable") {
      expect(outcome.reason).toBe("mastery_not_weak_enough");
      expect(outcome.diagnostics.eligible).toBe(false);
      expect(outcome.diagnostics.providerId).toBe("mock-provider");
    }
    expect(selectCallCount()).toBe(0);
  });

  it("applicable + selected: select() is called exactly once, with the SAME requirement evaluate() produced", () => {
    const requirement = { testingModes: ["time_pressured"] as const };
    const { provider, selectCallCount } = makeMockProvider({ applicable: true, requirement: { testingModes: [...requirement.testingModes] } });
    const candidate = makeCandidate();

    const outcome = runTrainingSystemProvider(provider, baseContext({ candidates: [candidate] }));

    expect(outcome.status).toBe("selected");
    if (outcome.status === "selected") {
      expect(outcome.question.questionId).toBe(candidate.question.questionId);
      expect(outcome.requirement).toEqual({ testingModes: ["time_pressured"] });
      expect(outcome.diagnostics.eligible).toBe(true);
    }
    expect(selectCallCount()).toBe(1);
  });

  it("applicable but no_eligible_question: diagnostics are still present and eligible is true", () => {
    const { provider } = makeMockProvider({ applicable: true });
    const outcome = runTrainingSystemProvider(provider, baseContext({ candidates: [] }));

    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") {
      expect(outcome.diagnostics.eligible).toBe(true);
      expect(outcome.diagnostics.candidatesConsidered).toBe(0);
    }
  });

  it("a candidate that is not published is excluded from selection, correctly reported as no_eligible_question", () => {
    const { provider } = makeMockProvider({ applicable: true });
    const outcome = runTrainingSystemProvider(provider, baseContext({ candidates: [makeCandidate({}, { validationState: "draft" })] }));

    expect(outcome.status).toBe("no_eligible_question");
    if (outcome.status === "no_eligible_question") {
      expect(outcome.diagnostics.excludedIneligibleCount).toBe(1);
    }
  });
});

describe("runTrainingSystemProvider — strict error semantics", () => {
  it("error is reserved for invalid/impossible execution conditions, never for an ordinary lack of matching content", () => {
    const { provider } = makeMockProvider({
      applicable: true,
      forceSelectResult: { status: "error", code: "invalid_context", explanation: "Simulated invariant violation for this test only." }
    });

    const outcome = runTrainingSystemProvider(provider, baseContext({ candidates: [makeCandidate()] }));

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.code).toBe("invalid_context");
    }
  });

  it("error results carry no diagnostics field at all -- there is nothing reliable to report", () => {
    const outcome: TrainingSystemOutcome = { status: "error", code: "provider_invariant_violation", explanation: "test" };
    expect("diagnostics" in outcome).toBe(false);
  });
});

describe("type-level guarantee: select()'s own return type structurally excludes not_applicable", () => {
  it("a TrainingSystemSelectionOutcome literal cannot claim not_applicable -- proving 'one authoritative source' at the type level, not just by convention", () => {
    // @ts-expect-error -- TrainingSystemSelectionOutcome has no "not_applicable" variant; only evaluate()/runTrainingSystemProvider() may ever produce one.
    const bad: TrainingSystemSelectionOutcome = { status: "not_applicable", reason: "x", explanation: "x", diagnostics: buildTrainingSystemDiagnostics({ providerId: "p", studentId: "s", eligible: false }) };
    void bad;
  });

  it("sanity: a well-formed selection outcome still passes the type checker", () => {
    const ok: TrainingSystemSelectionOutcome = {
      status: "selected",
      question: makeCandidate().question,
      requirement: {},
      explanation: "test",
      diagnostics: buildTrainingSystemDiagnostics({ providerId: "p", studentId: "s", eligible: true })
    };
    expect(ok.status).toBe("selected");
  });
});

describe("buildTrainingSystemDiagnostics — plain field-default constructor, not a ranking utility", () => {
  it("defaults every count field to 0 and notes to [] when omitted", () => {
    const diagnostics = buildTrainingSystemDiagnostics({ providerId: "p", studentId: "s", eligible: true });
    expect(diagnostics).toEqual({ providerId: "p", studentId: "s", eligible: true, candidatesConsidered: 0, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] });
  });
});

describe("contract exhaustiveness -- every TrainingSystemOutcome status is representable and distinguishable", () => {
  it("a switch over status handles all four variants without a default case (compile-time exhaustiveness)", () => {
    function describeOutcome(outcome: TrainingSystemOutcome): string {
      switch (outcome.status) {
        case "not_applicable":
          return `not_applicable: ${outcome.reason}`;
        case "no_eligible_question":
          return "no_eligible_question";
        case "selected":
          return `selected: ${outcome.question.questionId}`;
        case "error":
          return `error: ${outcome.code}`;
      }
    }

    expect(describeOutcome({ status: "not_applicable", reason: "r", explanation: "e", diagnostics: buildTrainingSystemDiagnostics({ providerId: "p", studentId: "s", eligible: false }) })).toContain(
      "not_applicable"
    );
    expect(describeOutcome({ status: "error", code: "invalid_context", explanation: "e" })).toContain("error");
  });
});
