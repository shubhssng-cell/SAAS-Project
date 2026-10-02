import { describe, expect, it } from "vitest";
import {
  findCycle,
  getAncestors,
  getDescendants,
  getLearningOrder,
  validateExamPack,
  type ExamPack,
  type PackRelation
} from "../src/index.js";
import { concept, makePack, relation, rng } from "./fixtures.js";

/**
 * Property-style tests with a seeded PRNG (no new dependency): each property
 * is checked across many generated packs, and a failing seed is printed so
 * the case is reproducible.
 */

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

/** A random valid pack: n concepts, forward-only (i < j) ordering edges, so the ordering graph is acyclic by construction. */
function randomDagPack(seed: number): ExamPack {
  const random = rng(seed);
  const n = 3 + Math.floor(random() * 10);
  const keys = Array.from({ length: n }, (_, i) => `c${i}`);
  const relations: PackRelation[] = [];
  const used = new Set<string>();
  const orderingTypes = ["prerequisite", "foundational", "advanced_extension"] as const;
  for (let attempts = 0; attempts < n * 3; attempts++) {
    const i = Math.floor(random() * (n - 1));
    const j = i + 1 + Math.floor(random() * (n - i - 1));
    const type = orderingTypes[Math.floor(random() * orderingTypes.length)]!;
    const id = `${i}|${j}|${type}`;
    if (used.has(id)) continue;
    used.add(id);
    relations.push(relation(keys[i]!, keys[j]!, type));
  }
  // connect every concept so the pack has no warnings, with a symmetric edge that is never a cycle
  for (let i = 0; i < n; i++) relations.push(relation(keys[i]!, keys[(i + 1) % n]!, "directly_related"));
  const deduped = relations.filter((r, idx) => !relations.slice(0, idx).some((p) => p.type === r.type && ((p.from === r.from && p.to === r.to) || (r.type === "directly_related" && p.from === r.to && p.to === r.from))));
  return makePack({ concepts: keys.map((k) => concept(k)), relations: deduped, syllabus: makePack().syllabus, sections: makePack().sections });
}

const shuffle = <T>(items: T[], random: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

describe("property: generated acyclic packs", () => {
  it.each(SEEDS)("seed %i validates with no errors", (seed) => {
    expect(validateExamPack(randomDagPack(seed)).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it.each(SEEDS)("seed %i: results are independent of input ordering (determinism)", (seed) => {
    const pack = randomDagPack(seed);
    const random = rng(seed * 7919);
    const shuffled: ExamPack = { ...pack, concepts: shuffle(pack.concepts, random), relations: shuffle(pack.relations, random) };
    const types = ["prerequisite", "foundational", "advanced_extension"] as const;
    expect(getLearningOrder(shuffled, types)).toEqual(getLearningOrder(pack, types));
    for (const c of pack.concepts) {
      expect(getAncestors(shuffled, c.key, types)).toEqual(getAncestors(pack, c.key, types));
      expect(getDescendants(shuffled, c.key, types)).toEqual(getDescendants(pack, c.key, types));
    }
  });

  it.each(SEEDS)("seed %i: ancestry and descent are exact duals", (seed) => {
    const pack = randomDagPack(seed);
    const types = ["prerequisite", "foundational", "advanced_extension"] as const;
    for (const a of pack.concepts) {
      for (const d of getDescendants(pack, a.key, types)) {
        expect(getAncestors(pack, d.key, types).some((x) => x.key === a.key)).toBe(true);
      }
      expect(getAncestors(pack, a.key, types).some((x) => x.key === a.key)).toBe(false);
    }
  });

  it.each(SEEDS)("seed %i: the learning order is a valid topological order covering every concept once", (seed) => {
    const pack = randomDagPack(seed);
    const types = ["prerequisite", "foundational", "advanced_extension"] as const;
    const order = getLearningOrder(pack, types)!;
    expect(order).not.toBeNull();
    expect([...order].sort()).toEqual(pack.concepts.map((c) => c.key).sort());
    const position = new Map(order.map((k, i) => [k, i]));
    for (const r of pack.relations.filter((x) => types.includes(x.type as never))) {
      expect(position.get(r.from)!).toBeLessThan(position.get(r.to)!);
    }
  });
});

describe("property: injecting a back edge into an ordering relation is always rejected", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const pack = randomDagPack(seed);
    const ordering = pack.relations.filter((r) => r.type === "prerequisite");
    if (ordering.length === 0) return;
    const victim = ordering[Math.floor(rng(seed)() * ordering.length)]!;
    const withBackEdge: ExamPack = { ...pack, relations: [...pack.relations, relation(victim.to, victim.from, "prerequisite")] };
    const codes = validateExamPack(withBackEdge).issues.filter((i) => i.severity === "error").map((i) => i.code);
    expect(codes, `seed ${seed}`).toContain("forbidden_cycle");
  });
});

describe("property: findCycle", () => {
  it.each(SEEDS)("seed %i: agrees with a brute-force reachability check", (seed) => {
    const random = rng(seed + 1000);
    const n = 2 + Math.floor(random() * 6);
    const edges: Array<[string, string]> = [];
    for (let i = 0; i < n * 2; i++) edges.push([`n${Math.floor(random() * n)}`, `n${Math.floor(random() * n)}`]);
    const reach = (from: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [from];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const [a, b] of edges) if (a === cur && !seen.has(b)) { seen.add(b); stack.push(b); }
      }
      return seen;
    };
    const hasCycle = [...new Set(edges.flat())].some((node) => reach(node).has(node));
    const found = findCycle(edges);
    expect(found !== null).toBe(hasCycle);
    if (found) {
      expect(found[0]).toBe(found[found.length - 1]);
      for (let i = 0; i < found.length - 1; i++) expect(edges.some(([a, b]) => a === found[i] && b === found[i + 1])).toBe(true);
    }
  });
});
