import { createHash } from "node:crypto";
import { validateDnaClassification, type HistoricalDnaClassification } from "@ipmat/examiner-intelligence";
import type { ExamPack } from "@ipmat/exam-pack";
import {
  buildBlueprintFromCell,
  computeTaxonomyCellCoverage,
  type BuildBlueprintOptions,
  type ExamRelevance,
  type NoveltyLevel,
  type PatternTaxonomyCellData,
  type QuestionPatternFamilyData,
  type QuestionRefForCellCoverage
} from "@ipmat/question-engine";
import type { DnaSummary, GenerationSpec, SpecIssue } from "./types.js";

const NOVELTY: readonly NoveltyLevel[] = ["standard", "novel_representation", "novel_combination", "novel_context"];
const RELEVANCE: readonly ExamRelevance[] = ["core", "peripheral", "stretch"];
const ANSWER_FORMATS = ["multiple_choice", "numeric_entry"] as const;
const MAX_TRANSFORMATION_CHARS = 300;
const norm = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Recursively sorted, so key order never changes a serialization. Arrays keep their order (the caller normalizes set-valued fields first). */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(walk(value));
}

/** The spec's canonical form: the combination concepts are a SET (sorted); everything else is as given. The specId itself is excluded. */
export function canonicalSpecForm(spec: Omit<GenerationSpec, "specId">): string {
  return canonicalJson({ ...spec, blueprint: { ...spec.blueprint, combinationConcepts: [...spec.blueprint.combinationConcepts].sort() } });
}

/** The spec without its id (the id is a hash of exactly this). */
export function specBody(spec: GenerationSpec): Omit<GenerationSpec, "specId"> {
  const copy: Partial<GenerationSpec> = { ...spec };
  delete copy.specId;
  return copy as Omit<GenerationSpec, "specId">;
}

export function specIdFor(spec: Omit<GenerationSpec, "specId">): string {
  return `spec_${createHash("sha256").update(canonicalSpecForm(spec), "utf8").digest("hex").slice(0, 24)}`;
}

export interface BuildSpecOptions extends BuildBlueprintOptions {
  noveltyLevel?: NoveltyLevel;
  examRelevance?: ExamRelevance;
}

/**
 * One spec from one EXISTING taxonomy cell and its pattern family, through the
 * existing `buildBlueprintFromCell` (no AI). Defaults are the existing
 * defaults (`standard` novelty; `core` is an editorial label the caller should
 * set deliberately). Nothing about the cell is invented.
 */
export function buildGenerationSpec(cell: PatternTaxonomyCellData, family: QuestionPatternFamilyData, options: BuildSpecOptions): GenerationSpec {
  const blueprint = buildBlueprintFromCell(cell, family, options);
  const body = { blueprint, noveltyLevel: options.noveltyLevel ?? "standard", examRelevance: options.examRelevance ?? "core", provenanceSourceType: "original" as const };
  return { specId: specIdFor(body), ...body };
}

/**
 * Specs for the cells of one concept's family space that have NO question at all
 * (the existing `computeTaxonomyCellCoverage` status "uncovered"). It is a
 * deterministic plan over what is MAPPED - it makes no claim that the mapped
 * space is complete, and it does not rank cells by importance.
 */
export function planSpecsForUncoveredCells(input: {
  cells: readonly PatternTaxonomyCellData[];
  families: readonly QuestionPatternFamilyData[];
  existingQuestions: readonly QuestionRefForCellCoverage[];
  build: Omit<BuildSpecOptions, "idSuffix">;
}): GenerationSpec[] {
  const coverage = computeTaxonomyCellCoverage([...input.cells], [...input.existingQuestions]);
  const specs: GenerationSpec[] = [];
  input.cells.forEach((cell, index) => {
    if (coverage[index]!.status !== "uncovered") return;
    const family = input.families.find((f) => f.name === cell.patternFamilyName);
    if (family) specs.push(buildGenerationSpec(cell, family, { ...input.build, idSuffix: `cell${index}` }));
  });
  return specs.sort((a, b) => (a.specId < b.specId ? -1 : 1));
}

export interface SpecValidationContext {
  /** The pack of the spec's OWN exam. */
  pack: ExamPack;
  patternFamilies: readonly QuestionPatternFamilyData[];
  errorTaxonomyCodes: readonly string[];
}

// eslint-disable-next-line no-control-regex -- detecting control characters in caller-supplied free text is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Deterministic specification checks (no model, no I/O). Reuses the existing
 * DNA classification validator (the SAME one the authoring gates use) for exam /
 * section / chapter / concept / pattern / tier / novelty / time / testing-mode /
 * trap vocabulary, and adds only the cross-field rules the existing
 * `QuestionPatternFamilyData` already documents ("the space this family can
 * legitimately draw from"). A spec that fails here is never sent to a model.
 */
export function validateGenerationSpec(spec: GenerationSpec, ctx: SpecValidationContext): SpecIssue[] {
  try {
    return validateGenerationSpecUnsafe(spec, ctx);
  } catch {
    // Validation never throws on a malformed spec: it reports, and a malformed spec never reaches a model.
    return [{ code: "malformed_spec", field: "spec", message: "the spec is malformed and could not be evaluated" }];
  }
}

function validateGenerationSpecUnsafe(spec: GenerationSpec, ctx: SpecValidationContext): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const add = (code: string, field: string, message: string) => issues.push({ code, field, message });
  const bp = spec?.blueprint;
  if (!spec || typeof spec !== "object" || !bp || typeof bp !== "object") return [{ code: "malformed_spec", field: "spec", message: "a generation spec with a blueprint is required" }];

  if (specIdFor(specBody(spec)) !== spec.specId) add("spec_id_mismatch", "specId", "the specId is not the hash of this spec's content");
  if (spec.provenanceSourceType !== "original") add("source_backed_generation_unsupported", "provenanceSourceType", "generation uses no external source text; only \"original\" is supported");
  if (!NOVELTY.includes(spec.noveltyLevel)) add("invalid_novelty", "noveltyLevel", `unknown novelty level "${String(spec.noveltyLevel)}"`);
  if (!RELEVANCE.includes(spec.examRelevance)) add("invalid_exam_relevance", "examRelevance", `unknown exam relevance "${String(spec.examRelevance)}" (an editorial label)`);
  if (!ANSWER_FORMATS.includes(bp.answerFormat)) add("invalid_answer_format", "blueprint.answerFormat", "answerFormat must be multiple_choice or numeric_entry");
  if (bp.difficultyCalibrationStatus !== "provisional") add("calibration_claim_unsupported", "blueprint.difficultyCalibrationStatus", "no difficulty calibration exists in this repository; the status must be \"provisional\"");
  if (bp.examCode !== ctx.pack.examCode) add("exam_mismatch", "blueprint.examCode", `the spec is for "${bp.examCode}" but is being checked against the "${ctx.pack.examCode}" pack`);

  const t = bp.transformationDescription;
  if (t !== null && t !== undefined && (typeof t !== "string" || t.length > MAX_TRANSFORMATION_CHARS || CONTROL.test(t))) add("invalid_transformation_text", "blueprint.transformationDescription", `the transformation text must be at most ${MAX_TRANSFORMATION_CHARS} characters with no control characters`);

  // Reuse the authoring gates' own DNA vocabulary check.
  let dnaIssues: Array<{ code: string; field: string; message: string }> = [];
  try {
    dnaIssues = validateDnaClassification(requestedClassification(spec), { pack: ctx.pack, patternFamilies: ctx.patternFamilies, errorTaxonomyCodes: ctx.errorTaxonomyCodes });
  } catch {
    add("malformed_spec", "blueprint", "the blueprint is malformed and could not be evaluated");
  }
  for (const i of dnaIssues) add(i.code, i.field, i.message);

  // Cross-field rules from the family's documented space.
  const family = ctx.patternFamilies.find((f) => f.name === bp.patternFamilyName);
  if (family) {
    if (norm(family.conceptName) !== norm(bp.conceptName)) add("concept_pattern_mismatch", "blueprint.patternFamilyName", `pattern family "${family.name}" belongs to concept "${family.conceptName}", not "${bp.conceptName}"`);
    if (bp.trapErrorTaxonomyCode !== null && !family.potentialTrapErrorTaxonomyCodes.includes(bp.trapErrorTaxonomyCode)) add("trap_not_in_pattern_family", "blueprint.trapErrorTaxonomyCode", `trap "${bp.trapErrorTaxonomyCode}" is not among this family's potential traps`);
    for (const mode of bp.testingModes) if (!family.potentialTestingModes.includes(mode)) add("testing_mode_not_in_pattern_family", "blueprint.testingModes", `testing mode "${mode}" is not among this family's potential modes`);
    for (const c of bp.combinationConcepts) if (!family.potentialCombinationConcepts.some((p) => norm(p) === norm(c))) add("combination_not_in_pattern_family", "blueprint.combinationConcepts", `combination concept "${c}" is not among this family's potential combinations`);
  }
  return issues;
}

/** The requested DNA in the existing classification shape (used for validation and for the trace). */
export function requestedClassification(spec: GenerationSpec): HistoricalDnaClassification {
  const bp = spec.blueprint;
  return {
    examCode: bp.examCode,
    sectionName: bp.sectionName,
    chapterName: bp.chapterName,
    conceptName: bp.conceptName,
    subconcepts: [],
    prerequisites: [...bp.prerequisites],
    combinesWithConcepts: [...bp.combinationConcepts],
    patternFamilyName: bp.patternFamilyName,
    skill: bp.targetSkill,
    difficultyTier: bp.difficultyTier,
    difficultyDimensions: { ...bp.difficultyDimensions },
    noveltyLevel: spec.noveltyLevel,
    expectedTimeSeconds: bp.expectedTimeSeconds,
    testingModes: [...bp.testingModes],
    trapErrorTaxonomyCode: bp.trapErrorTaxonomyCode
  } as HistoricalDnaClassification;
}

export function summarizeRequestedDna(spec: GenerationSpec): DnaSummary {
  const bp = spec.blueprint;
  return {
    examCode: bp.examCode,
    sectionName: bp.sectionName,
    chapterName: bp.chapterName,
    conceptName: bp.conceptName,
    patternFamilyName: bp.patternFamilyName,
    skill: bp.targetSkill,
    combinationConcepts: [...bp.combinationConcepts].sort(),
    difficultyTier: bp.difficultyTier,
    difficultyDimensions: { ...bp.difficultyDimensions },
    noveltyLevel: spec.noveltyLevel,
    examRelevance: spec.examRelevance,
    expectedTimeSeconds: bp.expectedTimeSeconds,
    testingModes: [...bp.testingModes],
    trapErrorTaxonomyCode: bp.trapErrorTaxonomyCode
  };
}
