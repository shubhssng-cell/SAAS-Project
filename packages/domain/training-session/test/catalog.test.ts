import { describe, expect, it } from "vitest";
import { buildDefaultProviderRegistry } from "@ipmat/training-orchestration";
import { TRAINING_DIMENSIONS, TRAINING_SYSTEM_CATALOG, findTrainingSystem } from "../src/catalog.js";

describe("training system catalog -- registration and lookup", () => {
  it("registers all seven performance dimensions, once each, in a fixed order", () => {
    expect(TRAINING_SYSTEM_CATALOG.map((d) => d.dimension)).toEqual(["calculation", "speed", "trap", "novelty", "pressure", "revision", "overtraining"]);
    expect([...TRAINING_SYSTEM_CATALOG.map((d) => d.dimension)].sort()).toEqual([...TRAINING_DIMENSIONS].sort());
    expect(new Set(TRAINING_SYSTEM_CATALOG.map((d) => d.systemId)).size).toBe(TRAINING_SYSTEM_CATALOG.length);
  });

  it("system lookup is deterministic and exact", () => {
    expect(findTrainingSystem("speed-lab")).toBe(findTrainingSystem("speed-lab"));
    expect(findTrainingSystem("speed-lab")?.dimension).toBe("speed");
  });

  it("an unknown or differently-cased id resolves to null, never to a near match", () => {
    expect(findTrainingSystem("nope")).toBeNull();
    expect(findTrainingSystem("Speed-Lab")).toBeNull();
    expect(findTrainingSystem("")).toBeNull();
  });

  it("every system that names a provider names one the existing orchestration registry really has (no second registry)", () => {
    const registry = buildDefaultProviderRegistry();
    for (const definition of TRAINING_SYSTEM_CATALOG) {
      if (definition.providerId !== null) {
        expect(registry.has(definition.providerId), definition.systemId).toBe(true);
        if (definition.systemId !== "revision") expect(definition.providerId).toBe(definition.systemId);
        else expect(definition.providerId).toBe("revision-training"); // Unit 7: the catalog id is the student-facing "revision", the provider id is "revision-training"
      }
    }
  });

  it("Overtraining is honestly marked as having no engine (Revision has one since Unit 7)", () => {
    expect(findTrainingSystem("revision")?.providerId).toBe("revision-training");
    expect(findTrainingSystem("overtraining")?.providerId).toBeNull();
  });
});

describe("Pressure Training catalog entry (Phase 5 Unit 6)", () => {
  const pressure = findTrainingSystem("pressure-training")!;

  it("is wired to the existing pressure-training provider, with no stages and a timed-run-only restriction", () => {
    expect(pressure.providerId).toBe("pressure-training");
    expect(pressure.dimension).toBe("pressure");
    expect(pressure.stages).toBeUndefined();
    expect(pressure.completionKinds).toEqual(["fixed_duration"]);
    expect(pressure.conceptNotInObjective).toBe(true);
  });

  it("is the only system that restricts the completion kind", () => {
    const restricted = TRAINING_SYSTEM_CATALOG.filter((d) => d.completionKinds !== undefined).map((d) => d.systemId);
    expect(restricted).toEqual(["pressure-training"]);
  });

  it("has an authored sentence for each provider not-applicable reason, none of which shows a code, threshold, count or trait claim", () => {
    expect(Object.keys(pressure.notApplicableByReason ?? {}).sort()).toEqual(["insufficient_evidence", "sufficient_blocks_no_pressure_detected"]);
    const copy = [pressure.trains, pressure.sessionTitle, pressure.notApplicableNote, pressure.noEligibleNote, pressure.noLongerApplicableNote, pressure.focusSentence, ...Object.values(pressure.notApplicableByReason ?? {})].join(" ");
    expect(copy).not.toMatch(/insufficient_evidence|sufficient_blocks|within_block|reduced_recovery|budget_consumption|\d+%|threshold/i);
    expect(copy).not.toMatch(/stress|anxi|fatigue|panic|nervous|confidence|motivat|struggle|weak|lack|poor|resilien|crack/i);
  });
});

describe("Revision catalog entry (Phase 5 Unit 7)", () => {
  const revision = findTrainingSystem("revision")!;

  it("is wired to the revision-training provider, with no stages, no completion restriction and no concept in its objective", () => {
    expect(revision.providerId).toBe("revision-training");
    expect(revision.dimension).toBe("revision");
    expect(revision.stages).toBeUndefined();
    expect(revision.completionKinds).toBeUndefined();
    expect(revision.conceptNotInObjective).toBe(true);
  });

  it("its authored copy shows no day count, threshold, reason code, forgetting claim or trait claim", () => {
    const copy = [revision.trains, revision.sessionTitle, revision.notApplicableNote, revision.noEligibleNote, revision.noLongerApplicableNote, revision.focusSentence].join(" ");
    expect(copy).not.toMatch(/\d|insufficient_evidence|threshold|dormant|dormancy/i);
    expect(copy).not.toMatch(/forgot|forget|memory|decay|confiden|motivat|emotion|\bability\b|weak|lazy|careless|struggle|stress|anxi/i);
  });
});
