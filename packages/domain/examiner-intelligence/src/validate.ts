import { normalizeConceptNameKey } from "@ipmat/concept-graph";
import { getSyllabusPath, type ExamPack } from "@ipmat/exam-pack";
import { ALL_TESTING_MODES } from "@ipmat/examiner-lens";
import type { DifficultyTier, NoveltyLevel, ExamRelevance, ProvenanceSourceType, QuestionPatternFamilyData } from "@ipmat/question-engine";
import type {
  HistoricalDnaClassification,
  HistoricalIssue,
  HistoricalIssueCode,
  HistoricalQuestionRecord,
  HistoricalValidationResult
} from "./types.js";

/** Exhaustive records: adding a value to an upstream union fails to compile here until it is listed. */
const TIERS: Record<DifficultyTier, true> = { standard: true, advanced: true, hard: true, extreme: true, novel: true };
const NOVELTY: Record<NoveltyLevel, true> = { standard: true, novel_representation: true, novel_combination: true, novel_context: true };
const RELEVANCE: Record<ExamRelevance, true> = { core: true, peripheral: true, stretch: true };
const SOURCE_TYPES: Record<ProvenanceSourceType, true> = { original: true, licensed: true, public_domain: true, open_license: true, official: true, user_authorized: true };
export const DIFFICULTY_DIMENSION_KEYS = ["conceptualLoad", "computationalLoad", "trapDensity", "representationNovelty", "timePressure", "multiStepDepth"] as const;

const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
const norm = normalizeConceptNameKey;

export interface DnaValidationContext {
  /** The pack of the record's OWN exam. A record is only ever checked against its own exam's pack. */
  pack: ExamPack;
  patternFamilies: readonly QuestionPatternFamilyData[];
  /** `ErrorTaxonomy.code` values (the one shared trap vocabulary, D-012/D-013). */
  errorTaxonomyCodes: readonly string[];
}

class Issues {
  readonly list: HistoricalIssue[] = [];
  add(code: HistoricalIssueCode, field: string, message: string): void {
    this.list.push({ code, field, message });
  }
}

const hasDuplicates = (values: string[]): boolean => new Set(values.map(norm)).size !== values.length;

/**
 * Validates the structural DNA of a historical question against its exam's
 * pack and the existing vocabularies. Reports every problem; never throws.
 *
 * "Contradictory metadata" rules are deliberately limited to claims that
 * contradict themselves BY THEIR OWN DEFINITIONS (a combination of nothing, a
 * concept combined with itself). Difficulty is NOT cross-checked against
 * time, novelty or testing modes: a long question is not necessarily hard, a
 * novel one not necessarily difficult, a time-pressured one not necessarily
 * hard - those are independent dimensions (D-021).
 */
export function validateDnaClassification(dna: HistoricalDnaClassification, context: DnaValidationContext): HistoricalIssue[] {
  const out = new Issues();
  const { pack } = context;

  if (dna.examCode !== pack.examCode) out.add("exam_mismatch", "examCode", `DNA is for "${dna.examCode}" but is being checked against the "${pack.examCode}" pack`);

  const concepts = new Map(pack.concepts.map((c) => [norm(c.name), c]));
  const section = pack.sections.find((s) => norm(s.name) === norm(dna.sectionName));
  if (!section) out.add("unknown_section", "sectionName", `"${dna.sectionName}" is not a section of ${pack.examCode}`);

  const concept = concepts.get(norm(dna.conceptName));
  if (!concept) out.add("unknown_concept", "conceptName", `"${dna.conceptName}" is not a concept of ${pack.examCode}`);

  const chapterNodes = pack.syllabus.filter((n) => norm(n.name) === norm(dna.chapterName) && (!section || n.sectionKey === section.key));
  if (chapterNodes.length === 0) out.add("unknown_chapter", "chapterName", `"${dna.chapterName}" is not a syllabus node of section "${dna.sectionName}"`);
  else if (concept && !chapterNodes.some((n) => getSyllabusPath(pack, concept.syllabusNodeKey).some((p) => p.key === n.key))) {
    out.add("concept_not_in_chapter", "chapterName", `concept "${dna.conceptName}" is not located under "${dna.chapterName}" in the pack`);
  }

  for (const [field, names] of [["subconcepts", dna.subconcepts], ["prerequisites", dna.prerequisites], ["combinesWithConcepts", dna.combinesWithConcepts]] as const) {
    if (hasDuplicates(names)) out.add("duplicate_entries", field, `${field} contains duplicates`);
    for (const name of names) if (!concepts.has(norm(name))) out.add("unknown_concept", field, `"${name}" is not a concept of ${pack.examCode}`);
  }
  if (dna.combinesWithConcepts.some((n) => norm(n) === norm(dna.conceptName))) out.add("contradictory_metadata", "combinesWithConcepts", "a concept cannot be combined with itself");
  if (dna.prerequisites.some((n) => norm(n) === norm(dna.conceptName))) out.add("contradictory_metadata", "prerequisites", "a concept cannot be its own prerequisite");

  const family = context.patternFamilies.find((f) => norm(f.name) === norm(dna.patternFamilyName) && norm(f.conceptName) === norm(dna.conceptName));
  if (blank(dna.patternFamilyName)) out.add("missing_metadata", "patternFamilyName", "a pattern family is required");
  else if (!family) out.add("unknown_pattern_family", "patternFamilyName", `no pattern family "${dna.patternFamilyName}" exists for concept "${dna.conceptName}"`);
  if (blank(dna.skill)) out.add("missing_metadata", "skill", "a skill is required");

  if (!TIERS[dna.difficultyTier]) out.add("invalid_difficulty", "difficultyTier", `unknown difficulty tier "${String(dna.difficultyTier)}"`);
  const dims = dna.difficultyDimensions as unknown as Record<string, unknown> | undefined;
  if (!dims) out.add("missing_metadata", "difficultyDimensions", "difficulty dimensions are required");
  else {
    for (const key of DIFFICULTY_DIMENSION_KEYS) {
      const v = dims[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) out.add("invalid_difficulty", `difficultyDimensions.${key}`, `${key} must be a finite number in [0, 1]`);
    }
    for (const key of Object.keys(dims)) if (!(DIFFICULTY_DIMENSION_KEYS as readonly string[]).includes(key)) out.add("invalid_difficulty", `difficultyDimensions.${key}`, `unknown difficulty dimension "${key}"`);
  }
  if (!Number.isInteger(dna.expectedTimeSeconds) || dna.expectedTimeSeconds <= 0) out.add("invalid_expected_time", "expectedTimeSeconds", "expected time must be a positive whole number of seconds");

  if (!Array.isArray(dna.testingModes) || dna.testingModes.length === 0) out.add("invalid_testing_modes", "testingModes", "at least one testing mode is required");
  else {
    if (dna.testingModes.some((m) => !ALL_TESTING_MODES.includes(m))) out.add("invalid_testing_modes", "testingModes", "contains a mode outside the TestingMode vocabulary");
    if (new Set(dna.testingModes).size !== dna.testingModes.length) out.add("duplicate_entries", "testingModes", "testingModes contains duplicates");
    if (dna.testingModes.includes("combined") && dna.combinesWithConcepts.length === 0) out.add("contradictory_metadata", "testingModes", '"combined" testing mode with no combination concepts');
  }
  if (!NOVELTY[dna.noveltyLevel]) out.add("invalid_novelty", "noveltyLevel", `unknown novelty level "${String(dna.noveltyLevel)}"`);
  else if (dna.noveltyLevel === "novel_combination" && dna.combinesWithConcepts.length === 0) out.add("contradictory_metadata", "noveltyLevel", '"novel_combination" with no combination concepts');

  if (dna.trapErrorTaxonomyCode !== null && !context.errorTaxonomyCodes.includes(dna.trapErrorTaxonomyCode)) {
    out.add("unknown_trap", "trapErrorTaxonomyCode", `"${dna.trapErrorTaxonomyCode}" is not an ErrorTaxonomy code`);
  }
  return out.list;
}

const isoDate = (v: string): boolean => !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}/.test(v);

/**
 * Validates a whole historical record: identity, locator, rights, data origin,
 * annotation-state consistency, review, editorial relevance, and (when a
 * classification exists) its DNA. A record is only valid for the exam of the
 * pack it is checked against.
 */
export function validateHistoricalRecord(record: HistoricalQuestionRecord, context: DnaValidationContext): HistoricalValidationResult {
  const out = new Issues();
  if (blank(record.id)) out.add("invalid_record", "id", "id is required");
  if (record.examCode !== context.pack.examCode) out.add("exam_mismatch", "examCode", `record is for "${record.examCode}" but is being checked against the "${context.pack.examCode}" pack`);

  const { locator, source } = record;
  if (locator.year !== null && (!Number.isInteger(locator.year) || locator.year < 1900 || locator.year > 2100)) out.add("invalid_locator", "locator.year", "year must be a whole year between 1900 and 2100");
  for (const key of ["examVersion", "session", "questionLabel"] as const) {
    if (locator[key] !== null && blank(locator[key])) out.add("invalid_locator", `locator.${key}`, `${key} must be null or non-blank`);
  }

  if (!SOURCE_TYPES[source.sourceType]) out.add("invalid_source", "source.sourceType", `unknown source type "${String(source.sourceType)}"`);
  if (blank(source.sourceRef)) out.add("invalid_source", "source.sourceRef", "a source reference is required - every historical artifact must be traceable");

  if (record.dataOrigin === "real_source") {
    if (source.sourceType === "original") out.add("invalid_origin", "source.sourceType", '"original" is content authored by this project, not a historical source');
    if (source.sourceType !== "public_domain" && blank(source.licenseRef)) out.add("invalid_source", "source.licenseRef", "rights basis (licenseRef) is required unless the source is public domain - free-to-access is not free-to-copy");
    if (record.fixtureLabel !== null) out.add("invalid_origin", "fixtureLabel", "a real-source record must not carry a fixture label");
  } else if (record.dataOrigin === "fixture") {
    if (blank(record.fixtureLabel)) out.add("invalid_origin", "fixtureLabel", "a fixture must carry a label stating it is not real historical evidence");
    if (source.sourceType !== "original") out.add("invalid_origin", "source.sourceType", 'a fixture is authored by this project: its source type must be "original"');
    if (!String(source.sourceRef).startsWith("fixture:")) out.add("invalid_origin", "source.sourceRef", 'a fixture\'s sourceRef must start with "fixture:" so it can never be mistaken for a real source');
  } else {
    out.add("invalid_origin", "dataOrigin", `unknown data origin "${String(record.dataOrigin)}"`);
  }

  const { annotationState: state } = record;
  if (state === "raw_imported") {
    if (record.classification !== null || record.authorship !== null || record.review !== null || record.editorialRelevance !== null || record.proposedBy !== null) {
      out.add("invalid_state", "annotationState", "a raw_imported record carries no classification, authorship, review or editorial annotation");
    }
  } else if (state === "candidate_annotation" || state === "reviewed_validated") {
    if (record.classification === null) out.add("missing_metadata", "classification", `a ${state} record requires a classification`);
    if (record.authorship === null) out.add("missing_metadata", "authorship", `a ${state} record must say whether the classification is human or ai_assisted`);
    if (record.authorship === "ai_assisted" && blank(record.proposedBy)) out.add("invalid_state", "proposedBy", "an ai_assisted annotation must identify the proposing system");
    if (record.authorship === "human" && record.proposedBy !== null) out.add("invalid_state", "proposedBy", "proposedBy is only for ai_assisted annotations");
    if (state === "candidate_annotation" && record.review !== null) out.add("invalid_review", "review", "a candidate annotation has not been reviewed; it must not carry a review record");
    if (state === "reviewed_validated") {
      if (record.review === null) out.add("invalid_review", "review", "reviewed_validated requires a review record - an AI proposal never becomes authoritative on its own");
      else {
        if (blank(record.review.reviewedBy)) out.add("invalid_review", "review.reviewedBy", "a reviewer must be named");
        if (typeof record.review.reviewedAt !== "string" || !isoDate(record.review.reviewedAt)) out.add("invalid_review", "review.reviewedAt", "reviewedAt must be an ISO-8601 date");
      }
    }
  } else {
    out.add("invalid_state", "annotationState", `unknown annotation state "${String(state)}"`);
  }

  if (record.editorialRelevance !== null) {
    const e = record.editorialRelevance;
    if (!RELEVANCE[e.label] || blank(e.rationale) || blank(e.annotatedBy)) out.add("invalid_editorial_relevance", "editorialRelevance", "an editorial relevance annotation needs a known label, a rationale and an annotator");
  }

  if (record.classification !== null) out.list.push(...validateDnaClassification(record.classification, context));
  return { valid: out.list.length === 0, issues: out.list };
}
