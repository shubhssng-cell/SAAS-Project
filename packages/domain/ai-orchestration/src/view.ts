import { explainDecision, type PersonalizationDecision } from "@ipmat/personalization";
import { toStudentTutorView, type StudentTutorView, type TutorResponse } from "@ipmat/tutor";
import type { Actor, FailureKind, OrchestrationResult, OrchestrationStatus, TaskId } from "./types.js";

/**
 * The ONLY shape of an orchestration result meant to leave the service boundary. Built field by field and per
 * capability through the EXISTING public projectors (the tutor's `toStudentTutorView`); everything else is withheld.
 * It carries no request id of a capability, no input digest, no audit entry, no student/enrollment/question id, no
 * rule or workflow internals, and for a student never a raw reader result: the revision / curriculum / simulation /
 * exam intelligence results have no defined student-facing presentation (no route reads them yet), so the view says
 * so instead of exposing their internal traces. A staff view carries codes about a candidate, never its answer.
 */
export interface PublicStep {
  capability: string;
  status: "succeeded" | "failed" | "skipped";
  failure: { kind: FailureKind; code: string } | null;
}

export interface PublicOrchestrationView {
  task: TaskId;
  status: OrchestrationStatus;
  steps: PublicStep[];
  tutor: StudentTutorView | null;
  /** The student's own preference decisions, as plain sentences. */
  personalization: string[] | null;
  /** Capabilities whose results exist but have no defined presentation for this audience. */
  withheld: Array<{ capability: string; reason: "no_defined_presentation" }>;
  generation: { outcome: string; reasonCodes: string[]; reviewRequired: boolean; publishable: boolean } | null;
  failure: { kind: FailureKind; code: string } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

export function toPublicOrchestrationView(result: OrchestrationResult, actor: Actor): PublicOrchestrationView {
  const view: PublicOrchestrationView = {
    task: result.task,
    status: result.status,
    steps: result.steps.map((s) => ({ capability: s.capabilityId, status: s.status, failure: s.failure ? { kind: s.failure.kind, code: s.failure.code } : null })),
    tutor: null,
    personalization: null,
    withheld: [],
    generation: null,
    failure: result.failure ? { kind: result.failure.kind, code: result.failure.code } : null
  };
  for (const step of result.steps) {
    const output = result.outputs[step.stepId];
    if (output === undefined) continue;
    switch (step.capabilityId) {
      case "tutor_response":
        if (actor.kind === "student" && isRecord(output) && "teachingAction" in output) view.tutor = toStudentTutorView(output as unknown as TutorResponse);
        break;
      case "personalization":
        if (actor.kind === "student" && isRecord(output) && Array.isArray(output.decisions)) view.personalization = (output.decisions as PersonalizationDecision[]).filter((d) => d.effect !== "not_applied").map(explainDecision); // only what actually changed
        break;
      case "question_generation":
        if (actor.kind === "staff" && isRecord(output) && isRecord(output.trace)) {
          const t = output.trace as { reasons?: Array<{ code: string }>; reviewRequired?: boolean; publishable?: boolean };
          view.generation = { outcome: String(output.kind), reasonCodes: (t.reasons ?? []).map((r) => r.code), reviewRequired: t.reviewRequired === true, publishable: t.publishable === true };
        }
        break;
      default:
        view.withheld.push({ capability: step.capabilityId, reason: "no_defined_presentation" });
    }
  }
  return view;
}
