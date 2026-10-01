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
        expect(definition.providerId).toBe(definition.systemId);
      }
    }
  });

  it("Revision and Overtraining are honestly marked as having no engine", () => {
    expect(findTrainingSystem("revision")?.providerId).toBeNull();
    expect(findTrainingSystem("overtraining")?.providerId).toBeNull();
  });
});
