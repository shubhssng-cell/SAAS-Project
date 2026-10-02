import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import { getAncestors, getChildNodes, getDirectPrerequisites, getRelationsFor, getSectionsInOrder, getSyllabusPath, type ConceptDistance, type PackRelation } from "@ipmat/exam-pack";
import { selectClassified, validateDnaClassification, type HistoricalQuestionRecord } from "@ipmat/examiner-intelligence";
import type { QuestionInstanceDna } from "@ipmat/content-authoring";
import type { RelationType } from "@ipmat/concept-graph";
import { computeFacetMetric, FACET_DEFINITIONS, projectDna, type CoverageMetric, type FacetDefinition, type FacetItem, type FacetName } from "./coverage.js";
import { assessQuestions, qualifiedQuestions, type AssessmentOptions, type QuestionAssessment } from "./quality.js";
import { ExamIntelligenceError, type ContentBasis, type ExamIntelligenceSnapshot } from "./types.js";

/**
 * The EXAM INTELLIGENCE query contract (docs/DECISIONS.md D-086): the one place
 * downstream systems ask about the exam space. Deterministic, sorted, and
 * scoped to ONE exam at ONE pack version. It answers from the exam model, the
 * content model and reviewed historical evidence - it never reads a student,
 * never infers mastery or any mental state, and never says anything about what
 * a future paper will contain. Historical occurrence is reported as occurrence
 * only. These queries are INTERNAL (they can expose source references); the
 * student-facing surfaces must never expose them.
 */

const norm = normalizeConceptNameKey;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface SectionView {
  key: string;
  name: string;
  order: number;
  chapters: Array<{ key: string; name: string; order: number }>;
}
export interface ConceptView {
  key: string;
  name: string;
  chapterName: string | null;
  sectionName: string | null;
}
export interface RelationshipView {
  from: string;
  to: string;
  type: RelationType;
  /** The pack's own provenance kind and review state - a relation is only as strong as its review. */
  provenanceKind: string;
  reviewState: string;
}
export interface HistoricalEvidenceView {
  recordId: string;
  patternFamilyName: string;
  combinesWith: string[];
  testingModes: string[];
  noveltyLevel: string;
  /** Where the evidence comes from - the audit trail. Internal. */
  sourceType: string;
  sourceRef: string;
  locator: HistoricalQuestionRecord["locator"];
  reviewedBy: string | null;
}
export interface Availability {
  conceptName: string | null;
  available: number;
  validated: number;
  published: number;
}

export class ExamIntelligenceQueries {
  private readonly assessments: QuestionAssessment[];

  constructor(private readonly s: ExamIntelligenceSnapshot, private readonly options: AssessmentOptions = {}) {
    this.assessments = assessQuestions(s, options);
  }

  get examCode(): string {
    return this.s.examCode;
  }

  // ---- exam model --------------------------------------------------------

  sections(): SectionView[] {
    return getSectionsInOrder(this.s.pack).map((section) => ({
      key: section.key,
      name: section.name,
      order: section.order,
      chapters: getChildNodes(this.s.pack, section.key, null).map((n) => ({ key: n.key, name: n.name, order: n.order }))
    }));
  }

  concepts(): ConceptView[] {
    return [...this.s.pack.concepts]
      .sort((a, b) => cmp(a.key, b.key))
      .map((c) => {
        const path = getSyllabusPath(this.s.pack, c.syllabusNodeKey);
        const section = this.s.pack.sections.find((x) => x.key === path[0]?.sectionKey);
        return { key: c.key, name: c.name, chapterName: path[0]?.name ?? null, sectionName: section?.name ?? null };
      });
  }

  private conceptKey(conceptName: string): string {
    const c = this.s.pack.concepts.find((x) => norm(x.name) === norm(conceptName) || x.key === conceptName);
    if (!c) throw new ExamIntelligenceError("unknown_concept", `"${conceptName}" is not a concept of ${this.s.examCode}`);
    return c.key;
  }
  private canonicalName(conceptName: string): string {
    return this.s.pack.concepts.find((c) => c.key === this.conceptKey(conceptName))!.name;
  }

  /** Direct prerequisites (strict `prerequisite` edges), or the transitive closure with hop distances. */
  prerequisites(conceptName: string, opts: { transitive?: boolean } = {}): string[] | ConceptDistance[] {
    const key = this.conceptKey(conceptName);
    return opts.transitive ? getAncestors(this.s.pack, key) : getDirectPrerequisites(this.s.pack, key);
  }

  relationships(conceptName: string): RelationshipView[] {
    return getRelationsFor(this.s.pack, this.conceptKey(conceptName)).map((r: PackRelation) => ({ from: r.from, to: r.to, type: r.type, provenanceKind: r.provenance.kind, reviewState: r.provenance.reviewState }));
  }

  // ---- facets (content tiers + historical) -------------------------------

  private scopedDefinition(facet: FacetName, conceptName: string): FacetDefinition {
    const def = FACET_DEFINITIONS[facet];
    const canonical = this.canonicalName(conceptName);
    const families = this.s.patternFamilies.filter((f) => norm(f.conceptName) === norm(canonical));
    const universe: FacetDefinition["universe"] = (snap) => {
      const full = def.universe(snap);
      switch (facet) {
        case "concept": return [canonical];
        case "pattern": return full.filter((m) => m.startsWith(`${canonical} / `));
        case "combination": return full.filter((m) => m.split(" + ").some((n) => norm(n) === norm(canonical)));
        case "transformation": return [...new Set(families.flatMap((f) => f.potentialTestingModes))].filter((m) => full.includes(m)).sort(cmp);
        case "trap": return [...new Set(families.flatMap((f) => f.potentialTrapErrorTaxonomyCodes))].sort(cmp);
        default: return full;
      }
    };
    return { ...def, definition: { ...def.definition, universe: `${def.definition.universe} - scoped to concept "${canonical}"` }, universe };
  }

  private contentItems(conceptName: string, basis: ContentBasis): FacetItem[] {
    const canonical = this.canonicalName(conceptName);
    return qualifiedQuestions(this.s, this.assessments, basis).filter((q) => q.conceptName === canonical).map((q) => projectDna(q.view.id, q.view.dna, q.conceptName));
  }

  private historicalItems(conceptName: string): FacetItem[] {
    const canonical = this.canonicalName(conceptName);
    const out: FacetItem[] = [];
    for (const r of selectClassified(this.s.historicalRecords.filter((x) => x.examCode === this.s.examCode), { examCode: this.s.examCode })) {
      const dna = r.classification;
      if (norm(dna.conceptName) !== norm(canonical)) continue;
      if (validateDnaClassification(dna, { pack: this.s.pack, patternFamilies: this.s.patternFamilies, errorTaxonomyCodes: this.s.errorTaxonomyCodes }).length > 0) continue;
      out.push(projectDna(r.id, { ...(dna as unknown as QuestionInstanceDna), examRelevance: "core" }, canonical));
    }
    return out;
  }

  /** One facet of one concept over CONTENT at the given tier (default: published). */
  contentFacet(conceptName: string, facet: FacetName, basis: ContentBasis = "published"): CoverageMetric {
    return computeFacetMetric(this.scopedDefinition(facet, conceptName), this.contentItems(conceptName, basis), `${basis}_content`, this.s);
  }

  /** One facet of one concept over reviewed, real-source HISTORICAL evidence - occurrence only. `insufficient_data` when there is none. */
  historicalFacet(conceptName: string, facet: FacetName): CoverageMetric {
    return computeFacetMetric(this.scopedDefinition(facet, conceptName), this.historicalItems(conceptName), "historical_observed", this.s);
  }

  patterns(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "pattern", basis); }
  combinations(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "combination", basis); }
  transformations(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "transformation", basis); }
  difficultyTiers(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "difficulty_tier", basis); }
  difficultyDimensions(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "difficulty_dimension", basis); }
  novelty(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "novelty", basis); }
  traps(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "trap", basis); }
  timeDemand(conceptName: string, basis: ContentBasis = "published"): CoverageMetric { return this.contentFacet(conceptName, "time_demand", basis); }

  /** Reviewed, real-source historical records of a concept with their sources. Empty (not invented) when none exist. */
  historicalEvidence(conceptName: string): HistoricalEvidenceView[] {
    const canonical = this.canonicalName(conceptName);
    return selectClassified(this.s.historicalRecords.filter((x) => x.examCode === this.s.examCode), { examCode: this.s.examCode })
      .filter((r) => norm(r.classification.conceptName) === norm(canonical))
      .map((r) => ({
        recordId: r.id,
        patternFamilyName: r.classification.patternFamilyName,
        combinesWith: [...r.classification.combinesWithConcepts].sort(cmp),
        testingModes: [...r.classification.testingModes].sort(cmp),
        noveltyLevel: r.classification.noveltyLevel,
        sourceType: r.source.sourceType,
        sourceRef: r.source.sourceRef,
        locator: r.locator,
        reviewedBy: r.review?.reviewedBy ?? null
      }))
      .sort((a, b) => cmp(a.recordId, b.recordId));
  }

  // ---- availability and constraints --------------------------------------

  /** Validated question availability. Counts only QUALIFYING questions (right exam, valid metadata, not duplicate/fixture/rejected). */
  availability(conceptName?: string): Availability {
    const canonical = conceptName === undefined ? null : this.canonicalName(conceptName);
    const count = (basis: ContentBasis): number => qualifiedQuestions(this.s, this.assessments, basis).filter((q) => canonical === null || q.conceptName === canonical).length;
    return { conceptName: canonical, available: count("available"), validated: count("validated"), published: count("published") };
  }

  /** Counted questions by provenance KIND and tier - what provenance constraints can actually be satisfied. Kinds only, never references or licenses. */
  provenanceConstraints(): Array<{ sourceType: string; available: number; validated: number; published: number }> {
    const kinds = new Map<string, { available: number; validated: number; published: number }>();
    for (const basis of ["available", "validated", "published"] as const) {
      for (const q of qualifiedQuestions(this.s, this.assessments, basis)) {
        const key = q.view.sourceType ?? "unknown";
        const e = kinds.get(key) ?? { available: 0, validated: 0, published: 0 };
        e[basis] += 1;
        kinds.set(key, e);
      }
    }
    return [...kinds.entries()].sort((a, b) => cmp(a[0], b[0])).map(([sourceType, v]) => ({ sourceType, ...v }));
  }

  /** The audit trail for one number: which questions a (facet, member) metric counts, with their lifecycle state and DNA value. */
  explainContentMember(facet: FacetName, member: string, basis: ContentBasis = "published"): Array<{ questionId: string; validationState: string; conceptName: string; patternFamilyName: string }> {
    const def = FACET_DEFINITIONS[facet];
    return qualifiedQuestions(this.s, this.assessments, basis)
      .filter((q) => def.members(projectDna(q.view.id, q.view.dna, q.conceptName), this.s).includes(member))
      .map((q) => ({ questionId: q.view.id, validationState: q.view.validationState, conceptName: q.conceptName, patternFamilyName: q.view.dna.patternFamilyName }))
      .sort((a, b) => cmp(a.questionId, b.questionId));
  }
}
