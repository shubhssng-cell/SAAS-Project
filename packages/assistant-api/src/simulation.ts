import { SimulationError, type SimulationQuestionView, type SimulationService, type SimulationView } from "@ipmat/exam-simulation";
import { AssistantApiError, infrastructureError, invalidRequest, isRecord, requireOnlyKeys, type StudentClaim } from "./errors.js";

/**
 * The full-exam simulation boundary (Phase 9 Unit 2, D-098) over the EXISTING `SimulationService`, which already verifies
 * enrollment ownership, student/enrollment/exam on every operation, takes server time only, keeps an append-only answer log and
 * finalizes idempotently. This layer adds only: the verified claim, strict input, fixed error wording, and a deliberately NARROW
 * surface - there is no result read (a finalized result carries per-question correctness and its student presentation is
 * unspecified, D-090/D-091) and no client time, other student, or configuration input anywhere.
 */
const STATUS: Readonly<Record<string, [AssistantApiError["code"], number, string]>> = {
  no_simulation_configured: ["not_available", 503, "No simulation is available for your exam yet."],
  enrollment_not_found: ["forbidden", 403, "You can't use that enrollment."],
  enrollment_ownership_mismatch: ["forbidden", 403, "You can't use that enrollment."],
  simulation_not_found: ["not_found", 404, "No such simulation."],
  simulation_finalized: ["conflict", 409, "This simulation has ended."],
  invalid_position: ["invalid_request", 400, "That question position doesn't exist."],
  invalid_answer: ["invalid_request", 400, "That answer isn't valid for this question."],
  question_content_changed: ["conflict", 409, "This question changed after the paper was fixed."],
  not_finalized: ["conflict", 409, "This simulation hasn't ended."]
};

function mapError(error: unknown): never {
  if (error instanceof AssistantApiError) throw error;
  if (error instanceof SimulationError) {
    const mapped = STATUS[error.code];
    if (mapped) throw new AssistantApiError(mapped[0], mapped[2], mapped[1]);
  }
  throw infrastructureError(error, "Something went wrong. Please try again.");
}

export interface SimulationAnswerDto {
  outcome: "recorded" | "rejected_expired" | "rejected_finalized";
  simulation: SimulationView;
}

/** Whether a simulation is configured for an exam, and the exam of a student's own enrollment. Both injected; neither is client input. */
export interface SimulationAvailabilityDeps {
  isConfigured(examCode: string): Promise<boolean>;
  examOf(studentId: string, enrollmentId: string): Promise<string | null>;
}

export class SimulationApiService {
  constructor(
    private readonly service: SimulationService,
    private readonly availabilityDeps?: SimulationAvailabilityDeps
  ) {}

  /**
   * Whether the student's exam has a simulation configured (the repository ships no exam rules, so until the owner supplies a
   * configuration this is `false`). It reads no paper and no student data, starts nothing and uses no allowance, so the web can tell a
   * student the truth instead of offering a button that can only fail.
   */
  async availability(claim: StudentClaim): Promise<{ available: boolean }> {
    if (!this.availabilityDeps) return { available: false };
    try {
      const examCode = await this.availabilityDeps.examOf(claim.studentId, claim.enrollmentId);
      return { available: examCode !== null && (await this.availabilityDeps.isConfigured(examCode)) };
    } catch (error) {
      throw infrastructureError(error, "Something went wrong. Please try again.");
    }
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      return mapError(error);
    }
  }

  start(claim: StudentClaim): Promise<{ simulation: SimulationView; created: boolean }> {
    return this.run(() => this.service.start(claim));
  }

  get(claim: StudentClaim, simulationId: string): Promise<{ simulation: SimulationView }> {
    return this.run(async () => ({ simulation: await this.service.get(claim, simulationId) }));
  }

  async question(claim: StudentClaim, simulationId: string, position: unknown): Promise<{ question: SimulationQuestionView }> {
    if (typeof position !== "string" || !/^\d{1,4}$/.test(position)) throw invalidRequest("The question position is malformed.");
    return this.run(async () => ({ question: await this.service.getQuestion(claim, simulationId, Number(position)) }));
  }

  async answer(claim: StudentClaim, simulationId: string, body: unknown): Promise<SimulationAnswerDto> {
    if (!isRecord(body)) throw invalidRequest("The request body must be a JSON object.");
    requireOnlyKeys(body, ["position", "answer"]); // no time, no student, no enrollment
    const { position, answer } = body;
    if (typeof position !== "number" || !Number.isInteger(position) || typeof answer !== "string" || answer.length > 200) throw invalidRequest("An integer position and a short answer are required.");
    return this.run(async () => {
      const result = await this.service.answer(claim, simulationId, { position, answer });
      return { outcome: result.outcome, simulation: result.simulation };
    });
  }

  submit(claim: StudentClaim, simulationId: string): Promise<{ outcome: string; simulation: SimulationView }> {
    return this.run(async () => {
      const done = await this.service.submit(claim, simulationId); // the finalized `result` is deliberately dropped
      return { outcome: done.outcome, simulation: done.simulation };
    });
  }
}
