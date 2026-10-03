import { TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER, type TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import {
  CurriculumError,
  type AdaptiveCurriculum,
  type AdaptiveCurriculumInput,
  type CurriculumChainEntry,
  type CurriculumConceptView,
  type CurriculumConflict,
  type CurriculumNextAction,
  type CurriculumQuestionTrace,
  type CurriculumStep
} from "./types.js";

const SEQUENCING_NOTE =
  "No cross-concept order and no multi-step curriculum sequence is specified in the repository, so none is produced. `chain` and `steps` follow the orchestrator's existing, fixed consideration order (D-062), which is not a ranking of the student's needs; Revision (D-081) is outside that chain and has no defined position.";

const WHY_TIER = {
  targeted_repair: "A confirmed repair plan is always attempted before anything else (D-062: REPAIR_PRECEDES_ADAPTIVE).",
  training_system_practice:
    "No repair plan produced a selection, and this provider is the first, in the fixed training-system order (D-062), whose own rule selected a published question.",
  adaptive_practice: "No repair plan and no training-system provider selected a question, so adaptive practice is the fallback (D-062)."
} as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const CHAIN_PROVIDER_IDS: readonly string[] = TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER;

function trace(q: { questionId: string; conceptName: string; patternFamilyName: string; noveltyLevel: string; testingModes: readonly string[] }): CurriculumQuestionTrace {
  return { questionId: q.questionId, conceptName: q.conceptName, patternFamilyName: q.patternFamilyName, noveltyLevel: q.noveltyLevel, testingModes: q.testingModes, validationState: "published" };
}

/**
 * Composes the curriculum view for ONE student and exam from results that already exist, and decides nothing itself.
 * The next action is the existing orchestrator's, verbatim, verified against the exam's published pool (fail closed). The
 * chain lists every tier in the orchestrator's fixed order with that tier's own outcome. Conflicts are preserved with
 * either the existing documented rule that decides them or an explicit `unresolved_product_decision`. Pure and
 * deterministic: the same inputs always give the same output, and nothing is selected, filtered or ranked here.
 */
export function buildAdaptiveCurriculum(input: AdaptiveCurriculumInput): AdaptiveCurriculum {
  const { evidence, revision, orchestration } = input;
  if (evidence.studentId !== input.studentId || revision.studentId !== input.studentId) {
    throw new CurriculumError("scope_mismatch", "Student mismatch between the request, the evidence view and the revision intelligence.");
  }
  if (evidence.examCode !== input.examCode || revision.examCode !== input.examCode) {
    throw new CurriculumError("scope_mismatch", "Exam mismatch between the request, the evidence view and the revision intelligence.");
  }

  const pool = input.candidates.filter((c) => c.validationState === "published" && c.question.examCode === input.examCode);
  const diagnostics = orchestration.diagnostics;

  // ---- next action: the orchestrator's own, verbatim, verified against the published pool ----
  const chainOrderOf = (result: Extract<TrainingOrchestrationResult, { status: "selected" }>): number =>
    result.actionType === "targeted_repair" ? 0 : result.actionType === "training_system_practice" ? 1 + CHAIN_PROVIDER_IDS.indexOf(result.providerId) : 1 + CHAIN_PROVIDER_IDS.length;

  let nextAction: CurriculumNextAction;
  let nextActionQuestionId: string | null = null;
  let nextActionTier: string | null = null;
  if (orchestration.status === "no_action") {
    nextAction = { status: "no_action", reason: orchestration.reason, explanation: orchestration.explanation };
  } else {
    const q = orchestration.question;
    if (!pool.some((c) => c.question.questionId === q.questionId)) {
      throw new CurriculumError("next_action_question_not_in_pool", "The orchestrator's next action is not a published question of this exam's pool.");
    }
    const providerId = orchestration.actionType === "training_system_practice" ? orchestration.providerId : null;
    nextActionQuestionId = q.questionId;
    nextActionTier = orchestration.actionType === "training_system_practice" ? providerId : orchestration.actionType;
    nextAction = {
      status: "selected",
      actionType: orchestration.actionType,
      providerId,
      question: trace(q),
      explanation: orchestration.explanation,
      whyThisTier: WHY_TIER[orchestration.actionType],
      chainOrder: chainOrderOf(orchestration),
      wasFallbackFromRepair: orchestration.actionType !== "targeted_repair" && orchestration.wasFallbackFromRepair,
      wasFallbackFromTrainingSystems: orchestration.actionType === "adaptive_practice" ? orchestration.wasFallbackFromTrainingSystems : false,
      adaptivePrimaryReason: orchestration.actionType === "adaptive_practice" ? orchestration.providerResult.primaryReason : null
    };
  }

  // ---- the chain: every tier of the existing consideration order, each with its own outcome ----
  const recById = new Map(revision.recommendations.map((r) => [r.systemId as string, r]));
  const outcomeById = new Map(revision.providerOutcomes.map((p) => [p.systemId as string, p]));
  const repairOutcome = diagnostics.repairOutcome;
  const adaptiveOutcome = diagnostics.adaptiveOutcome;
  const chain: CurriculumChainEntry[] = [
    {
      order: 0,
      tier: "targeted_repair",
      id: "targeted_repair",
      reachedByOrchestrator: diagnostics.repairAttempted,
      outcomeStatus: repairOutcome?.status ?? "not_attempted",
      selectedQuestionId: repairOutcome?.status === "selected" ? repairOutcome.result.question.questionId : null,
      explanation: repairOutcome?.status === "no_match" ? repairOutcome.explanation : null
    },
    ...TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER.map(
      (id, i): CurriculumChainEntry => ({
        order: 1 + i,
        tier: "training_system",
        id,
        reachedByOrchestrator: diagnostics.trainingSystemProviderOutcomes.some((p) => p.providerId === id),
        outcomeStatus: outcomeById.get(id)?.status ?? "not_run",
        selectedQuestionId: recById.get(id)?.question.questionId ?? null,
        explanation: outcomeById.get(id)?.explanation ?? null
      })
    ),
    {
      order: 1 + CHAIN_PROVIDER_IDS.length,
      tier: "adaptive_practice",
      id: "adaptive_practice",
      reachedByOrchestrator: diagnostics.adaptiveAttempted,
      outcomeStatus: adaptiveOutcome?.status ?? "not_attempted",
      selectedQuestionId: adaptiveOutcome?.status === "selected" ? adaptiveOutcome.result.question.questionId : null,
      explanation: adaptiveOutcome ? (adaptiveOutcome.status === "selected" ? adaptiveOutcome.result.explanation : adaptiveOutcome.explanation) : null
    }
  ];

  // ---- steps: a selected question per tier, in the existing order; Revision outside the chain ----
  const steps: CurriculumStep[] = [];
  const chosenPlan = diagnostics.repairPlanChosen;
  for (const entry of chain) {
    if (entry.selectedQuestionId === null) continue;
    const isNext = nextActionQuestionId === entry.selectedQuestionId && nextActionTier === (entry.tier === "training_system" ? entry.id : entry.tier === "targeted_repair" ? "targeted_repair" : "adaptive_practice");
    if (entry.tier === "training_system") {
      const rec = recById.get(entry.id)!;
      steps.push({
        chainOrder: entry.order,
        outsideAdaptiveChain: false,
        tier: "training_system",
        systemId: entry.id,
        conceptName: rec.question.conceptName,
        question: trace(rec.question),
        reason: rec.providerExplanation,
        supportingSignalIds: rec.supportingSignalIds,
        contributingAttemptIds: rec.contributingAttemptIds,
        isOrchestratorNextAction: isNext
      });
    } else if (entry.tier === "targeted_repair" && repairOutcome?.status === "selected") {
      const plan = input.activeRepairPlans.find(
        (p) =>
          chosenPlan !== null &&
          p.plan.targetConceptName === chosenPlan.targetConceptName &&
          p.plan.targetPatternFamilyName === chosenPlan.targetPatternFamilyName &&
          p.plan.confirmationSource.hypothesisConfirmedAt === chosenPlan.confirmedAt
      );
      const q = repairOutcome.result.question;
      steps.push({
        chainOrder: 0,
        outsideAdaptiveChain: false,
        tier: "targeted_repair",
        systemId: "targeted_repair",
        conceptName: q.conceptName,
        question: trace(q),
        reason: `Targeted repair of a confirmed plan (${repairOutcome.result.matchTier} match).`,
        supportingSignalIds: [],
        contributingAttemptIds: plan ? [plan.plan.confirmationSource.attemptId] : [],
        isOrchestratorNextAction: isNext
      });
    } else if (entry.tier === "adaptive_practice" && adaptiveOutcome?.status === "selected") {
      const q = adaptiveOutcome.result.question;
      steps.push({
        chainOrder: entry.order,
        outsideAdaptiveChain: false,
        tier: "adaptive_practice",
        systemId: "adaptive_practice",
        conceptName: q.conceptName,
        question: trace(q),
        reason: adaptiveOutcome.result.explanation,
        supportingSignalIds: [],
        contributingAttemptIds: [],
        isOrchestratorNextAction: isNext
      });
    }
  }
  const revisionRec = recById.get("revision");
  if (revisionRec) {
    steps.push({
      chainOrder: null,
      outsideAdaptiveChain: true,
      tier: "revision",
      systemId: "revision",
      conceptName: revisionRec.question.conceptName,
      question: trace(revisionRec.question),
      reason: revisionRec.providerExplanation,
      supportingSignalIds: revisionRec.supportingSignalIds,
      contributingAttemptIds: revisionRec.contributingAttemptIds,
      isOrchestratorNextAction: false
    });
  }

  // ---- per-concept view: evidence, signals, repair facts, who serves it - never one number ----
  const signalConcept = new Map(revision.signals.map((s) => [s.id, s.conceptName]));
  const concepts: CurriculumConceptView[] = evidence.concepts.map((c) => ({
    conceptName: c.conceptName,
    evidence: c,
    revisionSignalIds: revision.signals.filter((s) => s.conceptName === c.conceptName).map((s) => s.id),
    unservedSignals: revision.unservedSignals.filter((u) => signalConcept.get(u.signalId) === c.conceptName),
    activeRepairPlans: input.activeRepairPlans
      .filter((p) => p.plan.targetConceptName === c.conceptName)
      .map((p) => ({ targetPatternFamilyName: p.plan.targetPatternFamilyName, priority: p.plan.priority as string }))
      .sort((a, b) => cmp(a.targetPatternFamilyName, b.targetPatternFamilyName) || cmp(a.priority, b.priority)),
    systemsServingConcept: [...new Set(steps.filter((s) => s.conceptName === c.conceptName).map((s) => s.systemId))].sort(cmp),
    nextActionTargetsConcept: nextAction.status === "selected" && nextAction.question.conceptName === c.conceptName,
    publishedQuestionsInPool: pool.filter((p) => p.question.conceptName === c.conceptName).length,
    contentAvailability: input.contentAvailability?.[c.conceptName] ?? null
  }));

  // ---- conflicts: preserved; an existing documented rule is named where one decides, otherwise unresolved ----
  const conflicts: CurriculumConflict[] = [];
  const chainSelectedProviders = revision.recommendations.map((r) => r.systemId as string).filter((id) => CHAIN_PROVIDER_IDS.includes(id));
  if (nextAction.status === "selected" && nextAction.actionType === "targeted_repair" && chainSelectedProviders.length > 0) {
    conflicts.push({
      kind: "repair_precedes_training_systems",
      involves: ["targeted_repair", ...chainSelectedProviders],
      resolution: "existing_rule",
      ruleReference: "D-062 (TRAINING_ORCHESTRATION_POLICY.REPAIR_PRECEDES_ADAPTIVE)",
      explanation: "A confirmed repair plan produced the next action; training systems that also selected a question remain listed as steps but do not override it."
    });
  }
  if (revisionRec) {
    conflicts.push({
      kind: "revision_available_outside_adaptive_chain",
      involves: ["revision", nextAction.status === "selected" ? (nextAction.providerId ?? nextAction.actionType) : "no_action"],
      resolution: "existing_rule",
      ruleReference: "D-081 (Revision is student-chosen and registered outside TRAINING_SYSTEM_PROVIDER_PRIORITY_ORDER)",
      explanation: "Revision does not compete with the orchestrator's next action; it stays available as a separate step with no defined position in the chain."
    });
  }
  const dormant = revision.signals.filter((s) => s.kind === "dormant_concept");
  if (input.activeRepairPlans.length > 0 && dormant.length > 0) {
    conflicts.push({
      kind: "repair_plan_with_revision_signal",
      involves: [...new Set([...input.activeRepairPlans.map((p) => p.plan.targetConceptName), ...dormant.map((s) => s.conceptName as string)])].sort(cmp),
      resolution: "unresolved_product_decision",
      ruleReference: null,
      explanation: "A confirmed repair plan is active while a concept is dormant. The orchestrator orders repair before the adaptive chain, but no rule says whether revision should wait for, or be interleaved with, repair."
    });
  }
  for (const c of revision.conflicts) {
    conflicts.push({ kind: c.kind, involves: c.involves, resolution: "unresolved_product_decision", ruleReference: null, explanation: c.explanation });
  }
  const noProvider = revision.unservedSignals.filter((u) => u.possibleSystemId === null);
  if (noProvider.length > 0) {
    conflicts.push({
      kind: "need_without_provider",
      involves: noProvider.map((u) => u.signalId),
      resolution: "unresolved_product_decision",
      ruleReference: null,
      explanation: "These signals have no existing training system that serves them; nothing is invented to serve them."
    });
  }
  if (nextAction.status === "no_action") {
    conflicts.push({
      kind: "no_action_available",
      involves: [nextAction.reason],
      resolution: "existing_rule",
      ruleReference: "D-062 (the orchestrator returns no_action when no tier selects a published question; nothing is fabricated)",
      explanation: nextAction.explanation
    });
  }
  conflicts.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.involves.join(","), b.involves.join(",")));

  return {
    status: "evidence_based_no_verdict",
    studentId: input.studentId,
    examCode: input.examCode,
    evaluatedAt: revision.evaluatedAt,
    sequencing: { definedBeyondExistingChain: false, note: SEQUENCING_NOTE },
    nextAction,
    chain,
    steps,
    concepts,
    crossConceptSignalIds: revision.signals.filter((s) => s.conceptName === null).map((s) => s.id),
    conflicts,
    unservedNeeds: revision.unservedSignals,
    revision
  };
}
