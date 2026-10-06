import { generateStructured, tutorResponseAiSchema, AiGenerationError, type AiCallOptions, type AiProvider, type AiResultMetadata, type TutorResponseAiOutput } from "@ipmat/ai";
import { buildTutorContext, digestTutorContext, type TutorContextDeps } from "./context.js";
import { validateTutorGrounding } from "./grounding.js";
import { TUTOR_INTENT_POLICIES } from "./policy.js";
import { DEFAULT_TUTOR_PRESENTATION } from "./types.js";
import { buildTutorSystemPrompt, buildTutorUserPrompt, tutorPromptVersion } from "./prompts.js";
import type {
  GroundingReport,
  GroundingViolationCode,
  TutorAuditEntry,
  TeachingAction,
  TutorAuditSink,
  TutorContext,
  TutorFailureKind,
  TutorOutcome,
  TutorRequest,
  TutorResponse
} from "./types.js";

export const TUTOR_SERVICE_LIMITS = {
  /** Regenerations after a grounding rejection (each is a full model call). Hard-capped so cost is bounded. */
  DEFAULT_GROUNDING_RETRIES: 1,
  MAX_GROUNDING_RETRIES: 2
} as const;

/** Fixed, model-free wording for every outcome that carries no model answer. */
export const TUTOR_FALLBACK_MESSAGES = {
  insufficient_context: "I don't have enough verified information to answer that here.",
  rejected_ungrounded: "I couldn't produce an answer I could verify against your materials, so I'm not going to guess.",
  provider_failure: "The tutor is unavailable right now. Please try again later."
} as const;

export interface TutorServiceDeps extends TutorContextDeps {
  /** Any `@ipmat/ai` provider (Anthropic, a future OpenAI/Google adapter, a test double). Injected - never constructed here, no key in source. */
  provider: AiProvider;
  /** The names/codes of every exam OTHER than the given one, so a mention can be detected. When omitted the cross-exam text check does not run (and is not reported as run). */
  listOtherExamTerms?: (examCode: string) => Promise<readonly string[]> | readonly string[];
  audit?: TutorAuditSink;
  now?: () => Date;
  newRequestId?: () => string;
  groundingRetries?: number;
  aiOptions?: AiCallOptions;
}

const emptyGrounding = (checksRun: string[] = []): GroundingReport => ({ checksRun, localization: { requested: "english", status: "not_requested", codes: [] }, violations: [], passed: true });

function classifyFailure(error: unknown): { kind: TutorFailureKind; metadata: AiResultMetadata | null } {
  if (error instanceof AiGenerationError) {
    const cause = error.cause as { name?: string } | undefined;
    if (error.metadata.validationOutcome === "invalid") return { kind: "malformed_output", metadata: error.metadata };
    if (cause?.name === "AiTimeoutError") return { kind: "timeout", metadata: error.metadata };
    return { kind: "provider_error", metadata: error.metadata };
  }
  return { kind: "provider_error", metadata: null };
}

export function createTutorService(deps: TutorServiceDeps) {
  const retries = Math.min(TUTOR_SERVICE_LIMITS.MAX_GROUNDING_RETRIES, Math.max(0, deps.groundingRetries ?? TUTOR_SERVICE_LIMITS.DEFAULT_GROUNDING_RETRIES));
  const now = deps.now ?? (() => new Date());
  let counter = 0;
  const newRequestId = deps.newRequestId ?? (() => `tutor-${now().getTime().toString(36)}-${(counter++).toString(36)}`);

  async function emit(entry: TutorAuditEntry): Promise<void> {
    try {
      await deps.audit?.record(entry);
    } catch {
      // An audit sink failure must never change what a student receives, and must not surface sink internals.
    }
  }

  function baseAudit(request: TutorRequest, patch: Partial<TutorAuditEntry> & Pick<TutorAuditEntry, "outcome">): TutorAuditEntry {
    return {
      at: now().toISOString(),
      requestId: newRequestId(),
      intent: request.intent,
      teachingMode: TUTOR_INTENT_POLICIES[request.intent].teachingMode,
      studentId: request.studentId,
      enrollmentId: request.enrollmentId,
      examCode: null,
      questionId: request.questionId ?? null,
      conceptName: request.conceptName ?? null,
      contextDigest: null,
      includedSections: [],
      withheldSections: [],
      violationCodes: [],
      generationAttempts: 0,
      model: null,
      failure: null,
      ...patch
    };
  }

  const modelAudit = (m: AiResultMetadata | null): TutorAuditEntry["model"] =>
    m ? { provider: m.provider, model: m.model, promptVersion: m.promptVersion, latencyMs: m.latencyMs, tokenUsage: m.tokenUsage, estimatedCostUsd: m.estimatedCostUsd, attempts: m.attempts } : null;

  type ResponseParts = Omit<TutorResponse, "outcome" | "audit" | "teachingAction" | "parts" | "localizedText" | "presentation"> & Partial<Pick<TutorResponse, "teachingAction" | "parts" | "localizedText" | "presentation">>;

  /** What the tutor attempted when no model answer was produced: its mode, with nothing disclosed. */
  const noAction = (request: TutorRequest): TeachingAction => ({ mode: TUTOR_INTENT_POLICIES[request.intent].teachingMode, answerDisclosure: "withheld", socraticStep: null });

  async function finish(request: TutorRequest, outcome: TutorOutcome, parts: ResponseParts, audit: Partial<TutorAuditEntry>): Promise<TutorResponse> {
    const entry = baseAudit(request, { outcome, ...audit });
    await emit(entry);
    return { outcome, teachingAction: noAction(request), parts: null, localizedText: null, presentation: { ...(request.presentation ?? DEFAULT_TUTOR_PRESENTATION) }, ...parts, audit: entry };
  }

  function toResponseParts(context: TutorContext, output: TutorResponseAiOutput, grounding: GroundingReport): ResponseParts {
    const byRef = new Map(context.refs.map((r) => [r.ref, r]));
    const step = output.socraticStep ?? null;
    const cited = [...new Set([...output.citations, ...(step ? [step.conceptRef, ...step.evidenceRefs] : [])])];
    return {
      teachingAction: {
        mode: TUTOR_INTENT_POLICIES[context.intent].teachingMode,
        answerDisclosure: context.answerKey ? "authorized" : "withheld",
        // The teaching ACTION is recorded (what was checked, the question, what the reply would show) - never the model's private reasoning.
        socraticStep: step ? { checks: step.checks, question: step.question, conceptRef: step.conceptRef, evidenceRefs: [...step.evidenceRefs], learnsFromReply: step.learnsFromReply } : null
      },
      parts: output.parts ?? null,
      // Shown ONLY if it passed its own validation; otherwise the validated English is what the student sees.
      localizedText: grounding.localization.status === "validated" ? (output.localizedText ?? null) : null,
      presentation: { ...context.presentation },
      responseType: output.responseType,
      text: output.text,
      fallbackMessage: null,
      sourceReferences: cited.flatMap((ref) => {
        const s = context.sources.find((x) => x.ref === ref);
        return s ? [{ ref, chunkId: s.chunkId, title: s.title, location: s.location, version: s.version, epistemic: "SOURCE_CONTENT" as const }] : [];
      }),
      evidenceReferences: cited.flatMap((ref) => {
        const r = byRef.get(ref);
        return r ? [{ ref, label: r.label, epistemic: r.epistemic }] : [];
      }),
      hypotheses: output.hypotheses.map((h) => ({ epistemic: "AI_HYPOTHESIS" as const, text: h.text, evidenceRefs: [...h.evidenceRefs] })),
      uncertainty: { insufficientContext: output.responseType === "insufficient_context", missing: [...output.missingContext] },
      grounding
    };
  }

  return {
    /**
     * Context firewall -> pre-checks -> model (through `generateStructured`) ->
     * deterministic grounding validation -> response. A `TutorError` from the
     * firewall (ownership, question/concept unavailable) propagates: the caller
     * maps it, and NO model call has been made. A rejected, unverifiable or
     * failed generation never returns model text.
     */
    async answer(request: TutorRequest): Promise<TutorResponse> {
      const built = await buildTutorContext(deps, request);

      if (built.kind === "insufficient") {
        return finish(
          request,
          "insufficient_context",
          {
            responseType: "insufficient_context",
            text: null,
            fallbackMessage: TUTOR_FALLBACK_MESSAGES.insufficient_context,
            sourceReferences: [],
            evidenceReferences: [],
            hypotheses: [],
            uncertainty: { insufficientContext: true, missing: built.missing },
            grounding: emptyGrounding()
          },
          { examCode: built.scope.examCode, includedSections: built.includedSections, withheldSections: built.withheldSections }
        );
      }

      const { context, scope, protectedKey, internalTokens, rejectedTerms } = built;
      const contextDigest = digestTutorContext(context);
      const foreign = deps.listOtherExamTerms ? [...(await deps.listOtherExamTerms(scope.examCode))].filter((t) => t.toLowerCase() !== scope.examCode.toLowerCase()) : undefined;
      const common = { examCode: scope.examCode, contextDigest, includedSections: context.includedSections, withheldSections: context.withheldSections };

      let lastViolations: GroundingViolationCode[] = [];
      let lastReport: GroundingReport = emptyGrounding();
      let lastMetadata: AiResultMetadata | null = null;
      let attempts = 0;

      for (let i = 0; i <= retries; i++) {
        attempts += 1;
        let output: TutorResponseAiOutput;
        try {
          const result = await generateStructured(deps.provider, {
            task: "tutor-response",
            promptVersion: tutorPromptVersion(context.presentation),
            systemPrompt: buildTutorSystemPrompt(),
            userPrompt: buildTutorUserPrompt(context, lastViolations),
            schema: tutorResponseAiSchema,
            options: deps.aiOptions
          });
          output = result.data;
          lastMetadata = result.metadata;
        } catch (error) {
          const { kind, metadata } = classifyFailure(error);
          return finish(
            request,
            "provider_failure",
            {
              responseType: null,
              text: null,
              fallbackMessage: TUTOR_FALLBACK_MESSAGES.provider_failure,
              sourceReferences: [],
              evidenceReferences: [],
              hypotheses: [],
              uncertainty: { insufficientContext: false, missing: [] },
              grounding: emptyGrounding()
            },
            { ...common, generationAttempts: attempts, model: modelAudit(metadata ?? lastMetadata), failure: kind }
          );
        }

        const report = validateTutorGrounding(context, output, { protectedKey, internalTokens, rejectedTerms, foreignExamTerms: foreign });
        lastReport = report;
        if (report.passed) {
          const outcome: TutorOutcome = output.responseType === "insufficient_context" ? "insufficient_context" : "answered";
          const parts = toResponseParts(context, output, report);
          return finish(request, outcome, parts, { ...common, generationAttempts: attempts, model: modelAudit(lastMetadata) });
        }
        lastViolations = report.violations.map((v) => v.code);
      }

      // Exhausted. The rejected model text is NOT returned (it is exactly the text that failed validation).
      return finish(
        request,
        "rejected_ungrounded",
        {
          responseType: null,
          text: null,
          fallbackMessage: TUTOR_FALLBACK_MESSAGES.rejected_ungrounded,
          sourceReferences: [],
          evidenceReferences: [],
          hypotheses: [],
          uncertainty: { insufficientContext: false, missing: [] },
          grounding: lastReport
        },
        { ...common, generationAttempts: attempts, model: modelAudit(lastMetadata), violationCodes: [...new Set(lastViolations)] }
      );
    }
  };
}

export type TutorService = ReturnType<typeof createTutorService>;
