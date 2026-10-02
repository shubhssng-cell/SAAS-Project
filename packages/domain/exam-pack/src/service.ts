import type { RelationType } from "@ipmat/concept-graph";
import {
  getAncestors,
  getConcept,
  getDescendants,
  getDirectPrerequisites,
  getLearningOrder,
  getNeighbors,
  getRelationsFor,
  getSectionsInOrder,
  getSyllabusPath,
  getSyllabusTree,
  getUnlockedConcepts,
  type ConceptDistance,
  type SyllabusTreeNode,
  type SyllabusTreeSection
} from "./traversal.js";
import { validateExamPack } from "./validate.js";
import type { ExamPack, ExamPackIssue, ExamPackValidationResult, PackConcept, PackRelation, PackSection } from "./types.js";

/** Persistence boundary. The domain never knows how a pack is stored or assembled. */
export interface ExamPackRepository {
  findByExamCode(examCode: string): Promise<ExamPack | null>;
}

/** A pack held in memory (a pack defined as data in code); also the test double. */
export class InMemoryExamPackRepository implements ExamPackRepository {
  private readonly byCode = new Map<string, ExamPack>();

  constructor(packs: readonly ExamPack[] = []) {
    for (const pack of packs) this.byCode.set(pack.examCode, pack);
  }

  async findByExamCode(examCode: string): Promise<ExamPack | null> {
    return this.byCode.get(examCode) ?? null;
  }
}

export class ExamPackNotFoundError extends Error {
  constructor(readonly examCode: string) {
    super(`no exam pack for exam code "${examCode}"`);
    this.name = "ExamPackNotFoundError";
  }
}

/** Fail-closed: a pack with validation errors is never queried as if it were sound. */
export class ExamPackInvalidError extends Error {
  constructor(readonly examCode: string, readonly issues: ExamPackIssue[]) {
    super(`exam pack "${examCode}" failed validation with ${issues.length} error(s)`);
    this.name = "ExamPackInvalidError";
  }
}

export interface ProvenanceSummary {
  /** Counts of artifacts by provenance kind and by review state; `total` is every provenance-bearing artifact. */
  total: number;
  byKind: Record<"canonical" | "authored" | "imported" | "inferred", number>;
  byReviewState: Record<"unvalidated" | "reviewed", number>;
}

/**
 * Admin/maintainer view of how much of a pack has actually been reviewed.
 * Derived on every call, never stored. A pack where nothing is reviewed is
 * reported as exactly that - never rounded up to "validated".
 */
export function summarizePackValidationState(pack: ExamPack): ProvenanceSummary {
  const all = [
    pack.provenance,
    ...pack.sections.map((x) => x.provenance),
    ...pack.syllabus.map((x) => x.provenance),
    ...pack.concepts.map((x) => x.provenance),
    ...pack.relations.map((x) => x.provenance),
    ...pack.terminology.map((x) => x.provenance)
  ];
  const summary: ProvenanceSummary = {
    total: all.length,
    byKind: { canonical: 0, authored: 0, imported: 0, inferred: 0 },
    byReviewState: { unvalidated: 0, reviewed: 0 }
  };
  for (const p of all) {
    summary.byKind[p.kind] += 1;
    summary.byReviewState[p.reviewState] += 1;
  }
  return summary;
}

/** Student-safe projections: no provenance, review state, status, notes, certainty/source or ids. */
export interface PublicConceptView {
  name: string;
  description: string;
}
export interface PublicSyllabusNodeView {
  name: string;
  order: number;
  concepts: PublicConceptView[];
  children: PublicSyllabusNodeView[];
}
export interface PublicExamPackView {
  examName: string;
  sections: Array<{ name: string; order: number; syllabus: PublicSyllabusNodeView[] }>;
  /** Relationship type and the two concept NAMES only - no rationale internals, certainty or provenance. */
  relations: Array<{ from: string; to: string; type: RelationType }>;
}

export function toPublicExamPackView(pack: ExamPack): PublicExamPackView {
  const nameOf = new Map(pack.concepts.map((c) => [c.key, c.name]));
  const node = (n: SyllabusTreeNode): PublicSyllabusNodeView => ({
    name: n.node.name,
    order: n.node.order,
    concepts: n.concepts.map((c) => ({ name: c.name, description: c.description })),
    children: n.children.map(node)
  });
  return {
    examName: pack.name,
    sections: getSyllabusTree(pack).map((s) => ({ name: s.section.name, order: s.section.order, syllabus: s.nodes.map(node) })),
    relations: pack.relations
      .map((r) => ({ from: nameOf.get(r.from) ?? r.from, to: nameOf.get(r.to) ?? r.to, type: r.type }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type))
  };
}

/**
 * Application layer over the repository: loads a pack, validates it
 * (memoized per loaded object), and answers deterministic questions about
 * the exam's knowledge space. Holds no student state and writes nothing.
 */
export class ExamPackService {
  private readonly validated = new WeakMap<ExamPack, ExamPackValidationResult>();

  constructor(private readonly repository: ExamPackRepository) {}

  private async load(examCode: string): Promise<ExamPack> {
    const pack = await this.repository.findByExamCode(examCode);
    if (!pack) throw new ExamPackNotFoundError(examCode);
    const result = this.validate(pack);
    if (!result.valid) throw new ExamPackInvalidError(examCode, result.issues.filter((i) => i.severity === "error"));
    return pack;
  }

  private validate(pack: ExamPack): ExamPackValidationResult {
    let result = this.validated.get(pack);
    if (!result) {
      result = validateExamPack(pack);
      this.validated.set(pack, result);
    }
    return result;
  }

  /** Validation report WITHOUT the fail-closed throw - for maintainers who need to see the issues. */
  async validationReport(examCode: string): Promise<ExamPackValidationResult> {
    const pack = await this.repository.findByExamCode(examCode);
    if (!pack) throw new ExamPackNotFoundError(examCode);
    return this.validate(pack);
  }

  async getPack(examCode: string): Promise<ExamPack> {
    return this.load(examCode);
  }

  async getProvenanceSummary(examCode: string): Promise<ProvenanceSummary> {
    return summarizePackValidationState(await this.load(examCode));
  }

  async getPublicView(examCode: string): Promise<PublicExamPackView> {
    return toPublicExamPackView(await this.load(examCode));
  }

  async listSections(examCode: string): Promise<PackSection[]> {
    return getSectionsInOrder(await this.load(examCode));
  }

  async getSyllabus(examCode: string): Promise<SyllabusTreeSection[]> {
    return getSyllabusTree(await this.load(examCode));
  }

  async getSyllabusPathOfConcept(examCode: string, conceptKey: string) {
    const pack = await this.load(examCode);
    return getSyllabusPath(pack, getConcept(pack, conceptKey).syllabusNodeKey);
  }

  async listConcepts(examCode: string): Promise<PackConcept[]> {
    const pack = await this.load(examCode);
    return [...pack.concepts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async getConcept(examCode: string, conceptKey: string): Promise<PackConcept> {
    return getConcept(await this.load(examCode), conceptKey);
  }

  async getPrerequisites(examCode: string, conceptKey: string, types?: readonly RelationType[]): Promise<string[]> {
    return getDirectPrerequisites(await this.load(examCode), conceptKey, types);
  }

  async getUnlocks(examCode: string, conceptKey: string, types?: readonly RelationType[]): Promise<string[]> {
    return getUnlockedConcepts(await this.load(examCode), conceptKey, types);
  }

  async getAncestors(examCode: string, conceptKey: string, types?: readonly RelationType[]): Promise<ConceptDistance[]> {
    return getAncestors(await this.load(examCode), conceptKey, types);
  }

  async getDescendants(examCode: string, conceptKey: string, types?: readonly RelationType[]): Promise<ConceptDistance[]> {
    return getDescendants(await this.load(examCode), conceptKey, types);
  }

  async getRelations(examCode: string, conceptKey: string, types?: readonly RelationType[]): Promise<PackRelation[]> {
    return getRelationsFor(await this.load(examCode), conceptKey, types);
  }

  async getNeighbors(examCode: string, conceptKey: string, types?: readonly RelationType[]) {
    return getNeighbors(await this.load(examCode), conceptKey, types);
  }

  async getLearningOrder(examCode: string, types?: readonly RelationType[]): Promise<string[]> {
    const order = getLearningOrder(await this.load(examCode), types);
    if (!order) throw new ExamPackInvalidError(examCode, []);
    return order;
  }
}
