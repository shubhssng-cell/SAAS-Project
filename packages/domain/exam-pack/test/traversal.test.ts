import { describe, expect, it } from "vitest";
import {
  ExamPackQueryError,
  getAncestors,
  getChildNodes,
  getConceptsAtNode,
  getDescendants,
  getDirectPrerequisites,
  getLearningOrder,
  getNeighbors,
  getRelationsFor,
  getSectionsInOrder,
  getSyllabusPath,
  getSyllabusTree,
  getUnlockedConcepts
} from "../src/index.js";
import { concept, makePack, relation } from "./fixtures.js";

describe("syllabus hierarchy", () => {
  const pack = makePack();

  it("orders sections and siblings by declared order, regardless of input order", () => {
    const shuffled = makePack({ sections: [...pack.sections].reverse(), syllabus: [...pack.syllabus].reverse() });
    expect(getSectionsInOrder(shuffled).map((s) => s.key)).toEqual(["s1", "s2"]);
    expect(getChildNodes(shuffled, "s1", null).map((n) => n.key)).toEqual(["s1/ch1", "s1/ch2"]);
    expect(getChildNodes(shuffled, "s1", "s1/ch1").map((n) => n.key)).toEqual(["s1/ch1/topic"]);
  });

  it("builds the full tree with concepts attached to their node", () => {
    const tree = getSyllabusTree(pack);
    expect(tree.map((s) => s.section.key)).toEqual(["s1", "s2"]);
    const ch1 = tree[0]!.nodes[0]!;
    expect(ch1.concepts.map((c) => c.key)).toEqual(["a"]);
    expect(ch1.children[0]!.node.key).toBe("s1/ch1/topic");
    expect(ch1.children[0]!.concepts.map((c) => c.key)).toEqual(["b"]);
  });

  it("resolves the root-first path of a nested node and rejects an unknown one", () => {
    expect(getSyllabusPath(pack, "s1/ch1/topic").map((n) => n.key)).toEqual(["s1/ch1", "s1/ch1/topic"]);
    expect(() => getSyllabusPath(pack, "nope")).toThrow(ExamPackQueryError);
  });

  it("lists concepts at a node by name then key", () => {
    const p = makePack({ concepts: [concept("z2", { name: "Alpha" }), concept("z1", { name: "Alpha" }), concept("m", { name: "Beta" })] });
    expect(getConceptsAtNode(p, "s1/ch1").map((c) => c.key)).toEqual(["z1", "z2", "m"]);
  });
});

describe("prerequisite / unlock traversal", () => {
  const pack = makePack();

  it("direct prerequisites and unlocks are inverses and sorted", () => {
    expect(getDirectPrerequisites(pack, "c")).toEqual(["b"]);
    expect(getUnlockedConcepts(pack, "a")).toEqual(["b"]);
    expect(getUnlockedConcepts(pack, "b")).toEqual(["c"]);
    expect(getDirectPrerequisites(pack, "a")).toEqual([]);
  });

  it("ancestors/descendants are transitive, nearest first, and exclude the concept itself", () => {
    expect(getAncestors(pack, "c")).toEqual([
      { key: "b", distance: 1 },
      { key: "a", distance: 2 }
    ]);
    expect(getDescendants(pack, "a")).toEqual([
      { key: "b", distance: 1 },
      { key: "c", distance: 2 }
    ]);
  });

  it("only follows the requested relation types (default is the strict prerequisite gate)", () => {
    expect(getAncestors(pack, "c", ["prerequisite", "foundational"])).toEqual([
      { key: "a", distance: 1 },
      { key: "b", distance: 1 }
    ]);
    expect(getDescendants(pack, "d", ["application"])).toEqual([{ key: "e", distance: 1 }]);
    expect(getAncestors(pack, "d")).toEqual([]);
  });

  it("reports the SHORTEST distance when a concept is reachable two ways", () => {
    const diamond = makePack({ relations: [...makePack().relations, relation("a", "c")] });
    expect(getAncestors(diamond, "c")).toEqual([
      { key: "a", distance: 1 },
      { key: "b", distance: 1 }
    ]);
  });

  it("terminates on cyclic non-ordering relations", () => {
    const cyclic = makePack({ relations: [relation("a", "b", "application"), relation("b", "c", "application"), relation("c", "a", "application")] });
    expect(getDescendants(cyclic, "a", ["application"]).map((r) => r.key)).toEqual(["b", "c"]);
    expect(getAncestors(cyclic, "a", ["application"]).map((r) => r.key)).toEqual(["c", "b"]);
  });

  it("an unknown concept is a typed error, not an empty answer", () => {
    expect(() => getAncestors(pack, "ghost")).toThrow(ExamPackQueryError);
    expect(() => getRelationsFor(pack, "ghost")).toThrow(ExamPackQueryError);
    expect(() => getDirectPrerequisites(pack, "ghost")).toThrow(ExamPackQueryError);
  });
});

describe("relations and neighbors", () => {
  const pack = makePack();

  it("keeps the eight relation types distinct (no flattening into 'related')", () => {
    expect(getRelationsFor(pack, "b").map((r) => r.type)).toEqual(["directly_related", "prerequisite", "prerequisite"]);
    expect(getRelationsFor(pack, "b", ["directly_related"])).toHaveLength(1);
  });

  it("tags direction: symmetric types as symmetric, directional ones as outgoing/incoming", () => {
    expect(getNeighbors(pack, "b")).toEqual([
      { key: "a", type: "prerequisite", direction: "incoming" },
      { key: "c", type: "prerequisite", direction: "outgoing" },
      { key: "d", type: "directly_related", direction: "symmetric" }
    ]);
    expect(getNeighbors(pack, "d", ["directly_related"])).toEqual([{ key: "b", type: "directly_related", direction: "symmetric" }]);
  });
});

describe("learning order", () => {
  it("places every concept after its prerequisites and is stable under input shuffling", () => {
    const pack = makePack();
    const order = getLearningOrder(pack)!;
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    const shuffled = makePack({ concepts: [...pack.concepts].reverse(), relations: [...pack.relations].reverse() });
    expect(getLearningOrder(shuffled)).toEqual(order);
    expect(order).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("returns null for cyclic edge sets instead of looping", () => {
    const cyclic = makePack({ relations: [relation("a", "b"), relation("b", "a")] });
    expect(getLearningOrder(cyclic)).toBeNull();
  });
});
