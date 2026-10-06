import { percentagesConceptGraph } from "@ipmat/concept-graph";
import type { AiCompletion, AiProvider } from "@ipmat/ai";
import { ContentAuthoringService, InMemoryQuestionAuthoringRepository, createDraft, type NewQuestionInput } from "@ipmat/content-authoring";
import { InMemoryExamPackRepository, ipmatIndoreExamPack, type ExamPack, type PackConcept, type PackProvenance } from "@ipmat/exam-pack";
import {
  DEFAULT_SINGLE_RUN_LIMITS,
  percentagesPatternFamilies,
  percentagesReversePercentageExample,
  percentagesTaxonomyCells,
  passingJudge,
  validGeneratedCandidate,
  validReverification,
  type GenerationLimits,
  type PatternTaxonomyCellData
} from "@ipmat/question-engine";
import { InMemoryGenerationTraceSink, buildGenerationSpec, createQuestionGenerationService, type GenerationSpec } from "../src/index.js";

/**
 * EVERYTHING here is a labelled TEST FIXTURE: synthetic questions and model
 * outputs invented for these tests (the candidate below is the repository's own
 * original demonstration content, D-016). No live model is ever called.
 */

export const ERROR_TAXONOMY_CODES = ["base_confusion", "sign_error", "misread_question", "careless_arithmetic", "successive_change_error", "percentage_point_confusion"];
export const EXAM = "IPMAT_INDORE";

const cellByTier = (tier: string): PatternTaxonomyCellData => {
  const c = percentagesTaxonomyCells.find((x) => x.difficultyTier === tier);
  if (!c) throw new Error(`no ${tier} cell`);
  return c;
};
const familyOf = (cell: PatternTaxonomyCellData) => percentagesPatternFamilies.find((f) => f.name === cell.patternFamilyName)!;

export const advancedCell = percentagesTaxonomyCells.find((c) => c.coverageStatus === "covered")!;
export const hardCell = cellByTier("hard");

export const makeSpec = (cell: PatternTaxonomyCellData = advancedCell, over: { idSuffix?: string; noveltyLevel?: "standard" | "novel_representation" | "novel_combination" | "novel_context"; examRelevance?: "core" | "peripheral" | "stretch"; transformationDescription?: string | null } = {}): GenerationSpec =>
  buildGenerationSpec(cell, familyOf(cell), {
    examCode: EXAM,
    sectionName: "Quant",
    chapterName: "Percentages",
    answerFormat: "multiple_choice",
    transformationDescription: over.transformationDescription === undefined ? "Hide the original value; express it only via a ratio multiple of a second, stated quantity." : over.transformationDescription,
    idSuffix: over.idSuffix ?? "u3",
    noveltyLevel: over.noveltyLevel,
    examRelevance: over.examRelevance
  });

/** A raw model output for a spec: the repository's own valid candidate re-pointed at this spec's blueprint (and the cell's tier/modes/trap). */
export const candidateFor = (spec: GenerationSpec, over: Record<string, unknown> = {}, dnaOver: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...validGeneratedCandidate,
  blueprintId: spec.blueprint.id,
  questionDna: {
    ...validGeneratedCandidate.questionDna,
    conceptName: spec.blueprint.conceptName,
    patternFamilyName: spec.blueprint.patternFamilyName,
    skill: spec.blueprint.targetSkill,
    difficultyTier: spec.blueprint.difficultyTier,
    difficultyDimensions: spec.blueprint.difficultyDimensions,
    combinesWithConcepts: spec.blueprint.combinationConcepts,
    testingModes: spec.blueprint.testingModes,
    trapErrorTaxonomyCode: spec.blueprint.trapErrorTaxonomyCode,
    expectedTimeSeconds: spec.blueprint.expectedTimeSeconds,
    noveltyLevel: spec.noveltyLevel,
    examRelevance: spec.examRelevance,
    ...dnaOver
  },
  ...over
});

export const j = (v: unknown): string => JSON.stringify(v);
export const GOOD = (spec: GenerationSpec, over: Record<string, unknown> = {}, dnaOver: Record<string, unknown> = {}): string[] => [j(candidateFor(spec, over, dnaOver)), j(validReverification), j(passingJudge)];

/** Deterministic provider double. Vendor-neutral by construction; `apiKey` exists only to prove it is never copied into a trace. */
export type Behaviour = string | { throws: Error } | { hangMs: number };
export class ScriptedProvider implements AiProvider {
  readonly name: string;
  readonly model: string;
  readonly apiKey = "sk-LIVE-SECRET-DO-NOT-LEAK";
  readonly prompts: Array<{ systemPrompt: string; userPrompt: string }> = [];
  constructor(private readonly script: Behaviour[], opts: { name?: string; model?: string; usage?: { inputTokens: number; outputTokens: number } } = {}) {
    this.name = opts.name ?? "scripted";
    this.model = opts.model ?? "fixture-deterministic-v1";
    this.usage = opts.usage ?? { inputTokens: 0, outputTokens: 0 };
  }
  private readonly usage: { inputTokens: number; outputTokens: number };
  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<AiCompletion> {
    this.prompts.push({ systemPrompt: input.systemPrompt, userPrompt: input.userPrompt });
    const next = this.script.shift();
    if (next === undefined) throw new Error("ScriptedProvider: no behaviour left");
    if (typeof next === "string") return { rawText: next, usage: this.usage, latencyMs: 1 };
    if ("throws" in next) throw next.throws;
    await new Promise((r) => setTimeout(r, next.hangMs));
    return { rawText: "{}", usage: null, latencyMs: next.hangMs };
  }
}

export const NO_RETRY: GenerationLimits = { ...DEFAULT_SINGLE_RUN_LIMITS, maxRetries: 0 };

const prov = (): PackProvenance => ({ kind: "authored", sourceRef: "test fixture", licenseRef: null, reviewState: "unvalidated", reviewedBy: null, note: null });
const concept = (key: string, name: string): PackConcept => ({ key, name, syllabusNodeKey: "sec/chap", description: name, status: "curated", skills: [], patternFamilyRefs: [], importance: null, provenance: prov() });
/** A second exam whose concept names overlap IPMAT's - for cross-exam isolation. */
export const otherExamPack = (): ExamPack => ({
  examCode: "OTHER_EXAM",
  packVersion: "1",
  name: "Other Exam",
  provenance: prov(),
  sections: [{ key: "sec", name: "Quant", order: 1, provenance: prov() }],
  syllabus: [{ key: "sec/chap", sectionKey: "sec", parentKey: null, name: "Percentages", order: 1, provenance: prov() }],
  concepts: [concept("percentages", "Percentages"), concept("ratio", "Ratio")],
  relations: [],
  terminology: []
});

export function makeEnv(script: Behaviour[] = [], opts: { limits?: GenerationLimits; timeoutMs?: number; provider?: ScriptedProvider; traces?: InMemoryGenerationTraceSink } = {}) {
  const repo = new InMemoryQuestionAuthoringRepository();
  const packs = new InMemoryExamPackRepository([ipmatIndoreExamPack, otherExamPack()]);
  const authoring = new ContentAuthoringService({ questions: repo, packs, patternFamiliesFor: (code) => (code === EXAM ? percentagesPatternFamilies : []), errorTaxonomyCodes: ERROR_TAXONOMY_CODES });
  const provider = opts.provider ?? new ScriptedProvider(script);
  const traces = opts.traces ?? new InMemoryGenerationTraceSink();
  const service = createQuestionGenerationService({
    provider,
    authoring,
    questions: repo,
    packs,
    patternFamiliesFor: (code) => (code === EXAM ? percentagesPatternFamilies : []),
    errorTaxonomyCodes: ERROR_TAXONOMY_CODES,
    graphFor: () => percentagesConceptGraph,
    traces,
    now: () => new Date("2026-10-06T10:00:00.000Z"),
    limits: opts.limits ?? NO_RETRY,
    timeoutMs: opts.timeoutMs
  });
  return { repo, packs, authoring, provider, traces, service };
}

/** An authored question of the repository's demonstration DNA, for seeding "existing" content. */
export const existingInput = (id: string, body: string, over: Partial<NewQuestionInput> = {}, examCode = EXAM): NewQuestionInput => {
  const { dna, content } = percentagesReversePercentageExample;
  const d: Record<string, unknown> = { ...dna };
  delete d.provenanceSourceType;
  delete d.validationState;
  return {
    id,
    dna: { ...(d as NewQuestionInput["dna"]), examCode },
    content: { body, answerFormat: "multiple_choice", options: [...content.options], correctAnswer: content.correctAnswer, solutionSteps: [...content.solutionSteps], groundTruthDerivation: { computation: "(3 * 8000) / 1.20", expectedAnswer: 20000 } },
    source: { sourceType: "original", sourceRef: null, licenseRef: null, attributedTo: null },
    origin: "human_authored",
    ...over
  };
};
export const seed = async (repo: InMemoryQuestionAuthoringRepository, id: string, body: string, examCode = EXAM) => repo.createDraft(createDraft(existingInput(id, body, {}, examCode)));

export const REVIEW = { reviewedBy: "fixture-reviewer", reviewedAt: "2026-10-06T10:00:00.000Z", notes: "internal note", answerVerifiedByReviewer: false, reviewedAsDistinct: false };
