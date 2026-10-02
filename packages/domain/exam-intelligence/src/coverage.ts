import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import {
  buildExamQuestionUniverse,
  structuralSignature,
  TIME_DEMAND_BANDS,
  UNIVERSE_THRESHOLDS,
  type ConceptUniverse,
  type QuestionInstanceDna
} from "@ipmat/content-authoring";
import { selectClassified, validateDnaClassification } from "@ipmat/examiner-intelligence";
import { ALL_TESTING_MODES } from "@ipmat/examiner-lens";
import type { DifficultyTier, NoveltyLevel } from "@ipmat/question-engine";
import { assessQuestions, qualifiedQuestions, summarizeAssessments, type AssessmentOptions, type AssessmentSummary, type QuestionAssessment } from "./quality.js";
import { CONTENT_BASES, type ContentBasis, type CoverageBasis, type ExamIntelligenceSnapshot } from "./types.js";

/**
 * Multidimensional COVERAGE (docs/DECISIONS.md D-086).
 *
 * COVERAGE IS NOT A QUESTION COUNT. Every metric is "how much of a named,
 * MAPPED universe has at least one qualifying item", with the universe (the
 * denominator), the observed set, the numerator and every exclusion written
 * down. There is no single coverage percentage and no metric without a
 * denominator: where the universe is empty the state is `no_universe`, where
 * there is no evidence at all it is `insufficient_data` - never a made-up 0 or 100.
 *
 * "Mapped" is deliberately modest: the universe is what the exam model and the
 * pattern families already define (the pack's concepts and combinable relations,
 * the families' potential modes and traps, the fixed vocabularies). Nothing here
 * claims the universe is complete or that every region SHOULD be filled - only
 * which known regions are filled, sparse, empty or over-concentrated.
 *
 * Content and historical evidence are NEVER mixed: content is measured at three
 * strictly nested tiers (available ⊇ validated ⊇ published) and historical
 * evidence is its own basis (reviewed, real-source records only; fixtures,
 * candidates and raw imports are excluded and counted).
 */

export const FACETS = ["concept", "pattern", "combination", "transformation", "difficulty_tier", "difficulty_dimension", "novelty", "trap", "time_demand"] as const;
export type FacetName = (typeof FACETS)[number];

const DIMENSIONS = ["conceptualLoad", "computationalLoad", "trapDensity", "representationNovelty", "timePressure", "multiStepDepth"] as const;
const TIERS: readonly DifficultyTier[] = ["standard", "advanced", "hard", "extreme", "novel"];
const NOVELTY: readonly NoveltyLevel[] = ["standard", "novel_representation", "novel_combination", "novel_context"];
const COMBINABLE_TYPES = ["commonly_combined", "application", "dependent"];
const norm = normalizeConceptNameKey;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The one projection both content questions and historical classifications go through, so the SAME definitions apply to both. */
export interface FacetItem {
  id: string;
  conceptName: string;
  dna: QuestionInstanceDna;
  signature: string;
}

export interface FacetDefinition {
  facet: FacetName;
  /** The explicit definition shown with every metric. */
  definition: { universe: string; observed: string; denominator: string; numerator: string };
  universe(s: ExamIntelligenceSnapshot): string[];
  members(item: FacetItem, s: ExamIntelligenceSnapshot): string[];
}

const third = (v: number): "low" | "mid" | "high" => (v < 1 / 3 ? "low" : v < 2 / 3 ? "mid" : "high");
const bandOf = (seconds: number): string => TIME_DEMAND_BANDS.find((b) => seconds <= b.maxSeconds)!.label;
const pairKey = (a: string, b: string): string => [a, b].sort((x, y) => cmp(norm(x), norm(y))).join(" + ");

function mappedCombinations(s: ExamIntelligenceSnapshot): string[] {
  const names = new Map(s.pack.concepts.map((c) => [c.key, c.name]));
  const set = new Set<string>();
  for (const r of s.pack.relations) {
    if (!COMBINABLE_TYPES.includes(r.type) || !r.usefulForQuestionGeneration) continue;
    const a = names.get(r.from);
    const b = names.get(r.to);
    if (a && b) set.add(pairKey(a, b));
  }
  return [...set].sort(cmp);
}

export const FACET_DEFINITIONS: Record<FacetName, FacetDefinition> = {
  concept: {
    facet: "concept",
    definition: {
      universe: "every concept of the exam pack",
      observed: "concepts that at least one qualifying item names as its primary concept",
      denominator: "number of concepts in the pack",
      numerator: "number of pack concepts with >= 1 qualifying item"
    },
    universe: (s) => s.pack.concepts.map((c) => c.name).sort(cmp),
    members: (i) => [i.conceptName]
  },
  pattern: {
    facet: "pattern",
    definition: {
      universe: "every MAPPED pattern family (concept / family) of the exam",
      observed: "mapped families that at least one qualifying item is an instance of",
      denominator: "number of mapped pattern families",
      numerator: "number of mapped families with >= 1 qualifying item"
    },
    universe: (s) => s.patternFamilies.map((f) => `${f.conceptName} / ${f.name}`).sort(cmp),
    members: (i) => [`${i.conceptName} / ${i.dna.patternFamilyName}`]
  },
  combination: {
    facet: "combination",
    definition: {
      universe: "every MAPPED concept pair: pack relations of a combinable type (commonly_combined, application, dependent) marked useful for question generation",
      observed: "mapped pairs (primary concept + a combination concept) that at least one qualifying item combines",
      denominator: "number of mapped combinable concept pairs",
      numerator: "number of mapped pairs with >= 1 qualifying item (pairs observed but not mapped are reported as unmapped, never counted)"
    },
    universe: mappedCombinations,
    members: (i) => i.dna.combinesWithConcepts.map((p) => pairKey(i.conceptName, p))
  },
  transformation: {
    facet: "transformation",
    definition: {
      universe: "the union of the testing modes (transformations) the mapped pattern families declare as potential",
      observed: "mapped testing modes that at least one qualifying item uses",
      denominator: "number of distinct potential testing modes across mapped families",
      numerator: "number of those modes with >= 1 qualifying item (modes used but not declared potential are unmapped)"
    },
    universe: (s) => [...new Set(s.patternFamilies.flatMap((f) => f.potentialTestingModes))].filter((m) => ALL_TESTING_MODES.includes(m)).sort(cmp),
    members: (i) => [...i.dna.testingModes]
  },
  difficulty_tier: {
    facet: "difficulty_tier",
    definition: { universe: "the five difficulty tiers", observed: "tiers with >= 1 qualifying item", denominator: "5 - the five tiers", numerator: "number of tiers with >= 1 qualifying item" },
    universe: () => [...TIERS],
    members: (i) => [i.dna.difficultyTier]
  },
  difficulty_dimension: {
    facet: "difficulty_dimension",
    definition: {
      universe: "every (dimension, band) cell: the six existing difficulty dimensions x {low, mid, high} thirds - dimensions are never combined into one score",
      observed: "cells that at least one qualifying item falls in",
      denominator: "18 - six dimensions x three bands",
      numerator: "number of cells with >= 1 qualifying item (PROVISIONAL annotations, not calibrated measurements)"
    },
    universe: () => DIMENSIONS.flatMap((d) => (["low", "mid", "high"] as const).map((b) => `${d}:${b}`)),
    members: (i) => DIMENSIONS.map((d) => `${d}:${third(i.dna.difficultyDimensions[d])}`)
  },
  novelty: {
    facet: "novelty",
    definition: { universe: "the four existing novelty levels", observed: "levels with >= 1 qualifying item", denominator: "4 - the four levels", numerator: "number of levels with >= 1 qualifying item" },
    universe: () => [...NOVELTY],
    members: (i) => [i.dna.noveltyLevel]
  },
  trap: {
    facet: "trap",
    definition: {
      universe: "the union of the error-taxonomy traps the mapped pattern families declare as potential",
      observed: "mapped traps that at least one qualifying item carries (an item with no trap contributes to none)",
      denominator: "number of distinct potential traps across mapped families",
      numerator: "number of those traps with >= 1 qualifying item (a trap is a question property, never a student diagnosis)"
    },
    universe: (s) => [...new Set(s.patternFamilies.flatMap((f) => f.potentialTrapErrorTaxonomyCodes))].sort(cmp),
    members: (i) => (i.dna.trapErrorTaxonomyCode ? [i.dna.trapErrorTaxonomyCode] : [])
  },
  time_demand: {
    facet: "time_demand",
    definition: {
      universe: "the four PROVISIONAL expected-time bands",
      observed: "bands with >= 1 qualifying item",
      denominator: "4 - the four bands",
      numerator: "number of bands with >= 1 qualifying item (time demand describes expected time only; it is not difficulty)"
    },
    universe: () => TIME_DEMAND_BANDS.map((b) => b.label),
    members: (i) => [bandOf(i.dna.expectedTimeSeconds)]
  }
};

export type MemberStatus = "empty" | "underrepresented" | "represented";
export interface CoverageMember {
  member: string;
  /** Qualifying items contributing to this member (an item with several modes contributes to each). */
  count: number;
  /** How many DIFFERENT structural signatures those items span - count != breadth. */
  distinctStructures: number;
  status: MemberStatus;
}

/**
 * - measured:          a real measurement (a content metric over zero items is a real, empty measurement)
 * - no_universe:       the denominator is 0, so no ratio is defined
 * - insufficient_data: there is no evidence at all to measure (historical basis with no qualifying record)
 */
export type MetricState = "measured" | "no_universe" | "insufficient_data";

export interface CoverageMetric {
  facet: FacetName;
  basis: CoverageBasis;
  definition: FacetDefinition["definition"];
  state: MetricState;
  denominator: number;
  numerator: number;
  /** numerator / denominator, or null when the state is not `measured`. */
  ratio: number | null;
  /** Qualifying items considered (after every exclusion). */
  itemCount: number;
  members: CoverageMember[];
  /** Values observed that are NOT in the mapped universe: reported, never counted in the numerator. */
  unmapped: Array<{ member: string; count: number }>;
  emptyMembers: string[];
  underrepresentedMembers: string[];
  topMember: string | null;
  topMemberShare: number | null;
  /** Many items, one member dominating: a narrow pool that the raw item count would hide. */
  concentrated: boolean;
}

export function computeFacetMetric(def: FacetDefinition, items: readonly FacetItem[], basis: CoverageBasis, snapshot: ExamIntelligenceSnapshot): CoverageMetric {
  const universe = def.universe(snapshot);
  const inUniverse = new Set(universe);
  const perMember = new Map<string, { count: number; signatures: Set<string> }>();
  for (const item of items) {
    for (const m of new Set(def.members(item, snapshot))) {
      const e = perMember.get(m) ?? { count: 0, signatures: new Set<string>() };
      e.count += 1;
      e.signatures.add(item.signature);
      perMember.set(m, e);
    }
  }
  const status = (n: number): MemberStatus => (n === 0 ? "empty" : n <= UNIVERSE_THRESHOLDS.UNDERREPRESENTED_MAX_COUNT ? "underrepresented" : "represented");
  const members: CoverageMember[] = universe.map((member) => {
    const e = perMember.get(member);
    return { member, count: e?.count ?? 0, distinctStructures: e?.signatures.size ?? 0, status: status(e?.count ?? 0) };
  });
  const unmapped = [...perMember.entries()].filter(([m]) => !inUniverse.has(m)).map(([member, e]) => ({ member, count: e.count })).sort((a, b) => cmp(a.member, b.member));
  const numerator = members.filter((m) => m.count > 0).length;
  const denominator = universe.length;
  const historical = basis === "historical_observed";
  const state: MetricState = denominator === 0 ? "no_universe" : historical && items.length === 0 ? "insufficient_data" : "measured";
  const top = [...perMember.entries()].sort((a, b) => b[1].count - a[1].count || cmp(a[0], b[0]))[0];
  const topShare = top && items.length > 0 ? top[1].count / items.length : null;
  return {
    facet: def.facet,
    basis,
    definition: def.definition,
    state,
    denominator,
    numerator,
    ratio: state === "measured" ? numerator / denominator : null,
    itemCount: items.length,
    members,
    unmapped,
    emptyMembers: members.filter((m) => m.status === "empty").map((m) => m.member),
    underrepresentedMembers: members.filter((m) => m.status === "underrepresented").map((m) => m.member),
    topMember: top ? top[0] : null,
    topMemberShare: topShare,
    concentrated: topShare !== null && universe.length >= 2 && items.length >= UNIVERSE_THRESHOLDS.CONCENTRATION_MIN_PUBLISHED && topShare >= UNIVERSE_THRESHOLDS.CONCENTRATION_TOP_SHARE
  };
}

export interface HistoricalAccounting {
  total: number;
  /** Reviewed, real-source, valid for this exam's pack: the ONLY records historical coverage counts. */
  counted: number;
  excluded: { cross_exam: number; fixture: number; not_reviewed: number; invalid_classification: number };
}

export interface ExamCoverageReport {
  examCode: string;
  examVersion: string;
  accounting: { content: AssessmentSummary; historical: HistoricalAccounting };
  /** Content coverage at three nested tiers. */
  content: Record<ContentBasis, CoverageMetric[]>;
  /** Historical coverage: observed testing in reviewed, real-source records only - never a prediction. */
  historical: CoverageMetric[];
  /** Per-concept depth over PUBLISHED content (patterns, combinations, modes, novelty, traps, time demand; empty/underrepresented/concentrated). */
  concepts: ConceptUniverse[];
  /** Why every question was or was not counted - the audit trail from a number back to its inputs. */
  dispositions: QuestionAssessment[];
}

export function projectDna(id: string, dna: QuestionInstanceDna, conceptName: string): FacetItem {
  return { id, conceptName, dna, signature: structuralSignature(dna) };
}

export function computeCoverage(snapshot: ExamIntelligenceSnapshot, options: AssessmentOptions = {}): ExamCoverageReport {
  const assessments = assessQuestions(snapshot, options);
  const contentMetrics = (basis: ContentBasis): CoverageMetric[] => {
    const items = qualifiedQuestions(snapshot, assessments, basis).map((q) => projectDna(q.view.id, q.view.dna, q.conceptName));
    return FACETS.map((f) => computeFacetMetric(FACET_DEFINITIONS[f], items, `${basis}_content` as CoverageBasis, snapshot));
  };

  // Historical: reviewed + real-source only, and only classifications valid for THIS exam's pack.
  const conceptNames = new Map(snapshot.pack.concepts.map((c) => [norm(c.name), c.name]));
  const all = snapshot.historicalRecords;
  const own = all.filter((r) => r.examCode === snapshot.examCode);
  const reviewedReal = selectClassified(own, { examCode: snapshot.examCode });
  const items: FacetItem[] = [];
  let invalid = 0;
  for (const r of reviewedReal) {
    const dna = r.classification;
    const issues = validateDnaClassification(dna, { pack: snapshot.pack, patternFamilies: snapshot.patternFamilies, errorTaxonomyCodes: snapshot.errorTaxonomyCodes });
    const conceptName = conceptNames.get(norm(dna.conceptName));
    if (issues.length > 0 || !conceptName) {
      invalid += 1;
      continue;
    }
    items.push(projectDna(r.id, { ...(dna as unknown as QuestionInstanceDna), examRelevance: "core" }, conceptName));
  }
  const historical: HistoricalAccounting = {
    total: all.length,
    counted: items.length,
    excluded: {
      cross_exam: all.length - own.length,
      fixture: own.filter((r) => r.dataOrigin === "fixture").length,
      not_reviewed: own.filter((r) => r.dataOrigin === "real_source" && r.annotationState !== "reviewed_validated").length,
      invalid_classification: invalid
    }
  };

  const publishedRefs = qualifiedQuestions(snapshot, assessments, "published").map((q) => ({ id: q.view.id, dna: q.view.dna, validationState: q.view.validationState }));
  return {
    examCode: snapshot.examCode,
    examVersion: snapshot.examVersion,
    accounting: { content: summarizeAssessments(snapshot, assessments), historical },
    content: { available: contentMetrics("available"), validated: contentMetrics("validated"), published: contentMetrics("published") },
    historical: FACETS.map((f) => computeFacetMetric(FACET_DEFINITIONS[f], items, "historical_observed", snapshot)),
    concepts: buildExamQuestionUniverse(snapshot.pack, snapshot.patternFamilies, publishedRefs),
    dispositions: assessments
  };
}

export { CONTENT_BASES };
