import { normalizeConceptNameKey, type RelationType } from "@ipmat/concept-graph";
import type { ExamPack } from "@ipmat/exam-pack";
import { slugKey } from "@ipmat/exam-pack";
import type { QuestionPatternFamilyData } from "@ipmat/question-engine";
import type { Candidate, Chunk, SourceLocation, SourceRecord, SourceVersionRecord } from "./types.js";

/**
 * The knowledge graph (docs/DECISIONS.md D-085): the structure the pack, the
 * pattern families, the questions and the source evidence already imply,
 * made queryable - with DIRECTION and relationship SEMANTICS preserved. There
 * is no `relatedTo[]`: every edge has a fixed kind; concept-to-concept edges
 * carry one of the EIGHT established relation types; and every edge says what
 * it rests on (`basis`) and, for anything extracted, the evidence behind it.
 *
 * It is DERIVED on every call from authoritative structured data and never
 * stored, so it cannot drift. It is an INTERNAL structure (its evidence holds
 * source quotes): nothing student-facing may expose it.
 */

export type NodeKind = "exam" | "section" | "chapter" | "concept" | "pattern" | "question" | "source" | "source_version" | "chunk";

export const EDGE_KINDS = ["has_section", "has_chapter", "located_in", "concept_relation", "has_pattern", "instance_of", "about", "version_of", "derived_from", "mentions"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** Which node kinds an edge kind may connect, and in which direction. */
export const EDGE_RULES: Record<EdgeKind, { from: NodeKind[]; to: NodeKind[] }> = {
  has_section: { from: ["exam"], to: ["section"] },
  has_chapter: { from: ["section", "chapter"], to: ["chapter"] },
  located_in: { from: ["concept"], to: ["chapter"] },
  concept_relation: { from: ["concept"], to: ["concept"] },
  has_pattern: { from: ["concept"], to: ["pattern"] },
  instance_of: { from: ["question"], to: ["pattern"] },
  about: { from: ["question"], to: ["concept"] },
  version_of: { from: ["source_version"], to: ["source"] },
  derived_from: { from: ["chunk"], to: ["source_version"] },
  mentions: { from: ["chunk"], to: ["concept"] }
};

/**
 * What an edge rests on. `canonical` = the Exam Pack / structured data;
 * `accepted_candidate` = extracted AND accepted by a named reviewer;
 * `candidate` = extracted, NOT yet reviewed (only present when asked for).
 */
export type EdgeBasis = "canonical" | "accepted_candidate" | "candidate";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  examCode: string;
  key: string;
  label: string;
}

export interface GraphEvidence {
  chunkId: string;
  quote: string;
  charStart: number;
  charEnd: number;
  sourceKey: string;
  sourceTitle: string;
  sourceVersion: number;
  location: SourceLocation;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  relationType: RelationType | null;
  basis: EdgeBasis;
  evidence: GraphEvidence[];
  candidateId: string | null;
  /** For canonical concept relations: the pack's own provenance. For accepted candidates: who reviewed it. */
  provenance: { kind: string; sourceRef: string; reviewState: string; reviewedBy: string | null } | null;
}

export interface KnowledgeGraph {
  examCode: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphInput {
  pack: ExamPack;
  patternFamilies: readonly QuestionPatternFamilyData[];
  questions: ReadonlyArray<{ id: string; dna: { examCode: string; conceptName: string; patternFamilyName: string } }>;
  sources: readonly SourceRecord[];
  versions: readonly SourceVersionRecord[];
  chunks: readonly Chunk[];
  candidates: readonly Candidate[];
}

export interface GraphOptions {
  /** Also include extracted-but-UNREVIEWED claims (`basis: "candidate"`). Default false: only canonical and reviewed intelligence. */
  includeCandidates?: boolean;
  /** Also include fixture sources. Default false. */
  includeFixtures?: boolean;
}

const norm = normalizeConceptNameKey;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const nodeId = (kind: NodeKind, examCode: string, key: string): string => `${kind}:${examCode}:${key}`;
const edgeId = (kind: EdgeKind, from: string, to: string, relationType: RelationType | null, basis: EdgeBasis): string => `${kind}|${from}|${to}|${relationType ?? ""}|${basis}`;

export function buildKnowledgeGraph(input: GraphInput, options: GraphOptions = {}): KnowledgeGraph {
  const { pack } = input;
  const examCode = pack.examCode;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addNode = (kind: NodeKind, key: string, label: string): string => {
    const id = nodeId(kind, examCode, key);
    if (!nodes.has(id)) nodes.set(id, { id, kind, examCode, key, label });
    return id;
  };
  const addEdge = (e: Omit<GraphEdge, "id" | "evidence" | "candidateId" | "provenance"> & Partial<Pick<GraphEdge, "evidence" | "candidateId" | "provenance">>): void => {
    const id = edgeId(e.kind, e.from, e.to, e.relationType, e.basis);
    const existing = edges.get(id);
    if (existing) {
      existing.evidence = [...existing.evidence, ...(e.evidence ?? [])];
      return;
    }
    edges.set(id, { id, evidence: [], candidateId: null, provenance: null, ...e });
  };

  // --- exam structure (canonical)
  const examNode = addNode("exam", examCode, pack.name);
  for (const s of pack.sections) addEdge({ kind: "has_section", from: examNode, to: addNode("section", s.key, s.name), relationType: null, basis: "canonical" });
  for (const n of pack.syllabus) {
    const node = addNode("chapter", n.key, n.name);
    addEdge({ kind: "has_chapter", from: n.parentKey ? nodeId("chapter", examCode, n.parentKey) : nodeId("section", examCode, n.sectionKey), to: node, relationType: null, basis: "canonical" });
  }
  // --- concepts and canonical relations
  const conceptKeyByName = new Map(pack.concepts.map((c) => [norm(c.name), c.key]));
  for (const c of pack.concepts) {
    const id = addNode("concept", c.key, c.name);
    addEdge({ kind: "located_in", from: id, to: nodeId("chapter", examCode, c.syllabusNodeKey), relationType: null, basis: "canonical" });
  }
  for (const r of pack.relations) {
    addEdge({
      kind: "concept_relation",
      from: nodeId("concept", examCode, r.from),
      to: nodeId("concept", examCode, r.to),
      relationType: r.type,
      basis: "canonical",
      provenance: { kind: r.provenance.kind, sourceRef: r.provenance.sourceRef, reviewState: r.provenance.reviewState, reviewedBy: r.provenance.reviewedBy }
    });
  }
  // --- patterns and question instances
  const patternKey = (conceptKey: string, family: string): string => `${conceptKey}/${slugKey(family)}`;
  for (const f of input.patternFamilies) {
    const conceptKey = conceptKeyByName.get(norm(f.conceptName));
    if (!conceptKey) continue;
    addEdge({ kind: "has_pattern", from: nodeId("concept", examCode, conceptKey), to: addNode("pattern", patternKey(conceptKey, f.name), f.name), relationType: null, basis: "canonical" });
  }
  for (const q of input.questions) {
    if (q.dna.examCode !== examCode) continue; // cross-exam isolation: another exam's question can never become a node here
    const conceptKey = conceptKeyByName.get(norm(q.dna.conceptName));
    if (!conceptKey) continue;
    const qn = addNode("question", q.id, q.id);
    const pk = patternKey(conceptKey, q.dna.patternFamilyName);
    if (nodes.has(nodeId("pattern", examCode, pk))) addEdge({ kind: "instance_of", from: qn, to: nodeId("pattern", examCode, pk), relationType: null, basis: "canonical" });
    addEdge({ kind: "about", from: qn, to: nodeId("concept", examCode, conceptKey), relationType: null, basis: "canonical" });
  }
  // --- sources, versions, chunks
  const sources = input.sources.filter((s) => s.examCode === examCode && (options.includeFixtures || s.dataOrigin === "real_source"));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const versionById = new Map(input.versions.filter((v) => sourceById.has(v.sourceId)).map((v) => [v.id, v]));
  const chunkById = new Map(input.chunks.filter((c) => versionById.has(c.sourceVersionId) && c.validationState !== "rejected").map((c) => [c.id, c]));
  for (const s of sources) addNode("source", s.sourceKey, s.title);
  for (const v of versionById.values()) {
    const s = sourceById.get(v.sourceId)!;
    addEdge({ kind: "version_of", from: addNode("source_version", v.id, `${s.sourceKey} v${v.version}`), to: nodeId("source", examCode, s.sourceKey), relationType: null, basis: "canonical" });
  }
  for (const c of chunkById.values()) addEdge({ kind: "derived_from", from: addNode("chunk", c.id, `chunk ${c.ordinal}`), to: nodeId("source_version", examCode, c.sourceVersionId), relationType: null, basis: "canonical" });

  const evidenceOf = (cand: Candidate): GraphEvidence[] =>
    cand.evidence.flatMap((e) => {
      const chunk = chunkById.get(e.chunkId);
      const version = chunk ? versionById.get(chunk.sourceVersionId) : undefined;
      const source = version ? sourceById.get(version.sourceId) : undefined;
      return chunk && version && source ? [{ chunkId: e.chunkId, quote: e.quote, charStart: e.charStart, charEnd: e.charEnd, sourceKey: source.sourceKey, sourceTitle: source.title, sourceVersion: version.version, location: chunk.location }] : [];
    });

  // --- extracted intelligence: reviewed by default, unreviewed only on request, rejected never
  for (const cand of input.candidates) {
    if (cand.examCode !== examCode || cand.state === "rejected" || cand.kind === "question") continue;
    if (cand.state === "candidate" && !options.includeCandidates) continue;
    const basis: EdgeBasis = cand.state === "accepted" ? "accepted_candidate" : "candidate";
    const evidence = evidenceOf(cand);
    if (evidence.length === 0) continue; // evidence that no longer resolves cannot support an edge
    const provenance = { kind: cand.proposer.kind, sourceRef: `source-version:${cand.sourceVersionId}`, reviewState: cand.state === "accepted" ? "reviewed" : "unvalidated", reviewedBy: cand.review?.reviewedBy ?? null };
    if (cand.kind === "concept_mention") {
      if (cand.conceptKey === null) continue; // a proposal for a concept outside the pack is never a graph edge
      addEdge({ kind: "mentions", from: nodeId("chunk", examCode, cand.evidence[0]!.chunkId), to: nodeId("concept", examCode, cand.conceptKey), relationType: null, basis, evidence, candidateId: cand.id, provenance });
    } else {
      addEdge({ kind: "concept_relation", from: nodeId("concept", examCode, cand.fromConceptKey), to: nodeId("concept", examCode, cand.toConceptKey), relationType: cand.relationType, basis, evidence, candidateId: cand.id, provenance });
    }
  }

  return { examCode, nodes: [...nodes.values()].sort((a, b) => cmp(a.id, b.id)), edges: [...edges.values()].sort((a, b) => cmp(a.id, b.id)) };
}

export interface GraphIssue {
  code: "duplicate_node" | "duplicate_edge" | "dangling_edge" | "cross_exam_edge" | "invalid_edge_endpoints" | "invalid_relation_type" | "missing_evidence" | "unexpected_evidence";
  subject: string;
  message: string;
}

const RELATION_TYPES: readonly string[] = ["prerequisite", "foundational", "directly_related", "commonly_combined", "application", "dependent", "advanced_extension", "related_but_distinct"];

/** Structural consistency of a graph (hand-built or derived). Reports; never throws. */
export function validateGraph(graph: KnowledgeGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) issues.push({ code: "duplicate_node", subject: n.id, message: "duplicate node id" });
    byId.set(n.id, n);
    if (n.examCode !== graph.examCode) issues.push({ code: "cross_exam_edge", subject: n.id, message: `node belongs to "${n.examCode}", not "${graph.examCode}"` });
  }
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (seen.has(e.id)) issues.push({ code: "duplicate_edge", subject: e.id, message: "duplicate edge id" });
    seen.add(e.id);
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) { issues.push({ code: "dangling_edge", subject: e.id, message: "an endpoint is not a node of this graph" }); continue; }
    if (from.examCode !== to.examCode) issues.push({ code: "cross_exam_edge", subject: e.id, message: "an edge may not connect two different exams" });
    const rule = EDGE_RULES[e.kind];
    if (!rule || !rule.from.includes(from.kind) || !rule.to.includes(to.kind)) issues.push({ code: "invalid_edge_endpoints", subject: e.id, message: `${e.kind} cannot connect ${from.kind} -> ${to.kind}` });
    if (e.kind === "concept_relation" ? e.relationType === null || !RELATION_TYPES.includes(e.relationType) : e.relationType !== null) issues.push({ code: "invalid_relation_type", subject: e.id, message: e.kind === "concept_relation" ? "a concept relation must carry one of the eight established relation types" : "only concept relations carry a relation type" });
    if (e.basis !== "canonical" && e.evidence.length === 0) issues.push({ code: "missing_evidence", subject: e.id, message: "an extracted edge must carry evidence" });
    if (e.basis === "canonical" && e.evidence.length > 0 && e.kind !== "concept_relation") issues.push({ code: "unexpected_evidence", subject: e.id, message: "a structural edge carries no extracted evidence" });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Queries (pure, deterministic, sorted)
// ---------------------------------------------------------------------------

const conceptNode = (graph: KnowledgeGraph, key: string): string => nodeId("concept", graph.examCode, key);

export interface RelationExplanation {
  from: string;
  to: string;
  relationType: RelationType;
  basis: EdgeBasis;
  provenance: GraphEdge["provenance"];
  evidence: GraphEvidence[];
}

/**
 * "Why does the system believe A and B are related?" - every concept relation
 * between them, in either direction, with what it rests on: the pack's own
 * provenance for a canonical relation, or the source, version, location and
 * verbatim quote (plus the reviewer) for an extracted one. Never "the AI said so".
 */
export function whyRelated(graph: KnowledgeGraph, conceptKeyA: string, conceptKeyB: string): RelationExplanation[] {
  const a = conceptNode(graph, conceptKeyA);
  const b = conceptNode(graph, conceptKeyB);
  const order: Record<EdgeBasis, number> = { canonical: 0, accepted_candidate: 1, candidate: 2 };
  return graph.edges
    .filter((e) => e.kind === "concept_relation" && ((e.from === a && e.to === b) || (e.from === b && e.to === a)))
    .map((e) => ({ from: graph.nodes.find((n) => n.id === e.from)!.key, to: graph.nodes.find((n) => n.id === e.to)!.key, relationType: e.relationType as RelationType, basis: e.basis, provenance: e.provenance, evidence: e.evidence }))
    .sort((x, y) => order[x.basis] - order[y.basis] || cmp(x.relationType, y.relationType) || cmp(`${x.from}>${x.to}`, `${y.from}>${y.to}`));
}

export function neighbors(graph: KnowledgeGraph, id: string, kinds?: readonly EdgeKind[]): Array<{ edge: GraphEdge; direction: "out" | "in"; other: string }> {
  return graph.edges
    .filter((e) => (e.from === id || e.to === id) && (!kinds || kinds.includes(e.kind)))
    .map((e) => ({ edge: e, direction: (e.from === id ? "out" : "in") as "out" | "in", other: e.from === id ? e.to : e.from }))
    .sort((x, y) => cmp(x.edge.id, y.edge.id));
}

/** Chunks that (reviewed) mention a concept, with the quotes - "retrieve source evidence for a concept". */
export function evidenceForConcept(graph: KnowledgeGraph, conceptKey: string): GraphEvidence[] {
  const target = conceptNode(graph, conceptKey);
  return graph.edges
    .filter((e) => e.kind === "mentions" && e.to === target)
    .flatMap((e) => e.evidence)
    .sort((x, y) => cmp(`${x.sourceKey}|${String(x.sourceVersion).padStart(6, "0")}|${String(x.location.charStart).padStart(9, "0")}`, `${y.sourceKey}|${String(y.sourceVersion).padStart(6, "0")}|${String(y.location.charStart).padStart(9, "0")}`));
}

export function patternsForConcept(graph: KnowledgeGraph, conceptKey: string): string[] {
  return neighbors(graph, conceptNode(graph, conceptKey), ["has_pattern"]).filter((n) => n.direction === "out").map((n) => graph.nodes.find((x) => x.id === n.other)!.label).sort(cmp);
}

export function questionsForPattern(graph: KnowledgeGraph, patternNodeKey: string): string[] {
  return neighbors(graph, nodeId("pattern", graph.examCode, patternNodeKey), ["instance_of"]).filter((n) => n.direction === "in").map((n) => graph.nodes.find((x) => x.id === n.other)!.key).sort(cmp);
}

/** The sources (key + version) that evidence a concept. */
export function sourcesForConcept(graph: KnowledgeGraph, conceptKey: string): Array<{ sourceKey: string; sourceVersion: number }> {
  const seen = new Map<string, { sourceKey: string; sourceVersion: number }>();
  for (const e of evidenceForConcept(graph, conceptKey)) seen.set(`${e.sourceKey}@${e.sourceVersion}`, { sourceKey: e.sourceKey, sourceVersion: e.sourceVersion });
  return [...seen.values()].sort((a, b) => cmp(a.sourceKey, b.sourceKey) || a.sourceVersion - b.sourceVersion);
}
