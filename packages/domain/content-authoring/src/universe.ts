import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import type { ExamPack } from "@ipmat/exam-pack";
import { ALL_TESTING_MODES } from "@ipmat/examiner-lens";
import type { DifficultyTier, NoveltyLevel, QuestionPatternFamilyData, TestingMode, ValidationState } from "@ipmat/question-engine";
import type { QuestionInstanceDna } from "./types.js";

/**
 * The Question Universe (docs/DECISIONS.md D-084): the structured space of
 * meaningful question PATTERNS and the validated question INSTANCES that fill
 * it - never a list of every possible question, and never a claim that it is
 * complete. Everything here is derived on every call from the pack, the
 * mapped pattern families and the questions given; nothing is stored.
 *
 * The central distinction: PATTERN COVERAGE != QUESTION COUNT. 100 published
 * questions that all share one structural signature cover one structure;
 * the universe reports `published` AND `distinctSignatures` side by side, so a
 * large pool of one structure is visibly narrow.
 */

export interface UniverseQuestionRef {
  id: string;
  dna: QuestionInstanceDna;
  validationState: ValidationState;
}

/**
 * PROVISIONAL, uncalibrated, centralized (the same rule as AUTOPSY_THRESHOLDS
 * and MASTERY_CONSTANTS). No real student or content-quality data justifies
 * these numbers; they only decide how a region is LABELLED, never whether a
 * question is good. Do not tune them to make a pool look healthier.
 */
export const UNIVERSE_THRESHOLDS = {
  /** A region with 1..N published instances is "underrepresented"; 0 is "empty". */
  UNDERREPRESENTED_MAX_COUNT: 2,
  /** A pattern is "concentrated" only once it has at least this many published instances... */
  CONCENTRATION_MIN_PUBLISHED: 8,
  /** ...and one structural signature accounts for at least this share of them. */
  CONCENTRATION_TOP_SHARE: 0.6
} as const;

/**
 * PROVISIONAL expected-time bands. They describe how long a question is
 * expected to take, nothing else: long is not hard, and time demand is not
 * difficulty (D-021).
 */
export const TIME_DEMAND_BANDS = [
  { label: "up_to_45s", maxSeconds: 45 },
  { label: "46_to_90s", maxSeconds: 90 },
  { label: "91_to_150s", maxSeconds: 150 },
  { label: "over_150s", maxSeconds: Number.POSITIVE_INFINITY }
] as const;
export type TimeDemandBand = (typeof TIME_DEMAND_BANDS)[number]["label"];

const TIERS: readonly DifficultyTier[] = ["standard", "advanced", "hard", "extreme", "novel"];
const NOVELTY: readonly NoveltyLevel[] = ["standard", "novel_representation", "novel_combination", "novel_context"];
const DIMENSIONS = ["conceptualLoad", "computationalLoad", "trapDensity", "representationNovelty", "timePressure", "multiStepDepth"] as const;
const COMBINABLE_TYPES = ["commonly_combined", "application", "dependent"];

export type RegionStatus = "empty" | "underrepresented" | "represented";

export interface RegionCount<T> {
  value: T;
  /** Every non-rejected instance, in any lifecycle state. */
  total: number;
  /** Published instances only - the pool a student can actually be trained on. */
  published: number;
  status: RegionStatus;
}

export interface PatternBreadth {
  patternFamilyName: string;
  total: number;
  published: number;
  /** How many DIFFERENT structural signatures the published instances span. */
  distinctSignatures: number;
  /** Share of published instances held by the single most common signature (null when none are published). */
  topSignatureShare: number | null;
  /** Many published instances, mostly one structure: a narrow pool that the raw count would hide. */
  concentrated: boolean;
  status: RegionStatus;
}

export interface ConceptUniverse {
  examCode: string;
  conceptName: string;
  patterns: PatternBreadth[];
  combinations: Array<RegionCount<string[]>>;
  transformations: Array<RegionCount<TestingMode>>;
  noveltyLevels: Array<RegionCount<NoveltyLevel>>;
  difficultyTiers: Array<RegionCount<DifficultyTier>>;
  traps: Array<RegionCount<string>>;
  timeDemand: Array<RegionCount<TimeDemandBand>>;
  /** Published instances per difficulty dimension, split into low/mid/high thirds. Each dimension is separate; there is no combined score. */
  difficultyDimensions: Record<(typeof DIMENSIONS)[number], { low: number; mid: number; high: number }>;
  totals: { questions: number; published: number; distinctSignaturesPublished: number };
  /** Facet/value pairs with zero published instances, and those below the underrepresented bound. "Mapped space", not a claim that anything must exist. */
  emptyRegions: Array<{ facet: string; value: string }>;
  underrepresentedRegions: Array<{ facet: string; value: string; published: number }>;
}

const norm = normalizeConceptNameKey;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The structural identity of a question for BREADTH purposes: two questions with the same signature fill the same structural slot. */
export function structuralSignature(dna: QuestionInstanceDna): string {
  return JSON.stringify([
    norm(dna.patternFamilyName),
    dna.difficultyTier,
    [...dna.testingModes].sort(),
    [...dna.combinesWithConcepts].map(norm).sort(),
    dna.noveltyLevel,
    dna.trapErrorTaxonomyCode
  ]);
}

const status = (published: number): RegionStatus => (published === 0 ? "empty" : published <= UNIVERSE_THRESHOLDS.UNDERREPRESENTED_MAX_COUNT ? "underrepresented" : "represented");

function timeBand(seconds: number): TimeDemandBand {
  return TIME_DEMAND_BANDS.find((b) => seconds <= b.maxSeconds)!.label;
}

function third(value: number): "low" | "mid" | "high" {
  return value < 1 / 3 ? "low" : value < 2 / 3 ? "mid" : "high";
}

export interface UniverseInput {
  pack: ExamPack;
  patternFamilies: readonly QuestionPatternFamilyData[];
  questions: readonly UniverseQuestionRef[];
  conceptName: string;
}

export function buildConceptUniverse(input: UniverseInput): ConceptUniverse {
  const { pack, conceptName } = input;
  // Cross-exam isolation: only this exam's questions about this concept can ever be counted.
  const mine = input.questions.filter((q) => q.dna.examCode === pack.examCode && norm(q.dna.conceptName) === norm(conceptName) && q.validationState !== "rejected");
  const published = mine.filter((q) => q.validationState === "published");
  const families = input.patternFamilies.filter((f) => norm(f.conceptName) === norm(conceptName));

  const count = <T>(value: T, match: (q: UniverseQuestionRef) => boolean): RegionCount<T> => {
    const p = published.filter(match).length;
    return { value, total: mine.filter(match).length, published: p, status: status(p) };
  };

  const patternNames = [...new Set([...families.map((f) => f.name), ...mine.map((q) => q.dna.patternFamilyName)])].sort(cmp);
  const patterns: PatternBreadth[] = patternNames.map((name) => {
    const inPattern = (q: UniverseQuestionRef) => norm(q.dna.patternFamilyName) === norm(name);
    const pub = published.filter(inPattern);
    const signatures = new Map<string, number>();
    for (const q of pub) signatures.set(structuralSignature(q.dna), (signatures.get(structuralSignature(q.dna)) ?? 0) + 1);
    const top = pub.length === 0 ? null : Math.max(...signatures.values()) / pub.length;
    return {
      patternFamilyName: name,
      total: mine.filter(inPattern).length,
      published: pub.length,
      distinctSignatures: signatures.size,
      topSignatureShare: top,
      concentrated: top !== null && pub.length >= UNIVERSE_THRESHOLDS.CONCENTRATION_MIN_PUBLISHED && top >= UNIVERSE_THRESHOLDS.CONCENTRATION_TOP_SHARE,
      status: status(pub.length)
    };
  });

  const comboKey = (names: string[]) => names.map(norm).sort().join("|");
  const mappedCombos = new Map<string, string[]>();
  for (const r of pack.relations) {
    if (!COMBINABLE_TYPES.includes(r.type) || !r.usefulForQuestionGeneration) continue;
    const from = pack.concepts.find((c) => c.key === r.from);
    const to = pack.concepts.find((c) => c.key === r.to);
    if (!from || !to || (norm(from.name) !== norm(conceptName) && norm(to.name) !== norm(conceptName))) continue;
    const names = [from.name, to.name].sort(cmp);
    mappedCombos.set(comboKey(names), names);
  }
  for (const q of mine) {
    if (q.dna.combinesWithConcepts.length === 0) continue;
    const names = [...new Set([q.dna.conceptName, ...q.dna.combinesWithConcepts])].sort(cmp);
    if (!mappedCombos.has(comboKey(names))) mappedCombos.set(comboKey(names), names);
  }
  const combinations = [...mappedCombos.entries()].sort((a, b) => cmp(a[0], b[0])).map(([key, names]) =>
    count(names, (q) => q.dna.combinesWithConcepts.length > 0 && comboKey([q.dna.conceptName, ...q.dna.combinesWithConcepts]) === key)
  );

  const trapCodes = [...new Set([...families.flatMap((f) => f.potentialTrapErrorTaxonomyCodes), ...mine.flatMap((q) => (q.dna.trapErrorTaxonomyCode ? [q.dna.trapErrorTaxonomyCode] : []))])].sort(cmp);

  const difficultyDimensions = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const bins = { low: 0, mid: 0, high: 0 };
      for (const q of published) bins[third(q.dna.difficultyDimensions[d])] += 1;
      return [d, bins];
    })
  ) as ConceptUniverse["difficultyDimensions"];

  const universe: ConceptUniverse = {
    examCode: pack.examCode,
    conceptName,
    patterns,
    combinations,
    transformations: ALL_TESTING_MODES.map((m) => count(m, (q) => q.dna.testingModes.includes(m))),
    noveltyLevels: NOVELTY.map((n) => count(n, (q) => q.dna.noveltyLevel === n)),
    difficultyTiers: TIERS.map((t) => count(t, (q) => q.dna.difficultyTier === t)),
    traps: trapCodes.map((t) => count(t, (q) => q.dna.trapErrorTaxonomyCode === t)),
    timeDemand: TIME_DEMAND_BANDS.map((b) => count(b.label, (q) => timeBand(q.dna.expectedTimeSeconds) === b.label)),
    difficultyDimensions,
    totals: { questions: mine.length, published: published.length, distinctSignaturesPublished: new Set(published.map((q) => structuralSignature(q.dna))).size },
    emptyRegions: [],
    underrepresentedRegions: []
  };

  const facets: Array<[string, Array<{ value: unknown; published: number; status: RegionStatus }>]> = [
    ["pattern", patterns.map((p) => ({ value: p.patternFamilyName, published: p.published, status: p.status }))],
    ["combination", universe.combinations.map((c) => ({ ...c, value: (c.value as string[]).join(" + ") }))],
    ["transformation", universe.transformations],
    ["novelty", universe.noveltyLevels],
    ["difficulty_tier", universe.difficultyTiers],
    ["trap", universe.traps],
    ["time_demand", universe.timeDemand]
  ];
  for (const [facet, regions] of facets) {
    for (const r of regions) {
      if (r.status === "empty") universe.emptyRegions.push({ facet, value: String(r.value) });
      else if (r.status === "underrepresented") universe.underrepresentedRegions.push({ facet, value: String(r.value), published: r.published });
    }
  }
  return universe;
}

/** One universe per concept that has mapped pattern families or any question. Concepts with neither are not part of the mapped universe yet. */
export function buildExamQuestionUniverse(pack: ExamPack, patternFamilies: readonly QuestionPatternFamilyData[], questions: readonly UniverseQuestionRef[]): ConceptUniverse[] {
  const named = new Set<string>();
  for (const f of patternFamilies) named.add(norm(f.conceptName));
  for (const q of questions) if (q.dna.examCode === pack.examCode) named.add(norm(q.dna.conceptName));
  return pack.concepts
    .filter((c) => named.has(norm(c.name)))
    .sort((a, b) => cmp(a.key, b.key))
    .map((c) => buildConceptUniverse({ pack, patternFamilies, questions, conceptName: c.name }));
}
