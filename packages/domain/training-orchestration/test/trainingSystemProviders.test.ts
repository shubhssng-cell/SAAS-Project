import type { TrainingSystemContext, TrainingSystemOutcome, TrainingSystemProvider } from "@ipmat/training-systems";
import { describe, expect, it } from "vitest";
import { attemptTrainingSystems, buildDefaultProviderRegistry, toTrainingSystemContext, TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER } from "../src/trainingSystemProviders.js";
import type { TrainingOrchestrationInput } from "../src/types.js";
import { makeAttemptRecord, makeCandidate, STUDENT } from "./fixtures.js";

function baseInput(overrides: Partial<TrainingOrchestrationInput> = {}): TrainingOrchestrationInput {
  return { studentId: STUDENT, activeRepairPlans: [], masteryByConcept: [], attemptRecords: [], candidates: [], ...overrides };
}

/** A tiny fake `TrainingSystemProvider` for controlled sequencing tests — never a real domain package, so this never touches or depends on any of the five real providers. */
function fakeProvider(providerId: string, outcome: TrainingSystemOutcome): TrainingSystemProvider {
  return {
    providerId,
    evaluate: () =>
      outcome.status === "not_applicable" ? { applicable: false, reason: outcome.reason, explanation: outcome.explanation } : { applicable: true, requirement: {}, explanation: "fake" },
    select: () => (outcome.status === "not_applicable" ? { status: "error", code: "invalid_context", explanation: "unreachable in this fake" } : outcome)
  };
}

describe("toTrainingSystemContext", () => {
  it("maps every shared field, and deliberately omits activeRepairPlans (no such field exists on TrainingSystemContext)", () => {
    const input = baseInput({
      masteryByConcept: [],
      attemptRecords: [makeAttemptRecord({ isCorrect: true })],
      prepPhase: null,
      candidates: [makeCandidate()]
    });
    const context: TrainingSystemContext = toTrainingSystemContext(input);
    expect(context.studentId).toBe(input.studentId);
    expect(context.attemptRecords).toBe(input.attemptRecords);
    expect(context.candidates).toBe(input.candidates);
    expect("activeRepairPlans" in context).toBe(false);
  });

  it("forwards errorTaxonomy/practiceBlocks through unmodified when supplied", () => {
    const practiceBlocks = [
      { practiceBlockId: "b1", attemptIdsInOrder: ["a1"], targetQuestionCount: null, blockTimeBudgetSeconds: null, wallClockDurationSeconds: null, activeSolvingTimeSeconds: 30, interAttemptGapsSeconds: [] }
    ];
    const input = baseInput({ practiceBlocks, errorTaxonomy: [{ code: "base_confusion", label: "Base confusion", description: "test", category: "trap" }] });
    const context = toTrainingSystemContext(input);
    expect(context.practiceBlocks).toBe(practiceBlocks);
    expect(context.errorTaxonomy?.[0]?.code).toBe("base_confusion");
  });
});

describe("TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER and the default registry", () => {
  it("is exactly trap-lab, calculation-gym, speed-lab, pressure-training, novelty-training, in that order", () => {
    expect(TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER).toEqual(["trap-lab", "calculation-gym", "speed-lab", "pressure-training", "novelty-training"]);
  });

  it("every id in the priority order has a registered provider with a matching providerId", () => {
    const registry = buildDefaultProviderRegistry();
    for (const providerId of TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER) {
      const provider = registry.get(providerId);
      expect(provider, `no provider registered for "${providerId}"`).toBeDefined();
      expect(provider?.providerId).toBe(providerId);
    }
  });
});

describe("attemptTrainingSystems -- sequencing (using fake, injected providers for full determinism)", () => {
  it("stops at the first provider that selects, in priority order", () => {
    const registry = new Map([
      ["trap-lab", fakeProvider("trap-lab", { status: "not_applicable", reason: "insufficient_evidence", explanation: "x", diagnostics: undefined as never })],
      [
        "calculation-gym",
        fakeProvider("calculation-gym", {
          status: "selected",
          question: makeCandidate().question,
          requirement: {},
          explanation: "picked",
          diagnostics: { providerId: "calculation-gym", studentId: STUDENT, eligible: true, candidatesConsidered: 1, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] }
        })
      ],
      ["speed-lab", fakeProvider("speed-lab", { status: "not_applicable", reason: "insufficient_evidence", explanation: "should never be reached", diagnostics: undefined as never })]
    ]);
    // Only trap-lab/calculation-gym/speed-lab registered on purpose -- proves the loop only visits what it needs to (stops at calculation-gym) and tolerates a partial registry.
    const attempt = attemptTrainingSystems(baseInput(), registry as never);
    expect(attempt.selected?.providerId).toBe("calculation-gym");
    expect(attempt.outcomes.map((o) => o.providerId)).toEqual(["trap-lab", "calculation-gym"]); // speed-lab never invoked
  });

  it("a not_applicable outcome is recorded and the next provider is tried", () => {
    const registry = new Map([
      ["trap-lab", fakeProvider("trap-lab", { status: "not_applicable", reason: "insufficient_evidence", explanation: "no evidence", diagnostics: undefined as never })],
      ["calculation-gym", fakeProvider("calculation-gym", { status: "not_applicable", reason: "insufficient_evidence", explanation: "no evidence", diagnostics: undefined as never })]
    ]);
    const attempt = attemptTrainingSystems(baseInput(), registry as never);
    expect(attempt.selected).toBeNull();
    expect(attempt.outcomes).toHaveLength(2);
    expect(attempt.outcomes.every((o) => o.outcome.status === "not_applicable")).toBe(true);
  });

  it("a no_eligible_question outcome is recorded and the next provider is tried", () => {
    const registry = new Map([
      [
        "trap-lab",
        fakeProvider("trap-lab", {
          status: "no_eligible_question",
          requirement: {},
          explanation: "applicable but nothing to select",
          diagnostics: { providerId: "trap-lab", studentId: STUDENT, eligible: true, candidatesConsidered: 0, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] }
        })
      ],
      [
        "calculation-gym",
        fakeProvider("calculation-gym", {
          status: "selected",
          question: makeCandidate().question,
          requirement: {},
          explanation: "picked",
          diagnostics: { providerId: "calculation-gym", studentId: STUDENT, eligible: true, candidatesConsidered: 1, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] }
        })
      ]
    ]);
    const attempt = attemptTrainingSystems(baseInput(), registry as never);
    expect(attempt.selected?.providerId).toBe("calculation-gym");
    expect(attempt.outcomes[0]?.outcome.status).toBe("no_eligible_question");
  });

  it("a provider-level error outcome is recorded and NEVER crashes or blocks trying the next provider", () => {
    const registry = new Map([
      [
        "trap-lab",
        fakeProvider("trap-lab", {
          status: "error",
          code: "invalid_context",
          explanation: "an impossible execution condition"
        })
      ],
      [
        "calculation-gym",
        fakeProvider("calculation-gym", {
          status: "selected",
          question: makeCandidate().question,
          requirement: {},
          explanation: "picked",
          diagnostics: { providerId: "calculation-gym", studentId: STUDENT, eligible: true, candidatesConsidered: 1, excludedMalformedCount: 0, excludedIneligibleCount: 0, notes: [] }
        })
      ]
    ]);
    expect(() => attemptTrainingSystems(baseInput(), registry as never)).not.toThrow();
    const attempt = attemptTrainingSystems(baseInput(), registry as never);
    expect(attempt.outcomes[0]?.outcome.status).toBe("error");
    expect(attempt.selected?.providerId).toBe("calculation-gym");
  });

  it("returns selected: null when every provider fails to select", () => {
    const registry = new Map([
      ["trap-lab", fakeProvider("trap-lab", { status: "not_applicable", reason: "insufficient_evidence", explanation: "x", diagnostics: undefined as never })]
    ]);
    const attempt = attemptTrainingSystems(baseInput(), registry as never);
    expect(attempt.selected).toBeNull();
  });
});
