import { createHash } from "node:crypto";
import type { ConceptGraph } from "@ipmat/concept-graph";
import { AiGenerationError, type AiProvider, type AiResultMetadata, type QuestionCandidateAiOutput } from "@ipmat/ai";
import {
  computeContentFingerprint,
  proposeAiQuestion,
  type ContentAuthoringService,
  type GateReport,
  type NewQuestionInput,
  type QuestionAuthoringRepository,
  type QuestionInstanceDna
} from "@ipmat/content-authoring";
import { ExamPackInvalidError, validateExamPack, type ExamPackRepository } from "@ipmat/exam-pack";
import {
  DEFAULT_SINGLE_RUN_LIMITS,
  requiresHumanReview,
  runGenerationPipeline,
  validateGenerationLimits,
  type GenerationLimits,
  type GenerationPipelineResult,
  type QuestionPatternFamilyData
} from "@ipmat/question-engine";
import type { ValidationResult } from "@ipmat/validation";
import { canonicalJson, specIdFor, summarizeRequestedDna, validateGenerationSpec } from "./spec.js";
import type { GenerationTraceSink } from "./trace.js";
import type { BatchOutcome, DnaSummary, GenerationOutcome, GenerationOutcomeKind, GenerationSpec, GenerationTrace, Reason, TraceCall } from "./types.js";

export interface QuestionGenerationDeps {
  /** Any `@ipmat/ai` provider. Injected - this package names no vendor, reads no environment, holds no key. */
  provider: AiProvider;
  /** The existing authoring service: the ONLY path a candidate takes toward publication. */
  authoring: ContentAuthoringService;
  /** The same repository the authoring service uses (exam-scoped identity references for the prompt's duplicate screen and read-back). */
  questions: QuestionAuthoringRepository;
  packs: ExamPackRepository;
  patternFamiliesFor: (examCode: string) => readonly QuestionPatternFamilyData[];
  errorTaxonomyCodes: readonly string[];
  graphFor: (examCode: string) => ConceptGraph;
  traces?: GenerationTraceSink;
  now?: () => Date;
  /** Per model call. Defaults to the pipeline's own default (30 s). */
  timeoutMs?: number;
  /** Retries inside one call. Defaults to the existing single-run limits. */
  limits?: GenerationLimits;
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const codes = (r: ValidationResult | null): string[] => (r ? r.issues.map((i) => i.code) : []);

/**
 * The generation engine. It deliberately exposes NO publish operation: the only
 * thing it can leave behind is a draft, an `ai_validated` candidate or a
 * rejected row. Publication stays with `ContentAuthoringService.publish`, which
 * re-evaluates every gate.
 */
export function createQuestionGenerationService(deps: QuestionGenerationDeps) {
  const now = deps.now ?? (() => new Date());
  const singleRun: GenerationLimits = deps.limits ?? DEFAULT_SINGLE_RUN_LIMITS;

  async function loadPack(examCode: string) {
    const pack = await deps.packs.findByExamCode(examCode);
    if (!pack) return { pack: null, issue: { code: "unknown_exam", field: "blueprint.examCode", message: `no exam pack for "${examCode}"` } as Reason };
    const valid = validateExamPack(pack);
    if (!valid.valid) return { pack: null, issue: { code: "exam_pack_invalid", field: "blueprint.examCode", message: new ExamPackInvalidError(examCode, valid.issues.filter((i) => i.severity === "error")).message.slice(0, 200) } as Reason };
    return { pack, issue: null };
  }

  function baseTrace(spec: GenerationSpec, outcome: GenerationOutcomeKind, over: Partial<GenerationTrace> = {}): GenerationTrace {
    const requested = safeSummary(spec);
    return {
      traceId: `gen_${sha([spec?.specId, deps.provider.name, deps.provider.model, outcome].join("|")).slice(0, 24)}`,
      specId: spec?.specId ?? "unknown",
      at: now().toISOString(),
      outcome,
      requestedDna: requested,
      modelClaimedDna: null,
      recordedDna: null,
      dnaDifferences: [],
      difficultyCalibration: "provisional",
      provider: { name: deps.provider.name, model: deps.provider.model },
      calls: [],
      estimatedCostUsd: 0,
      pipelineStatus: null,
      pipelineChecks: null,
      compliance: null,
      identity: { exactDuplicateOf: null, nearDuplicateFlagged: false },
      provenance: null,
      questionId: null,
      validationState: null,
      gates: null,
      reviewRequired: false,
      reviewReasons: [],
      publishable: false,
      whyNotPublishable: [],
      reasons: [],
      ...over
    };
  }

  async function finish(trace: GenerationTrace, extra: { existingQuestionId?: string | null } = {}): Promise<GenerationOutcome> {
    let traceRecorded = true;
    try {
      await deps.traces?.record(trace);
    } catch {
      traceRecorded = false; // the trace is still returned to the caller; a sink failure never changes the outcome
    }
    return { kind: trace.outcome, specId: trace.specId, questionId: trace.questionId, existingQuestionId: extra.existingQuestionId ?? null, reasons: trace.reasons, trace, traceRecorded };
  }

  function callsOf(result: GenerationPipelineResult): TraceCall[] {
    const out: TraceCall[] = [];
    const add = (task: string, m: AiResultMetadata | null) => {
      if (m) out.push({ task, promptVersion: m.promptVersion, success: m.success, attempts: m.attempts, latencyMs: m.latencyMs, tokenUsage: m.tokenUsage, estimatedCostUsd: m.estimatedCostUsd });
    };
    add("question-generation", result.metadata.generation);
    add("answer-reverification", result.metadata.reverification);
    add("validation-judge", result.metadata.judge);
    return out;
  }
  const costOf = (calls: TraceCall[]): number => calls.reduce((s, c) => s + (c.estimatedCostUsd ?? 0), 0);

  /** Spec compliance the existing blueprint check does not cover: the two DNA fields a blueprint does not carry. */
  function specCompliance(spec: GenerationSpec, candidate: QuestionCandidateAiOutput): Reason[] {
    const out: Reason[] = [];
    const dna = candidate.questionDna;
    if (dna.noveltyLevel !== spec.noveltyLevel) out.push({ code: "novelty_drift", field: "questionDna.noveltyLevel", message: `requested novelty "${spec.noveltyLevel}" but the candidate claims "${dna.noveltyLevel}"` });
    if (dna.examRelevance !== spec.examRelevance) out.push({ code: "relevance_drift", field: "questionDna.examRelevance", message: `requested relevance "${spec.examRelevance}" but the candidate claims "${dna.examRelevance}"` });
    // The existing structure checks accept a one-option "multiple choice"; a question with a single option is not a choice, so it is refused here (a minimum of two - no larger count is invented).
    if (candidate.answerFormat === "multiple_choice" && (candidate.options ?? []).length < 2) out.push({ code: "too_few_options", field: "options", message: "a multiple-choice question needs at least two options" });
    if (candidate.answerFormat !== spec.blueprint.answerFormat) out.push({ code: "answer_format_drift", field: "answerFormat", message: `requested "${spec.blueprint.answerFormat}" but the candidate is "${candidate.answerFormat}"` });
    return out;
  }

  /**
   * ONLY content and the spec's own DNA flow into the authoring draft. The
   * model's `reasoning`, `explanation`, claimed DNA, blueprint echo and any extra
   * field are dropped here; nothing the model said about the question's
   * metadata is recorded - the spec's is (after compliance proved they agree).
   */
  function toAuthoredInput(spec: GenerationSpec, candidate: QuestionCandidateAiOutput, reDerivedAnswer: string | null, traceId: string): Omit<NewQuestionInput, "origin"> {
    const bp = spec.blueprint;
    const dna: QuestionInstanceDna = {
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
      examRelevance: spec.examRelevance,
      expectedTimeSeconds: bp.expectedTimeSeconds,
      testingModes: [...bp.testingModes],
      trapErrorTaxonomyCode: bp.trapErrorTaxonomyCode
    };
    const fingerprint = computeContentFingerprint(bp.examCode, candidate.stem, candidate.options ?? []);
    return {
      id: `gq_${sha(`${spec.specId}|${fingerprint}`).slice(0, 24)}`,
      dna,
      content: {
        body: candidate.stem,
        answerFormat: candidate.answerFormat,
        options: candidate.options ? [...candidate.options] : [],
        correctAnswer: candidate.correctAnswer,
        solutionSteps: [...candidate.solutionSteps],
        groundTruthDerivation: { computation: candidate.groundTruthDerivation.computation, expectedAnswer: candidate.groundTruthDerivation.expectedAnswer }
      },
      // "original": produced from a structured specification with no external source text. The reference names the generation record.
      source: { sourceType: "original", sourceRef: `ai-generation:${traceId}`, licenseRef: null, attributedTo: null },
      // The independent re-derivation is the pipeline's SECOND, separate call - never the generator's own answer.
      independentReverification: reDerivedAnswer === null ? null : { derivedAnswer: reDerivedAnswer }
    };
  }

  function summarizeRecorded(dna: QuestionInstanceDna): DnaSummary {
    return {
      examCode: dna.examCode,
      sectionName: dna.sectionName,
      chapterName: dna.chapterName,
      conceptName: dna.conceptName,
      patternFamilyName: dna.patternFamilyName,
      skill: dna.skill,
      combinationConcepts: [...dna.combinesWithConcepts].sort(),
      difficultyTier: dna.difficultyTier,
      difficultyDimensions: { ...dna.difficultyDimensions },
      noveltyLevel: dna.noveltyLevel,
      examRelevance: dna.examRelevance,
      expectedTimeSeconds: dna.expectedTimeSeconds,
      testingModes: [...dna.testingModes],
      trapErrorTaxonomyCode: dna.trapErrorTaxonomyCode
    };
  }

  const diff = (a: DnaSummary, b: DnaSummary): string[] =>
    (Object.keys(a) as Array<keyof DnaSummary>).filter((k) => canonicalJson(a[k]) !== canonicalJson(b[k])).map(String);

  function publicationExplanation(report: GateReport | null, state: string | null): string[] {
    const why: string[] = [];
    if (report) {
      for (const g of report.gates) if (g.status === "failed" || g.status === "requires_human") for (const r of g.reasons) why.push(`${g.status}:${g.gate}:${r.code}`);
    }
    if (state === "draft") why.push("lifecycle:not_yet_validated");
    if (state === "rejected") why.push("lifecycle:rejected");
    if (state === "ai_validated" && why.length === 0) why.push("lifecycle:awaiting_explicit_publish_call");
    return why;
  }

  /** One spec -> at most one stored candidate. Never throws for a content problem; it reports. */
  async function generateOne(spec: GenerationSpec): Promise<GenerationOutcome> {
    // 1. Spec first - no model call unless the spec is valid and exam-scoped.
    const examCode = spec?.blueprint?.examCode;
    const { pack, issue } = typeof examCode === "string" ? await loadPack(examCode) : { pack: null, issue: { code: "malformed_spec", field: "spec", message: "a spec with an exam is required" } as Reason };
    const specIssues: Reason[] = issue ? [issue] : pack ? validateGenerationSpec(spec, { pack, patternFamilies: deps.patternFamiliesFor(examCode), errorTaxonomyCodes: deps.errorTaxonomyCodes }) : [];
    if (specIssues.length > 0) return finish(baseTrace(spec, "spec_invalid", { reasons: specIssues }));

    // 2. Exam-scoped existing identities (never another exam's) for the pipeline's duplicate screen.
    const identities = await deps.questions.listIdentityRefs(examCode);
    const stems = identities.filter((e) => e.validationState !== "rejected").map((e) => e.body);

    // 3. The EXISTING Phase 3 pipeline: generate -> structural -> recompute -> independent re-derivation -> judge.
    const result = await runGenerationPipeline({
      blueprint: spec.blueprint,
      aiProvider: deps.provider,
      graph: deps.graphFor(examCode),
      existingQuestionStems: stems,
      provenanceSourceType: spec.provenanceSourceType,
      limits: singleRun,
      requested: { noveltyLevel: spec.noveltyLevel, examRelevance: spec.examRelevance },
      timeoutMs: deps.timeoutMs
    });
    const calls = callsOf(result);
    const pipelineChecks = Object.fromEntries(Object.entries(result.checks).map(([name, r]) => [name, { valid: r.valid, codes: codes(r) }]));
    const common = { calls, estimatedCostUsd: costOf(calls), pipelineStatus: result.status, pipelineChecks };

    if (!result.candidate) {
      return finish(baseTrace(spec, "generation_failed", { ...common, reasons: result.rejectionReasons.map((r) => ({ code: r.code, field: r.field, message: r.message })) }));
    }
    const candidate = result.candidate;
    const claimed: Partial<DnaSummary> = {
      conceptName: candidate.questionDna.conceptName,
      patternFamilyName: candidate.questionDna.patternFamilyName,
      difficultyTier: candidate.questionDna.difficultyTier,
      noveltyLevel: candidate.questionDna.noveltyLevel,
      examRelevance: candidate.questionDna.examRelevance,
      expectedTimeSeconds: candidate.questionDna.expectedTimeSeconds,
      testingModes: [...candidate.questionDna.testingModes],
      combinationConcepts: [...candidate.questionDna.combinesWithConcepts].sort(),
      trapErrorTaxonomyCode: candidate.questionDna.trapErrorTaxonomyCode
    };

    // 4. Blocking checks. A near-duplicate is NOT blocking here: the existing authoring identity gate routes it to a human.
    const compliance = specCompliance(spec, candidate);
    const blocking: Reason[] = [
      ...(["structural", "computation", "reverification", "judge"] as const).flatMap((name) => result.checks[name].issues.map((i) => ({ code: i.code, field: `${name}.${i.field}`, message: i.message }))),
      ...compliance
    ];
    const withChecks = { ...common, modelClaimedDna: claimed, compliance: { valid: compliance.length === 0, codes: compliance.map((c) => c.code) } };

    // 5. File it as an authoring DRAFT (ai_generated). An exact duplicate is refused; nothing is merged or mutated.
    const traceId = `gen_${sha([spec.specId, deps.provider.name, deps.provider.model, computeContentFingerprint(examCode, candidate.stem, candidate.options ?? [])].join("|")).slice(0, 24)}`;
    const input = proposeAiQuestion(toAuthoredInput(spec, candidate, result.reDerivedAnswer, traceId));
    let created: { id: string; alreadyExisted: boolean };
    try {
      created = await createDraftWithFreshId(input);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "persistence_error";
      return finish(baseTrace(spec, "not_storable", { ...withChecks, traceId, reasons: [{ code, field: "storage", message: error instanceof Error ? error.message.slice(0, 200) : "the candidate could not be stored" }, ...blocking] }));
    }
    if (created.alreadyExisted) {
      return finish(
        baseTrace(spec, "exact_duplicate", { ...withChecks, traceId, identity: { exactDuplicateOf: created.id, nearDuplicateFlagged: false }, reasons: [{ code: "exact_duplicate", field: "content.body", message: `identical to existing question ${created.id}; one logical question has one identity` }] }),
        { existingQuestionId: created.id }
      );
    }
    const provenance = { origin: "ai_generated" as const, sourceType: "original" as const, sourceRef: input.source.sourceRef };

    // 6. A failed blocking check rejects the stored candidate (terminal, traceable). It is never edited into shape.
    if (blocking.length > 0) {
      const rejected = await deps.authoring.reject(created.id);
      return finish(await decorate(spec, rejected.id, baseTrace(spec, "rejected_by_checks", { ...withChecks, traceId, provenance, reasons: blocking })));
    }

    // 7. The existing 11 authoring gates (draft -> ai_validated iff no gate FAILED).
    const validation = await deps.authoring.validate(created.id);
    const outcome: GenerationOutcomeKind = validation.advanced ? "ai_validated_awaiting_review" : "draft_failed_gates";
    const nearDuplicate = validation.report.gates.some((g) => g.gate === "identity" && g.reasons.some((r) => r.code === "near_duplicate"));
    const reasons: Reason[] = validation.report.gates.flatMap((g) => (g.status === "failed" ? g.reasons : []));
    return finish(await decorate(spec, created.id, baseTrace(spec, outcome, { ...withChecks, traceId, provenance, reasons, gates: validation.report, identity: { exactDuplicateOf: null, nearDuplicateFlagged: nearDuplicate } })));
  }

  /**
   * The id is deterministic in (spec, content), so an earlier REJECTED row with the
   * same wording owns that id. A rejected row never blocks re-generating the same
   * wording (the existing identity rule), so the new candidate takes a numbered id;
   * a live row with that id is never overwritten (the repository refuses it).
   */
  async function createDraftWithFreshId(input: ReturnType<typeof proposeAiQuestion>): Promise<{ id: string; alreadyExisted: boolean }> {
    for (let n = 1; n <= 5; n++) {
      const candidate = n === 1 ? input : { ...input, id: `${input.id}_r${n}` };
      try {
        return await deps.questions.createDraft(candidate);
      } catch (error) {
        const existing = await deps.questions.findById(candidate.id);
        if (existing && existing.validationState === "rejected" && n < 5) continue;
        throw error;
      }
    }
    throw new Error("unreachable");
  }

  /** Fills in what was actually STORED (read back), the review requirement and the publishability explanation. */
  async function decorate(spec: GenerationSpec, id: string, trace: GenerationTrace): Promise<GenerationTrace> {
    const stored = await deps.questions.findById(id);
    if (!stored) return { ...trace, questionId: id };
    const recorded = summarizeRecorded(stored.dna);
    const report = trace.gates ?? (await deps.authoring.gateReport(id));
    const reviewReasons = [
      ...(requiresHumanReview(stored.dna.difficultyTier) ? [`tier_requires_human_review:${stored.dna.difficultyTier}`] : []),
      ...report.gates.filter((g) => g.status === "requires_human").flatMap((g) => g.reasons.map((r) => `${g.gate}:${r.code}`))
    ];
    return {
      ...trace,
      questionId: id,
      validationState: stored.validationState,
      recordedDna: recorded,
      dnaDifferences: diff(summarizeRequestedDna(spec), recorded),
      gates: report,
      reviewRequired: reviewReasons.length > 0,
      reviewReasons,
      publishable: report.publishable,
      whyNotPublishable: report.publishable ? [] : publicationExplanation(report, stored.validationState)
    };
  }

  /**
   * A deterministic batch: specs are processed in `specId` order (ties by input
   * order), sequentially, so each candidate is screened against everything
   * stored before it (a repeat within the batch is an exact duplicate through
   * the existing identity check, not a second system). EVERY input produces
   * exactly one outcome - nothing is dropped, merged or silently skipped. The
   * existing limits bound the run, including the running estimated budget.
   */
  async function generateBatch(specs: readonly GenerationSpec[], limits: GenerationLimits): Promise<BatchOutcome> {
    validateGenerationLimits(limits);
    if (limits.maxCandidatesPerBlueprint !== 1) throw new Error("only one candidate per spec is supported (a second would be a duplicate by construction)");
    if (specs.length > limits.maxBlueprints) throw new Error(`a batch of ${specs.length} specs exceeds maxBlueprints (${limits.maxBlueprints})`);
    const ordered = specs.map((spec, index) => ({ spec, index })).sort((a, b) => (a.spec?.specId ?? "") < (b.spec?.specId ?? "") ? -1 : (a.spec?.specId ?? "") > (b.spec?.specId ?? "") ? 1 : a.index - b.index);
    const seen = new Set<string>();
    const outcomes: GenerationOutcome[] = [];
    let spent = 0;
    for (const { spec } of ordered) {
      if (spec?.specId && seen.has(spec.specId)) {
        outcomes.push(await finish(baseTrace(spec, "duplicate_spec_in_batch", { reasons: [{ code: "duplicate_spec_in_batch", field: "specId", message: "an identical spec appeared earlier in this batch" }] })));
        continue;
      }
      if (spec?.specId) seen.add(spec.specId);
      if (spent > limits.maxEstimatedBudgetUsd) {
        outcomes.push(await finish(baseTrace(spec, "skipped_budget", { reasons: [{ code: "budget_exceeded", field: "limits.maxEstimatedBudgetUsd", message: `running estimated cost $${spent.toFixed(4)} exceeds the batch budget` }] })));
        continue;
      }
      const outcome = await generateOne(spec);
      spent += outcome.trace.estimatedCostUsd;
      outcomes.push(outcome);
    }
    return { outcomes, estimatedCostUsd: spent };
  }

  return { generateOne, generateBatch };
}

export type QuestionGenerationService = ReturnType<typeof createQuestionGenerationService>;

/** A summary that never throws on a malformed spec (so even a malformed spec gets a trace). */
function safeSummary(spec: GenerationSpec): DnaSummary {
  try {
    return summarizeRequestedDna(spec);
  } catch {
    return { examCode: "", sectionName: "", chapterName: "", conceptName: "", patternFamilyName: "", skill: "", combinationConcepts: [], difficultyTier: "", difficultyDimensions: {}, noveltyLevel: "", examRelevance: "", expectedTimeSeconds: 0, testingModes: [], trapErrorTaxonomyCode: null };
  }
}

export { specIdFor, AiGenerationError };
