import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import { TIME_DEMAND_BANDS } from "@ipmat/content-authoring";
import type { DifficultyTier, NoveltyLevel, ProvenanceSourceType, TestingMode, ValidationState } from "@ipmat/question-engine";
import { assessQuestions, qualifiedQuestions, summarizeAssessments, type AssessmentOptions, type QualifiedQuestion } from "./quality.js";
import { ExamIntelligenceError, type ExamIntelligenceSnapshot } from "./types.js";

/**
 * The QUESTION-SELECTION bridge (docs/DECISIONS.md D-086): structured, auditable
 * exam-space constraints that a downstream consumer can apply to the validated
 * question instances of ONE exam.
 *
 * This answers "which questions are in this region of the exam space" - nothing
 * else. It does not rank, recommend or choose for a student, it reads no
 * student evidence, and it replaces no provider: Calculation Gym, Speed Lab,
 * Trap Lab, Novelty Training, Pressure Training, Revision and adaptive
 * selection remain the sole owners of their decision logic and of their own
 * student-evidence semantics. A provider can intersect its own candidates with
 * a result via `restrictCandidates` and keep deciding as before.
 *
 * Every constraint only ever REMOVES questions (filtering is monotone: adding a
 * constraint never grows the result). Results are deterministic (ordered by
 * question id) and every step is traced, so the path from constraint to
 * candidate set is auditable. A constraint that names something the exam does
 * not have (an unknown concept, a cross-exam concept, an unknown dimension) is
 * an error, never silently ignored.
 */

const DIMENSIONS = ["conceptualLoad", "computationalLoad", "trapDensity", "representationNovelty", "timePressure", "multiStepDepth"] as const;
export type DifficultyDimensionKey = (typeof DIMENSIONS)[number];
export type TimeBandLabel = (typeof TIME_DEMAND_BANDS)[number]["label"];

export interface QuestionSelectionConstraints {
  /** Lifecycle states to accept. DEFAULT: ["published"] - students are only ever trained on published content. */
  states?: readonly ValidationState[];
  sections?: readonly string[];
  concepts?: readonly string[];
  patternFamilies?: readonly string[];
  /** `any`: the question combines at least one of these; `all`: all of these; `exact`: exactly this set; `none`: combines nothing; `some`: combines something. */
  combination?: { mode: "any" | "all" | "exact"; concepts: readonly string[] } | { mode: "none" } | { mode: "some" };
  testingModes?: { mode: "any" | "all"; values: readonly TestingMode[] };
  difficultyTiers?: readonly DifficultyTier[];
  /** Inclusive per-dimension ranges on the six EXISTING (provisional) dimensions. Dimensions are filtered one by one, never combined. */
  difficultyDimensions?: Partial<Record<DifficultyDimensionKey, { min?: number; max?: number }>>;
  novelty?: readonly NoveltyLevel[];
  trap?: { codes: readonly string[] } | { none: true } | { any: true };
  /** Expected-time bands (PROVISIONAL) and/or an inclusive expected-seconds range. Time demand is not difficulty. */
  timeBands?: readonly TimeBandLabel[];
  expectedTimeSeconds?: { min?: number; max?: number };
  /** Provenance KINDS accepted (never references or licenses). */
  sourceTypes?: readonly ProvenanceSourceType[];
  excludeQuestionIds?: readonly string[];
}

export interface SelectionCandidate {
  questionId: string;
  sectionName: string;
  conceptName: string;
  patternFamilyName: string;
  combinesWith: string[];
  testingModes: string[];
  difficultyTier: string;
  noveltyLevel: string;
  trapCode: string | null;
  expectedTimeSeconds: number;
  timeBand: string;
  validationState: string;
  sourceType: string | null;
}

export interface SelectionTraceStep {
  filter: string;
  before: number;
  after: number;
}

export interface SelectionResult {
  examCode: string;
  examVersion: string;
  /** The constraints as applied (defaults filled in), so the result is reproducible. */
  constraints: QuestionSelectionConstraints;
  /** Candidates ordered by question id. DNA-level facts only: no question text, options, answer, solution or reviewer data. */
  candidates: SelectionCandidate[];
  /** What was available before any constraint, and why other questions never entered (data quality). */
  qualifying: number;
  excludedByQuality: ReturnType<typeof summarizeAssessments>["excluded"];
  trace: SelectionTraceStep[];
}

const norm = normalizeConceptNameKey;
const bandOf = (seconds: number): string => TIME_DEMAND_BANDS.find((b) => seconds <= b.maxSeconds)!.label;
const invalid = (message: string): never => {
  throw new ExamIntelligenceError("invalid_constraint", message);
};

function checkRange(label: string, r: { min?: number; max?: number } | undefined): void {
  if (!r) return;
  for (const k of ["min", "max"] as const) if (r[k] !== undefined && (typeof r[k] !== "number" || !Number.isFinite(r[k]))) invalid(`${label}.${k} must be a finite number`);
  if (r.min !== undefined && r.max !== undefined && r.min > r.max) invalid(`${label}: min is greater than max`);
}

function validateConstraints(c: QuestionSelectionConstraints, s: ExamIntelligenceSnapshot): void {
  const concepts = new Set(s.pack.concepts.map((x) => norm(x.name)));
  const sections = new Set(s.pack.sections.map((x) => norm(x.name)));
  const families = new Set(s.patternFamilies.map((f) => norm(f.name)));
  for (const n of c.concepts ?? []) if (!concepts.has(norm(n))) invalid(`unknown concept "${n}" for exam ${s.examCode}`);
  if (c.combination && "concepts" in c.combination) for (const n of c.combination.concepts) if (!concepts.has(norm(n))) invalid(`unknown combination concept "${n}" for exam ${s.examCode}`);
  for (const n of c.sections ?? []) if (!sections.has(norm(n))) invalid(`unknown section "${n}" for exam ${s.examCode}`);
  for (const n of c.patternFamilies ?? []) if (!families.has(norm(n))) invalid(`unknown pattern family "${n}" for exam ${s.examCode}`);
  for (const k of Object.keys(c.difficultyDimensions ?? {})) {
    if (!(DIMENSIONS as readonly string[]).includes(k)) invalid(`unknown difficulty dimension "${k}"`);
    checkRange(`difficultyDimensions.${k}`, c.difficultyDimensions![k as DifficultyDimensionKey]);
  }
  checkRange("expectedTimeSeconds", c.expectedTimeSeconds);
  for (const b of c.timeBands ?? []) if (!TIME_DEMAND_BANDS.some((x) => x.label === b)) invalid(`unknown time band "${String(b)}"`);
  for (const code of c.trap && "codes" in c.trap ? c.trap.codes : []) if (!s.errorTaxonomyCodes.includes(code)) invalid(`unknown trap code "${code}"`);
}

/** Applies exam-space constraints to the qualifying questions of one exam. Deterministic, monotone, traced. */
export function selectQuestions(snapshot: ExamIntelligenceSnapshot, constraints: QuestionSelectionConstraints = {}, options: AssessmentOptions = {}): SelectionResult {
  validateConstraints(constraints, snapshot);
  const applied: QuestionSelectionConstraints = { ...constraints, states: constraints.states ?? ["published"] };
  const assessments = assessQuestions(snapshot, options);
  const summary = summarizeAssessments(snapshot, assessments);
  let pool: QualifiedQuestion[] = qualifiedQuestions(snapshot, assessments, "available");
  const trace: SelectionTraceStep[] = [];
  const step = (filter: string, keep: (q: QualifiedQuestion) => boolean): void => {
    const before = pool.length;
    pool = pool.filter(keep);
    trace.push({ filter, before, after: pool.length });
  };

  step("states", (q) => applied.states!.includes(q.view.validationState));
  if (constraints.sections) { const set = new Set(constraints.sections.map(norm)); step("sections", (q) => set.has(norm(q.view.dna.sectionName))); }
  if (constraints.concepts) { const set = new Set(constraints.concepts.map(norm)); step("concepts", (q) => set.has(norm(q.conceptName))); }
  if (constraints.patternFamilies) { const set = new Set(constraints.patternFamilies.map(norm)); step("patternFamilies", (q) => set.has(norm(q.view.dna.patternFamilyName))); }
  if (constraints.combination) {
    const c = constraints.combination;
    step("combination", (q) => {
      const have = new Set(q.view.dna.combinesWithConcepts.map(norm));
      if (c.mode === "none") return have.size === 0;
      if (c.mode === "some") return have.size > 0;
      const want = c.concepts.map(norm);
      if (c.mode === "any") return want.some((w) => have.has(w));
      if (c.mode === "all") return want.every((w) => have.has(w));
      return have.size === new Set(want).size && want.every((w) => have.has(w));
    });
  }
  if (constraints.testingModes) { const { mode, values } = constraints.testingModes; step("testingModes", (q) => (mode === "any" ? values.some((v) => q.view.dna.testingModes.includes(v)) : values.every((v) => q.view.dna.testingModes.includes(v)))); }
  if (constraints.difficultyTiers) step("difficultyTiers", (q) => constraints.difficultyTiers!.includes(q.view.dna.difficultyTier));
  for (const dim of DIMENSIONS) {
    const r = constraints.difficultyDimensions?.[dim];
    if (r) step(`difficultyDimensions.${dim}`, (q) => (r.min === undefined || q.view.dna.difficultyDimensions[dim] >= r.min) && (r.max === undefined || q.view.dna.difficultyDimensions[dim] <= r.max));
  }
  if (constraints.novelty) step("novelty", (q) => constraints.novelty!.includes(q.view.dna.noveltyLevel));
  if (constraints.trap) {
    const t = constraints.trap;
    step("trap", (q) => ("codes" in t ? q.view.dna.trapErrorTaxonomyCode !== null && t.codes.includes(q.view.dna.trapErrorTaxonomyCode) : "none" in t ? q.view.dna.trapErrorTaxonomyCode === null : q.view.dna.trapErrorTaxonomyCode !== null));
  }
  if (constraints.timeBands) step("timeBands", (q) => constraints.timeBands!.includes(bandOf(q.view.dna.expectedTimeSeconds) as TimeBandLabel));
  if (constraints.expectedTimeSeconds) { const r = constraints.expectedTimeSeconds; step("expectedTimeSeconds", (q) => (r.min === undefined || q.view.dna.expectedTimeSeconds >= r.min) && (r.max === undefined || q.view.dna.expectedTimeSeconds <= r.max)); }
  if (constraints.sourceTypes) step("sourceTypes", (q) => q.view.sourceType !== null && constraints.sourceTypes!.includes(q.view.sourceType));
  if (constraints.excludeQuestionIds) { const set = new Set(constraints.excludeQuestionIds); step("excludeQuestionIds", (q) => !set.has(q.view.id)); }

  const candidates = pool
    .map((q): SelectionCandidate => ({
      questionId: q.view.id,
      sectionName: q.view.dna.sectionName,
      conceptName: q.conceptName,
      patternFamilyName: q.view.dna.patternFamilyName,
      combinesWith: [...q.view.dna.combinesWithConcepts].sort(),
      testingModes: [...q.view.dna.testingModes].sort(),
      difficultyTier: q.view.dna.difficultyTier,
      noveltyLevel: q.view.dna.noveltyLevel,
      trapCode: q.view.dna.trapErrorTaxonomyCode,
      expectedTimeSeconds: q.view.dna.expectedTimeSeconds,
      timeBand: bandOf(q.view.dna.expectedTimeSeconds),
      validationState: q.view.validationState,
      sourceType: q.view.sourceType
    }))
    .sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0));
  return { examCode: snapshot.examCode, examVersion: snapshot.examVersion, constraints: applied, candidates, qualifying: summary.counted, excludedByQuality: summary.excluded, trace };
}

/**
 * The training-system bridge. Intersects a provider's OWN candidate list (any
 * shape with `question.questionId`, e.g. the `TrainingCandidateQuestion` the
 * Phase 5 providers consume) with a selection result, preserving the
 * provider's order. It decides nothing: the provider still owns what it does
 * with the candidates it is left with (and whether it is applicable at all).
 */
export function restrictCandidates<T extends { question: { questionId: string } }>(candidates: readonly T[], result: Pick<SelectionResult, "candidates">): T[] {
  const allowed = new Set(result.candidates.map((c) => c.questionId));
  return candidates.filter((c) => allowed.has(c.question.questionId));
}
