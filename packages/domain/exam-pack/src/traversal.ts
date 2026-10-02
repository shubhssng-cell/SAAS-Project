import type { RelationType } from "@ipmat/concept-graph";
import { DEFAULT_ANCESTRY_TYPES, RELATION_TYPE_SEMANTICS } from "./semantics.js";
import type { ExamPack, PackConcept, PackRelation, PackSection, SyllabusNode } from "./types.js";

/**
 * Deterministic read-only queries over a pack. Every result is sorted by an
 * explicit rule (never by input order or hash order), every traversal tracks
 * visited nodes so it terminates even on a graph whose non-ordering
 * relations are cyclic, and an unknown key is a typed error rather than an
 * empty result (an empty answer must mean "none", not "you typo'd").
 */

export class ExamPackQueryError extends Error {
  constructor(readonly code: "unknown_concept" | "unknown_syllabus_node" | "unknown_section", message: string) {
    super(message);
    this.name = "ExamPackQueryError";
  }
}

export interface ConceptDistance {
  key: string;
  /** Number of relation hops from the start concept (>= 1). */
  distance: number;
}

const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function getConcept(pack: ExamPack, key: string): PackConcept {
  const found = pack.concepts.find((c) => c.key === key);
  if (!found) throw new ExamPackQueryError("unknown_concept", `unknown concept "${key}"`);
  return found;
}

export function getSectionsInOrder(pack: ExamPack): PackSection[] {
  return [...pack.sections].sort((a, b) => a.order - b.order || byKey(a, b));
}

export function getChildNodes(pack: ExamPack, sectionKey: string, parentKey: string | null): SyllabusNode[] {
  return pack.syllabus
    .filter((n) => n.sectionKey === sectionKey && n.parentKey === parentKey)
    .sort((a, b) => a.order - b.order || byKey(a, b));
}

export function getConceptsAtNode(pack: ExamPack, nodeKey: string): PackConcept[] {
  return pack.concepts.filter((c) => c.syllabusNodeKey === nodeKey).sort((a, b) => a.name.localeCompare(b.name) || byKey(a, b));
}

/** Root-first path of syllabus nodes from the section's top level down to (and including) the node. */
export function getSyllabusPath(pack: ExamPack, nodeKey: string): SyllabusNode[] {
  const byNodeKey = new Map(pack.syllabus.map((n) => [n.key, n]));
  const path: SyllabusNode[] = [];
  const seen = new Set<string>();
  let current = byNodeKey.get(nodeKey);
  if (!current) throw new ExamPackQueryError("unknown_syllabus_node", `unknown syllabus node "${nodeKey}"`);
  while (current && !seen.has(current.key)) {
    seen.add(current.key);
    path.unshift(current);
    current = current.parentKey === null ? undefined : byNodeKey.get(current.parentKey);
  }
  return path;
}

export interface SyllabusTreeNode {
  node: SyllabusNode;
  concepts: PackConcept[];
  children: SyllabusTreeNode[];
}
export interface SyllabusTreeSection {
  section: PackSection;
  nodes: SyllabusTreeNode[];
}

/** The full hierarchy, sections and siblings in their declared order, concepts attached to their node. */
export function getSyllabusTree(pack: ExamPack): SyllabusTreeSection[] {
  const build = (sectionKey: string, parentKey: string | null, visited: Set<string>): SyllabusTreeNode[] =>
    getChildNodes(pack, sectionKey, parentKey)
      .filter((n) => !visited.has(n.key))
      .map((node) => ({
        node,
        concepts: getConceptsAtNode(pack, node.key),
        children: build(sectionKey, node.key, new Set([...visited, node.key]))
      }));
  return getSectionsInOrder(pack).map((section) => ({ section, nodes: build(section.key, null, new Set()) }));
}

function relationsOfTypes(pack: ExamPack, types: readonly RelationType[]): PackRelation[] {
  return pack.relations.filter((r) => types.includes(r.type));
}

function bfs(start: string, neighbors: (key: string) => string[]): ConceptDistance[] {
  const distances = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const neighbor of neighbors(key)) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, distances.get(key)! + 1);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  distances.delete(start);
  return [...distances.entries()].map(([key, distance]) => ({ key, distance })).sort((a, b) => a.distance - b.distance || byKey(a, b));
}

/** Concepts with a DIRECT edge of one of `types` INTO this concept (default: prerequisite). Sorted by key. */
export function getDirectPrerequisites(pack: ExamPack, key: string, types: readonly RelationType[] = DEFAULT_ANCESTRY_TYPES): string[] {
  getConcept(pack, key);
  return [...new Set(relationsOfTypes(pack, types).filter((r) => r.to === key).map((r) => r.from))].sort();
}

/** Concepts this one DIRECTLY unlocks: the inverse of `getDirectPrerequisites`. Sorted by key. */
export function getUnlockedConcepts(pack: ExamPack, key: string, types: readonly RelationType[] = DEFAULT_ANCESTRY_TYPES): string[] {
  getConcept(pack, key);
  return [...new Set(relationsOfTypes(pack, types).filter((r) => r.from === key).map((r) => r.to))].sort();
}

/** Transitive prerequisites (ancestors), nearest first then by key. Excludes the concept itself. */
export function getAncestors(pack: ExamPack, key: string, types: readonly RelationType[] = DEFAULT_ANCESTRY_TYPES): ConceptDistance[] {
  getConcept(pack, key);
  const edges = relationsOfTypes(pack, types);
  return bfs(key, (k) => edges.filter((r) => r.to === k).map((r) => r.from).sort());
}

/** Transitive unlocks (descendants), nearest first then by key. Excludes the concept itself. */
export function getDescendants(pack: ExamPack, key: string, types: readonly RelationType[] = DEFAULT_ANCESTRY_TYPES): ConceptDistance[] {
  getConcept(pack, key);
  const edges = relationsOfTypes(pack, types);
  return bfs(key, (k) => edges.filter((r) => r.from === k).map((r) => r.to).sort());
}

/**
 * All relations touching a concept, optionally filtered by type, ordered by
 * (type, from, to). Symmetric types are reported once, as stored.
 */
export function getRelationsFor(pack: ExamPack, key: string, types?: readonly RelationType[]): PackRelation[] {
  getConcept(pack, key);
  return pack.relations
    .filter((r) => (r.from === key || r.to === key) && (!types || types.includes(r.type)))
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

/**
 * The OTHER end of every relation touching the concept, with symmetric
 * relations followed in both directions and directional ones as stored
 * (outgoing and incoming both reported, tagged with their direction).
 */
export function getNeighbors(
  pack: ExamPack,
  key: string,
  types?: readonly RelationType[]
): Array<{ key: string; type: RelationType; direction: "outgoing" | "incoming" | "symmetric" }> {
  return getRelationsFor(pack, key, types)
    .map((r) => ({
      key: r.from === key ? r.to : r.from,
      type: r.type,
      direction: RELATION_TYPE_SEMANTICS[r.type].symmetric ? ("symmetric" as const) : r.from === key ? ("outgoing" as const) : ("incoming" as const)
    }))
    .sort((a, b) => byKey(a, b) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/**
 * A deterministic learning order over the given ordering types: Kahn's
 * algorithm with a key-sorted ready set, so equal inputs always give the
 * same order and every concept appears after all of its sources. Returns
 * `null` if the chosen edges are cyclic (a validated pack never is).
 */
export function getLearningOrder(pack: ExamPack, types: readonly RelationType[] = DEFAULT_ANCESTRY_TYPES): string[] | null {
  const edges = relationsOfTypes(pack, types);
  const indegree = new Map(pack.concepts.map((c) => [c.key, 0]));
  for (const r of edges) indegree.set(r.to, (indegree.get(r.to) ?? 0) + 1);
  const ready = [...indegree.entries()].filter(([, n]) => n === 0).map(([k]) => k).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift() as string;
    order.push(key);
    for (const r of edges.filter((e) => e.from === key)) {
      const remaining = (indegree.get(r.to) ?? 0) - 1;
      indegree.set(r.to, remaining);
      if (remaining === 0) {
        ready.push(r.to);
        ready.sort();
      }
    }
  }
  return order.length === pack.concepts.length ? order : null;
}
