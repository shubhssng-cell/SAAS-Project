import type { CapabilityId } from "./types.js";

/**
 * THE CAPABILITY REGISTRY: a closed, typed allowlist. A capability may be invoked only if it is listed
 * here, the actor is allowed, the scope matches and its required inputs are present. Nothing a model says
 * can add to this table, and no function in this package selects a capability from model output.
 *
 * Only systems that exist are registered. Each descriptor states what the capability may do, so the
 * guarantees (no LLM where none is needed, no mutation where none is meant) are data a test can check.
 */
export interface CapabilityDescriptor {
  id: CapabilityId;
  purpose: string;
  /** The names of the inputs the orchestrator must supply (checked before invocation). */
  requiredInputs: readonly string[];
  outputType: string;
  /** Which actors may invoke it. `staff` additionally names the allowed roles. */
  actors: readonly ("student" | "staff")[];
  staffRoles: readonly string[];
  /** `enrollment_exam`: the exam of the verified enrollment. `spec_exam`: the exam the staff request names, which must be in the actor's exams. */
  examScope: "enrollment_exam" | "spec_exam";
  /** `own`: only the verified student's data. `none`: no student data at all. */
  studentScope: "own" | "none";
  mayCallLlm: boolean;
  mayMutateState: boolean;
  /** The existing validation this capability's output has already passed (or "none: deterministic read"). */
  validation: string;
}

export const CAPABILITY_REGISTRY: Readonly<Record<CapabilityId, CapabilityDescriptor>> = Object.freeze({
  tutor_response: {
    id: "tutor_response",
    purpose: "One tutor answer through the Unit 1-2 tutor (hint, guided question, explanation, mistake explanation, full solution, concept clarification) with its own answer-key, ownership and grounding rules.",
    requiredInputs: ["request"],
    outputType: "TutorResponse",
    actors: ["student"],
    staffRoles: [],
    examScope: "enrollment_exam",
    studentScope: "own",
    mayCallLlm: true,
    mayMutateState: false,
    validation: "tutor_grounding (deterministic, existing)"
  },
  personalization: {
    id: "personalization",
    purpose: "Resolve the student's EXPLICIT preferences into a tutor presentation (and, for a help request, the tutor intent) with INPUT -> RULE -> OUTPUT decisions. Reads no training evidence.",
    requiredInputs: ["request", "resolveIntent"],
    outputType: "PersonalizedTutorRequest",
    actors: ["student"],
    staffRoles: [],
    examScope: "enrollment_exam",
    studentScope: "own",
    mayCallLlm: false,
    mayMutateState: false,
    validation: "preference validation (deterministic, existing)"
  },
  question_generation: {
    id: "question_generation",
    purpose: "Generate ONE candidate question from a validated GenerationSpec into the authoring lifecycle (a draft / ai_validated candidate). Never publishes.",
    requiredInputs: ["spec"],
    outputType: "GenerationOutcome",
    actors: ["staff"],
    staffRoles: ["content_admin"],
    examScope: "spec_exam",
    studentScope: "none",
    mayCallLlm: true,
    mayMutateState: true,
    validation: "existing pipeline checks + 11 authoring gates"
  },
  adaptive_curriculum: {
    id: "adaptive_curriculum",
    purpose: "The existing Phase 7 Unit 3 curriculum composition for the verified student and exam.",
    requiredInputs: ["studentId", "enrollmentId", "examCode"],
    outputType: "AdaptiveCurriculum",
    actors: ["student"],
    staffRoles: [],
    examScope: "enrollment_exam",
    studentScope: "own",
    mayCallLlm: false,
    mayMutateState: false,
    validation: "none: deterministic read of existing engines"
  },
  revision_intelligence: {
    id: "revision_intelligence",
    purpose: "The existing Phase 7 Unit 2 revision intelligence for the verified student and exam.",
    requiredInputs: ["studentId", "enrollmentId", "examCode"],
    outputType: "RevisionIntelligence",
    actors: ["student"],
    staffRoles: [],
    examScope: "enrollment_exam",
    studentScope: "own",
    mayCallLlm: false,
    mayMutateState: false,
    validation: "none: deterministic read of existing engines"
  },
  simulation_intelligence: {
    id: "simulation_intelligence",
    purpose: "The existing Phase 7 Unit 5 readiness EVIDENCE from FINALIZED simulations only (five separate facts; no score, no verdict).",
    requiredInputs: ["studentId", "enrollmentId", "examCode"],
    outputType: "ExamPerformanceIntelligence",
    actors: ["student"],
    staffRoles: [],
    examScope: "enrollment_exam",
    studentScope: "own",
    mayCallLlm: false,
    mayMutateState: false,
    validation: "none: deterministic read of finalized evidence"
  },
  exam_intelligence: {
    id: "exam_intelligence",
    purpose: "The existing Phase 6 exam-level content availability / coverage queries (named mapped universe; no prediction).",
    requiredInputs: ["examCode"],
    outputType: "ExamIntelligenceQueries result",
    actors: ["student"],
    staffRoles: [],
    examScope: "enrollment_exam",
    studentScope: "none",
    mayCallLlm: false,
    mayMutateState: false,
    validation: "none: deterministic read"
  }
});

export const isRegisteredCapability = (id: unknown): id is CapabilityId => typeof id === "string" && Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, id);
