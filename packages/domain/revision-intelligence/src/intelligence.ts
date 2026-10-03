import type { MasteryAttemptRecord, TrainingSystemContext, TrainingSystemOutcome } from "@ipmat/training-systems";
import { deriveRevisionSignals } from "./signals.js";
import {
  REVISION_EXPOSURE_TYPES,
  REVISION_INTELLIGENCE_SYSTEM_IDS,
  RevisionIntelligenceError,
  type ProviderOutcomeRecord,
  type ProviderOutcomeStatus,
  type RevisionConflict,
  type RevisionIntelligence,
  type RevisionIntelligenceInput,
  type RevisionIntelligenceSystemId,
  type RevisionRecommendation,
  type RevisionSignal,
  type RevisionSignalDimension,
  type UnservedSignal
} from "./types.js";

/**
 * Restricts a training context to ONE student and ONE exam (attempt records and candidates of anything else are removed;
 * nothing else changes - the providers still apply their own published/eligibility rules). Callers run the existing
 * providers on this scoped context so that no provider can ever see, or select, another exam's question. Pure.
 */
export function scopeContextToExam(context: TrainingSystemContext, examCode: string): TrainingSystemContext {
  return {
    ...context,
    attemptRecords: context.attemptRecords.filter((r) => r.contribution.studentId === context.studentId && r.question.examCode === examCode),
    candidates: context.candidates.filter((c) => c.question.examCode === examCode)
  };
}

const PRIORITY_NOTE =
  "No priority among revision needs is defined in the repository (the adaptive order of D-062 excludes Revision), so none is applied. Recommendations are listed alphabetically by system id, which carries no meaning.";

const isSystemId = (id: string): id is RevisionIntelligenceSystemId => (REVISION_INTELLIGENCE_SYSTEM_IDS as readonly string[]).includes(id);

function outcomeRecord(systemId: RevisionIntelligenceSystemId, outcome: TrainingSystemOutcome | null | undefined): ProviderOutcomeRecord {
  if (outcome === undefined) return { systemId, status: "not_run", reason: null, explanation: null, diagnostics: null };
  if (outcome === null) return { systemId, status: "not_built", reason: null, explanation: null, diagnostics: null };
  switch (outcome.status) {
    case "not_applicable":
      return { systemId, status: "not_applicable", reason: outcome.reason, explanation: outcome.explanation, diagnostics: outcome.diagnostics };
    case "error":
      return { systemId, status: "error", reason: outcome.code, explanation: outcome.explanation, diagnostics: null };
    default:
      return { systemId, status: outcome.status, reason: null, explanation: outcome.explanation, diagnostics: outcome.diagnostics };
  }
}

type Requirement = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function chronological(records: readonly MasteryAttemptRecord[]): string[] {
  const ms = (r: MasteryAttemptRecord): number => {
    const parsed = r.contribution.finalizedAt ? Date.parse(r.contribution.finalizedAt) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...records].sort((a, b) => ms(a) - ms(b) || (a.contribution.attemptId < b.contribution.attemptId ? -1 : 1)).map((r) => r.contribution.attemptId);
}

/**
 * Builds the revision intelligence for ONE student and exam: signals (facts), the existing providers' own outcomes,
 * traced recommendations, unserved signals, preserved conflicts and an explicit "no priority defined" marker.
 *
 * This layer never picks or re-ranks a question. A recommendation exists only where an EXISTING provider returned
 * `selected`; the provider's explanation is carried verbatim, the question is re-checked against the published pool
 * (fail closed), and the signals this layer links to the provider's target are listed with their contributing attempts.
 * Deterministic: the same evidence, context and runs always give the same result, whatever their order.
 */
export function buildRevisionIntelligence(input: RevisionIntelligenceInput): RevisionIntelligence {
  const { evidence, context } = input;
  if (evidence.studentId !== input.studentId || context.studentId !== input.studentId) {
    throw new RevisionIntelligenceError("scope_mismatch", "Student mismatch between the request, the evidence view and the training context.");
  }
  if (evidence.examCode !== input.examCode) {
    throw new RevisionIntelligenceError("scope_mismatch", "The evidence view belongs to a different exam than the request.");
  }

  const signals = deriveRevisionSignals(evidence, context);
  const signalById = new Map(signals.map((s) => [s.id, s]));

  const runsById = new Map<string, TrainingSystemOutcome | null>();
  for (const run of input.runs) {
    if (!isSystemId(run.systemId)) throw new RevisionIntelligenceError("unknown_system", `"${run.systemId}" is not a system this layer consults.`);
    runsById.set(run.systemId, run.outcome);
  }
  const providerOutcomes = REVISION_INTELLIGENCE_SYSTEM_IDS.map((id) => outcomeRecord(id, runsById.get(id)));

  const records = context.attemptRecords.filter((r) => r.contribution.studentId === input.studentId && r.question.examCode === input.examCode);
  const recommendations: RevisionRecommendation[] = [];

  for (const systemId of REVISION_INTELLIGENCE_SYSTEM_IDS) {
    const outcome = runsById.get(systemId);
    if (!outcome || outcome.status !== "selected") continue;

    const question = outcome.question;
    const pooled = context.candidates.find((c) => c.question.questionId === question.questionId);
    if (!pooled || pooled.validationState !== "published" || pooled.question.examCode !== input.examCode || question.examCode !== input.examCode) {
      throw new RevisionIntelligenceError("provider_selected_ineligible_question", `"${systemId}" selected a question that is not a published question of this exam's pool.`);
    }

    const requirement = outcome.requirement as Requirement;
    const targetConcept = str(requirement.targetConceptName);
    const targetCode = systemId === "trap-lab" ? str(requirement.targetErrorTaxonomyCode) : null;
    const targetLevel = systemId === "novelty-training" ? str(requirement.targetNoveltyLevel) : null;

    let linked: RevisionSignal | undefined;
    let dimensions: RevisionSignalDimension[] = [];
    if (systemId === "revision") {
      linked = signalById.get(`dormant_concept|${targetConcept}|*`);
      dimensions = ["concept"];
    } else if (systemId === "trap-lab") {
      linked = signalById.get(`recurring_trap_failure|*|${targetCode}`);
      dimensions = ["error_code"];
    } else if (systemId === "novelty-training") {
      linked = signalById.get(`novelty_level_without_graded_evidence|${targetConcept}|${targetLevel}`);
      dimensions = ["concept", "novelty_level"];
    } else {
      if (targetConcept !== null) dimensions.push("concept");
      if (Array.isArray(requirement.testingModes) && requirement.testingModes.length > 0) dimensions.push("testing_mode");
      if (typeof requirement.noveltyLevel === "string") dimensions.push("novelty_level");
      if (typeof requirement.errorTaxonomyCode === "string") dimensions.push("error_code");
    }

    const supporting = linked ? [linked] : [];
    recommendations.push({
      systemId,
      exposureType: REVISION_EXPOSURE_TYPES[systemId],
      producedBy: systemId,
      targetConceptName: targetConcept,
      targetErrorTaxonomyCode: targetCode,
      targetNoveltyLevel: targetLevel,
      providerExplanation: outcome.explanation,
      supportingSignalIds: supporting.map((s) => s.id),
      evidenceDimensions: dimensions,
      contributingAttemptIds: supporting.length > 0 ? supporting[0]!.contributingAttemptIds : [],
      contributingAttemptsNote: supporting.length > 0 ? null : "This provider's evidence is provider-owned; this layer does not enumerate its attempts and links no signal to it.",
      question: {
        questionId: question.questionId,
        conceptName: question.conceptName,
        patternFamilyName: question.patternFamilyName,
        noveltyLevel: question.noveltyLevel,
        testingModes: question.testingModes,
        validationState: "published"
      }
    });
  }

  const servedIds = new Set(recommendations.flatMap((r) => r.supportingSignalIds));
  const statusOf = (id: RevisionIntelligenceSystemId): ProviderOutcomeStatus => providerOutcomes.find((p) => p.systemId === id)!.status;
  const possibleSystem: Partial<Record<RevisionSignal["kind"], RevisionIntelligenceSystemId>> = {
    dormant_concept: "revision",
    recurring_trap_failure: "trap-lab",
    novelty_level_without_graded_evidence: "novelty-training"
  };
  const unservedSignals: UnservedSignal[] = signals
    .filter((s) => !servedIds.has(s.id))
    .map((s) => {
      const system = possibleSystem[s.kind] ?? null;
      if (system === null) {
        return {
          signalId: s.id,
          possibleSystemId: null,
          reason:
            s.kind === "attempts_exceed_distinct_questions"
              ? "No existing training system serves repeated-question exposure (an undefined product decision)."
              : "No existing training system provides pattern-family- or testing-mode-level revision (an undefined product decision); nothing is invented for it."
        };
      }
      const status = statusOf(system);
      return {
        signalId: s.id,
        possibleSystemId: system,
        reason:
          status === "selected"
            ? `"${system}" selects only its own single target per run, and its target is a different one.`
            : `"${system}" did not produce a candidate (provider status: ${status}); its own rule decides, this layer does not override it.`
      };
    });

  const conflicts: RevisionConflict[] = [];
  if (recommendations.length >= 2) {
    conflicts.push({
      kind: "competing_revision_types",
      involves: recommendations.map((r) => r.systemId),
      facts: { recommendationCount: recommendations.length },
      resolution: "unresolved_product_decision",
      explanation: "More than one existing system selected a question. No rule says which revision type comes first, so all are kept and none is preferred."
    });
  }
  for (const s of signals.filter((x) => x.kind === "recurring_trap_failure")) {
    const code = s.subject!;
    const graded = records.filter((r) => r.contribution.status === "submitted" && typeof r.contribution.isCorrect === "boolean" && r.question.trapErrorTaxonomyCode === code);
    const correct = graded.filter((r) => r.contribution.isCorrect === true);
    if (correct.length === 0) continue;
    conflicts.push({
      kind: "recurring_trap_with_correct_attempts",
      involves: [s.id],
      facts: { errorCode: code, correctGradedAttempts: correct.length, incorrectGradedAttempts: graded.length - correct.length, correctAttemptIds: chronological(correct) },
      resolution: "unresolved_product_decision",
      explanation: "Questions designed around this trap were also answered correctly. Both facts are preserved; no rule decides which one outweighs the other."
    });
  }

  const nowMs = context.now === undefined ? Number.NaN : Date.parse(context.now);
  return {
    status: "evidence_based_no_verdict",
    studentId: input.studentId,
    examCode: input.examCode,
    evaluatedAt: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null,
    priority: { defined: false, note: PRIORITY_NOTE },
    signals,
    providerOutcomes,
    recommendations,
    unservedSignals,
    conflicts,
    noEligibleCandidate: providerOutcomes.filter((p) => p.status === "no_eligible_question").map((p) => p.systemId)
  };
}
