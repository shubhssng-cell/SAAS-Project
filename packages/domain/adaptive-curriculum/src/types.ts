import type { ConceptEvidenceView, MasteryEvidenceView } from "@ipmat/mastery";
import type { RevisionIntelligence, UnservedSignal } from "@ipmat/revision-intelligence";
import type { ActiveRepairPlanContext, TrainingOrchestrationResult } from "@ipmat/training-orchestration";
import type { TrainingCandidateQuestion } from "@ipmat/training-systems";

/**
 * Adaptive Curriculum (Phase 7 Unit 3, docs/DECISIONS.md D-089).
 *
 * CURRICULUM ORCHESTRATION, not a mastery model. It composes - never re-decides - what already exists: the Phase 5D
 * orchestrator's single next action (confirmed repair, then the five training systems in the fixed D-062 order, then
 * adaptive practice), Unit 1's mastery evidence, Unit 2's revision intelligence, active repair plans and the published
 * question pool. Nothing in it is a mastery score, verdict, confidence, ranking or prediction.
 *
 * What the repository does NOT specify, and this layer therefore does not invent: which concept comes next across
 * concepts; any multi-step ordering beyond the orchestrator's existing consideration order; where Revision sits relative
 * to repair and adaptive practice (D-081 keeps it outside the adaptive chain); what "done" or "mastered" means.
 */

export const CURRICULUM_TIERS = ["targeted_repair", "training_system", "adaptive_practice"] as const;
export type CurriculumTier = (typeof CURRICULUM_TIERS)[number];

/** The question a step or the next action returns - DNA-level facts only (never text, options or an answer). */
export interface CurriculumQuestionTrace {
  questionId: string;
  conceptName: string;
  patternFamilyName: string;
  noveltyLevel: string;
  testingModes: readonly string[];
  /** Always "published": a next action outside the exam's published pool is refused (fail closed). */
  validationState: "published";
}

/** One tier of the orchestrator's FIXED consideration order, with what that tier's own rule says. */
export interface CurriculumChainEntry {
  /** Position in the existing consideration order (0 = repair). The order is the orchestrator's (D-062), not a ranking of the student's needs. */
  order: number;
  tier: CurriculumTier;
  /** "targeted_repair", a training-system id (trap-lab ... novelty-training) or "adaptive_practice". */
  id: string;
  /** Whether the orchestrator actually evaluated this tier on its way to the next action (it stops at the first selection). */
  reachedByOrchestrator: boolean;
  /** The tier's own raw status (selected / no_match / no_selection / not_applicable / no_eligible_question / error / not_attempted / not_built / not_run). */
  outcomeStatus: string;
  selectedQuestionId: string | null;
  explanation: string | null;
}

export type CurriculumNextAction =
  | {
      status: "selected";
      actionType: "targeted_repair" | "training_system_practice" | "adaptive_practice";
      /** The training-system provider id, or `null` for repair and adaptive practice. */
      providerId: string | null;
      question: CurriculumQuestionTrace;
      /** The orchestrator's own explanation, verbatim. */
      explanation: string;
      /** The existing rule that put this tier first (D-062) - fixed text, never a score. */
      whyThisTier: string;
      chainOrder: number;
      wasFallbackFromRepair: boolean;
      wasFallbackFromTrainingSystems: boolean;
      /** For adaptive practice only: the adaptive engine's own reason code for the pick; otherwise `null`. */
      adaptivePrimaryReason: string | null;
    }
  | { status: "no_action"; reason: string; explanation: string };

/** A candidate step: a question some tier selected, in the existing consideration order. Only the orchestrator's own pick is its next action. */
export interface CurriculumStep {
  /** Position in the existing consideration order, or `null` for a system outside the adaptive chain (Revision, D-081): no order is defined for it. */
  chainOrder: number | null;
  outsideAdaptiveChain: boolean;
  tier: CurriculumTier | "revision";
  systemId: string;
  conceptName: string;
  question: CurriculumQuestionTrace;
  /** The tier's own explanation, verbatim. */
  reason: string;
  supportingSignalIds: readonly string[];
  contributingAttemptIds: readonly string[];
  isOrchestratorNextAction: boolean;
}

export interface CurriculumRepairPlanFact {
  targetPatternFamilyName: string;
  priority: string;
}

export interface CurriculumConceptView {
  conceptName: string;
  /** Unit 1's evidence for this concept, verbatim. Never collapsed into a number. */
  evidence: ConceptEvidenceView;
  /** Unit 2 signals scoped to this concept. */
  revisionSignalIds: readonly string[];
  /** Signals no selected recommendation serves, with the reason (from Unit 2). */
  unservedSignals: readonly UnservedSignal[];
  /** Confirmed, active repair plans targeting this concept (target facts only; no diagnosis detail). */
  activeRepairPlans: readonly CurriculumRepairPlanFact[];
  /** Systems whose selected question is in this concept. */
  systemsServingConcept: readonly string[];
  nextActionTargetsConcept: boolean;
  /** Published, exam-scoped candidate questions in the pool for this concept. */
  publishedQuestionsInPool: number;
  /** Phase 6 availability by tier for this concept when an Exam Intelligence source was supplied; otherwise `null`. Content availability only. */
  contentAvailability: { available: number; validated: number; published: number } | null;
}

export const CURRICULUM_CONFLICT_KINDS = [
  "repair_precedes_training_systems",
  "revision_available_outside_adaptive_chain",
  "repair_plan_with_revision_signal",
  "competing_revision_types",
  "recurring_trap_with_correct_attempts",
  "need_without_provider",
  "no_action_available"
] as const;
export type CurriculumConflictKind = (typeof CURRICULUM_CONFLICT_KINDS)[number];

/**
 * A conflict is PRESERVED. `existing_rule` is used only where a documented repository rule already decides the matter
 * (the rule is named); everything else is an explicit `unresolved_product_decision`. No hidden score resolves anything.
 */
export interface CurriculumConflict {
  kind: CurriculumConflictKind;
  involves: readonly string[];
  resolution: "existing_rule" | "unresolved_product_decision";
  /** The documented rule, when `resolution` is `existing_rule`. */
  ruleReference: string | null;
  explanation: string;
}

export interface AdaptiveCurriculum {
  /** Always this marker: evidence-based orchestration, no mastery verdict. */
  status: "evidence_based_no_verdict";
  studentId: string;
  examCode: string;
  evaluatedAt: string | null;
  /** Always false: no cross-concept order or multi-step curriculum sequence is specified, so none is produced. */
  sequencing: { definedBeyondExistingChain: false; note: string };
  /** The existing orchestrator's own next action, carried verbatim and verified against the published pool. */
  nextAction: CurriculumNextAction;
  /** Every tier in the existing consideration order, with its own outcome. */
  chain: CurriculumChainEntry[];
  /** Candidate steps (a selected question per tier), in the existing consideration order; Revision is listed outside the chain with no order. */
  steps: CurriculumStep[];
  /** Concepts in alphabetical order (presentation only, no priority). */
  concepts: CurriculumConceptView[];
  /** Signals that are not concept-scoped by definition (trap recurrence). */
  crossConceptSignalIds: readonly string[];
  conflicts: CurriculumConflict[];
  /** Unit 2's unserved needs, across all concepts. */
  unservedNeeds: readonly UnservedSignal[];
  /** Unit 2's revision intelligence, embedded verbatim for the trace. */
  revision: RevisionIntelligence;
}

export interface AdaptiveCurriculumInput {
  studentId: string;
  examCode: string;
  /** Unit 1's evidence view for this student and exam, consumed unchanged. */
  evidence: MasteryEvidenceView;
  /** Unit 2's revision intelligence for the same student and exam, consumed unchanged. */
  revision: RevisionIntelligence;
  /** The existing orchestrator's result for the same state, consumed unchanged. */
  orchestration: TrainingOrchestrationResult;
  activeRepairPlans: readonly ActiveRepairPlanContext[];
  /** The exam-scoped candidate pool the orchestrator and providers were given. */
  candidates: readonly TrainingCandidateQuestion[];
  /** Optional Phase 6 content availability by concept (`ExamIntelligenceQueries.availability`). */
  contentAvailability?: Readonly<Record<string, { available: number; validated: number; published: number }>> | null;
}

export class CurriculumError extends Error {
  readonly code: "scope_mismatch" | "next_action_question_not_in_pool";
  constructor(code: CurriculumError["code"], message: string) {
    super(message);
    this.name = "CurriculumError";
    this.code = code;
  }
}
