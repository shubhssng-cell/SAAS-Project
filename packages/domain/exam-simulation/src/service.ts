import { assemblePaper } from "./paper.js";
import { applyMutation, buildSimulationView, isPastDeadline, planAnswer, planSettle, planSubmit, startSimulation, type AnswerInput, type AnswerKeyLoader, type SimulationMutation } from "./engine.js";
import {
  SimulationError,
  type AnswerKey,
  type AnswerOutcome,
  type PaperCandidate,
  type SimulationDefinition,
  type SimulationResult,
  type SimulationState,
  type SimulationView,
  type SubmitOutcome
} from "./types.js";

// ---- ports: everything the service needs from the outside, none of it exam-specific ----

export interface SimulationEnrollment {
  id: string;
  studentId: string;
  examCode: string;
}

export interface SimulationEnrollmentReader {
  findById(enrollmentId: string): Promise<SimulationEnrollment | null>;
}

/** Supplies an exam's mechanics and an explicit paper selection, or `null` when none is configured. This package ships no configuration. */
export interface SimulationConfigSource {
  findDefinition(examCode: string): Promise<SimulationDefinition | null>;
}

/** Student-safe content of one published question. Structurally has no answer-bearing field. */
export interface SimulationQuestionContent {
  questionId: string;
  prompt: string;
  answerFormat: "multiple_choice" | "numeric_entry";
  options: readonly string[] | null;
  contentFingerprint: string;
}

export interface SimulationQuestionSource {
  /** Exam-scoped candidates for paper assembly. Must not return questions of another exam. */
  findPaperCandidates(examCode: string, questionIds: readonly string[]): Promise<PaperCandidate[]>;
  /** Published, exam-scoped student-safe content. A question that is not published or not of this exam is omitted. */
  findPublishedContent(examCode: string, questionIds: readonly string[]): Promise<SimulationQuestionContent[]>;
  /** Answer keys and current content versions. SERVER-SIDE ONLY: used at finalization, never returned to a caller. */
  findAnswerKeys(questionIds: readonly string[]): Promise<AnswerKey>;
}

export interface SimulationRepository {
  /** Persists a NEW simulation. `in_progress_exists` when the enrollment already has one in progress (at most one may). */
  insert(state: SimulationState): Promise<"created" | "in_progress_exists">;
  load(simulationId: string): Promise<SimulationState | null>;
  findInProgressForEnrollment(enrollmentId: string): Promise<SimulationState | null>;
  /**
   * Atomically, with this simulation serialized against every other operation on it: load the current state, run `decide`,
   * and apply the mutation it returns. `null` when the simulation does not exist. This is what makes an answer, a submit,
   * an expiry and a duplicate request race-safe.
   */
  transact<T>(simulationId: string, decide: (current: SimulationState) => Promise<{ mutation: SimulationMutation; outcome: T }>): Promise<{ state: SimulationState; outcome: T } | null>;
}

export interface SimulationServiceDependencies {
  enrollments: SimulationEnrollmentReader;
  configs: SimulationConfigSource;
  questions: SimulationQuestionSource;
  repository: SimulationRepository;
  /** The SERVER clock (ISO-8601). Called once per operation; no client time is ever read. */
  now: () => string;
  newId: () => string;
}

export interface SimulationRequest {
  studentId: string;
  enrollmentId: string;
}

export interface SimulationQuestionView {
  position: number;
  sectionName: string;
  prompt: string;
  answerFormat: "multiple_choice" | "numeric_entry";
  options: readonly string[] | null;
}

/**
 * The simulation use cases. Every method verifies enrollment ownership first and then that the simulation belongs to that
 * student, enrollment and exam; another student's, another enrollment's or another exam's simulation is
 * `simulation_not_found`, identical to a missing one. It never touches a practice attempt, training, adaptive, revision,
 * repair or mastery code or data - it has no dependency on any of them.
 */
export class SimulationService {
  constructor(private readonly deps: SimulationServiceDependencies) {}

  private async authorizeEnrollment(request: SimulationRequest): Promise<SimulationEnrollment> {
    const enrollment = await this.deps.enrollments.findById(request.enrollmentId);
    if (!enrollment) throw new SimulationError("enrollment_not_found", "No such enrollment.");
    if (enrollment.studentId !== request.studentId) throw new SimulationError("enrollment_ownership_mismatch", "That enrollment does not belong to this student.");
    return enrollment;
  }

  private async authorize(request: SimulationRequest, simulationId: string): Promise<{ enrollment: SimulationEnrollment; state: SimulationState }> {
    const enrollment = await this.authorizeEnrollment(request);
    const state = await this.deps.repository.load(simulationId);
    if (!state || state.studentId !== request.studentId || state.enrollmentId !== request.enrollmentId || state.examCode !== enrollment.examCode) {
      throw new SimulationError("simulation_not_found", "No such simulation.");
    }
    return { enrollment, state };
  }

  /**
   * Answer keys are loaded BEFORE the simulation is locked, and only when finalization is certain to need them (an in-progress
   * simulation being submitted, or one found past its deadline). Loading them inside the lock would hold a database connection
   * while waiting for a second one, which starves the pool under concurrent requests. The deadline is immutable and `now` is
   * fixed per operation, so the pre-lock decision matches the in-lock one; if another request finalizes first, the engine
   * simply never asks for the keys. Asking for keys that were not preloaded is a bug and fails loudly.
   */
  private async keysFor(state: SimulationState, now: string, op: "submit" | "other"): Promise<AnswerKeyLoader> {
    const needed = state.status === "in_progress" && (op === "submit" || isPastDeadline(state, now));
    if (!needed) {
      return async () => {
        throw new Error("Answer keys were requested but not preloaded.");
      };
    }
    const keys = await this.deps.questions.findAnswerKeys(state.paper.questions.map((q) => q.questionId));
    return async () => keys;
  }

  /** Lazy expiry on any access: a simulation found past its deadline is finalized as `expired` at the deadline. Idempotent. */
  private async settle(state: SimulationState, now: string): Promise<SimulationState> {
    if (state.status !== "in_progress") return state;
    const loadKey = await this.keysFor(state, now, "other");
    const settled = await this.deps.repository.transact(state.id, async (current) => {
      const { mutation, expired } = await planSettle(current, now, loadKey);
      return { mutation, outcome: expired };
    });
    if (!settled) throw new SimulationError("simulation_not_found", "No such simulation.");
    return settled.state;
  }

  /**
   * Starts a simulation for the enrollment's exam from the configured definition, or RECOVERS the one already in progress
   * (a refresh, a reconnect or a double click never creates a second). Fails closed with `no_simulation_configured` when no
   * definition is supplied: no exam rule is ever assumed.
   */
  async start(request: SimulationRequest): Promise<{ simulation: SimulationView; created: boolean }> {
    const enrollment = await this.authorizeEnrollment(request);
    const now = this.deps.now();

    const existing = await this.deps.repository.findInProgressForEnrollment(enrollment.id);
    if (existing) {
      const settled = await this.settle(existing, now);
      if (settled.status === "in_progress") return { simulation: buildSimulationView(settled, now), created: false };
    }

    const definition = await this.deps.configs.findDefinition(enrollment.examCode);
    if (!definition) throw new SimulationError("no_simulation_configured", "No simulation is configured for this exam.");
    if (definition.config.examCode !== enrollment.examCode) throw new SimulationError("invalid_config", "The configuration belongs to another exam.", ["config_for_another_exam"]);

    const ids = Object.values(definition.selection.sections).flat();
    const candidates = await this.deps.questions.findPaperCandidates(enrollment.examCode, ids);
    const paper = assemblePaper(definition.config, definition.selection, candidates);
    const state = startSimulation({ id: this.deps.newId(), studentId: enrollment.studentId, enrollmentId: enrollment.id, config: definition.config, paper, now });

    if ((await this.deps.repository.insert(state)) === "in_progress_exists") {
      const winner = await this.deps.repository.findInProgressForEnrollment(enrollment.id);
      if (!winner) throw new SimulationError("simulation_not_found", "No such simulation.");
      return { simulation: buildSimulationView(await this.settle(winner, now), now), created: false };
    }
    return { simulation: buildSimulationView(state, now), created: true };
  }

  async get(request: SimulationRequest, simulationId: string): Promise<SimulationView> {
    const { state } = await this.authorize(request, simulationId);
    const now = this.deps.now();
    return buildSimulationView(await this.settle(state, now), now);
  }

  /** The student-safe content of ONE question of an in-progress simulation (no answer key, no solution). */
  async getQuestion(request: SimulationRequest, simulationId: string, position: number): Promise<SimulationQuestionView> {
    const { enrollment, state } = await this.authorize(request, simulationId);
    const settled = await this.settle(state, this.deps.now());
    if (settled.status !== "in_progress") throw new SimulationError("simulation_finalized", "This simulation has ended.");
    const question = settled.paper.questions.find((q) => q.position === position);
    if (!question) throw new SimulationError("invalid_position", "No such question position in this simulation.");
    const [content] = await this.deps.questions.findPublishedContent(enrollment.examCode, [question.questionId]);
    if (!content || content.contentFingerprint !== question.contentFingerprint) throw new SimulationError("question_content_changed", "This question's content changed after the paper was fixed.");
    return { position, sectionName: question.sectionName, prompt: content.prompt, answerFormat: content.answerFormat, options: content.options };
  }

  async answer(request: SimulationRequest, simulationId: string, input: AnswerInput): Promise<{ outcome: AnswerOutcome; simulation: SimulationView }> {
    const { enrollment, state } = await this.authorize(request, simulationId);
    const now = this.deps.now();
    const question = state.paper.questions.find((q) => q.position === input.position);
    // Content is loaded only for a real position; whether it is USED is decided inside the lock, after finalized/expired checks.
    const [content] = question ? await this.deps.questions.findPublishedContent(enrollment.examCode, [question.questionId]) : [];
    const context = { options: content?.options ?? null, currentFingerprint: content?.contentFingerprint ?? null };
    const loadKey = await this.keysFor(state, now, "other");
    const result = await this.deps.repository.transact(simulationId, (current) => planAnswer(current, input, now, context, loadKey));
    if (!result) throw new SimulationError("simulation_not_found", "No such simulation.");
    return { outcome: result.outcome, simulation: buildSimulationView(result.state, now) };
  }

  async submit(request: SimulationRequest, simulationId: string): Promise<{ outcome: SubmitOutcome; simulation: SimulationView; result: SimulationResult | null }> {
    const { state } = await this.authorize(request, simulationId);
    const now = this.deps.now();
    const loadKey = await this.keysFor(state, now, "submit");
    const done = await this.deps.repository.transact(simulationId, (current) => planSubmit(current, now, loadKey));
    if (!done) throw new SimulationError("simulation_not_found", "No such simulation.");
    return { outcome: done.outcome, simulation: buildSimulationView(done.state, now), result: done.state.result };
  }

  /** The finalized result of the student's own simulation. An in-progress one has none (`not_finalized`). */
  async result(request: SimulationRequest, simulationId: string): Promise<SimulationResult> {
    const { state } = await this.authorize(request, simulationId);
    const settled = await this.settle(state, this.deps.now());
    if (settled.result === null) throw new SimulationError("not_finalized", "This simulation has not been finalized.");
    return settled.result;
  }
}

/**
 * An in-memory repository with the same contract as the persistent one (including serialization per simulation and the
 * one-in-progress-per-enrollment rule). Used by the domain tests; the real one is the Prisma adapter in `@ipmat/db`.
 */
export class InMemorySimulationRepository implements SimulationRepository {
  private readonly states = new Map<string, SimulationState>();
  private readonly queues = new Map<string, Promise<unknown>>();

  async insert(state: SimulationState): Promise<"created" | "in_progress_exists"> {
    for (const s of this.states.values()) if (s.enrollmentId === state.enrollmentId && s.status === "in_progress") return "in_progress_exists";
    this.states.set(state.id, state);
    return "created";
  }

  async load(simulationId: string): Promise<SimulationState | null> {
    return this.states.get(simulationId) ?? null;
  }

  async findInProgressForEnrollment(enrollmentId: string): Promise<SimulationState | null> {
    for (const s of this.states.values()) if (s.enrollmentId === enrollmentId && s.status === "in_progress") return s;
    return null;
  }

  async transact<T>(simulationId: string, decide: (current: SimulationState) => Promise<{ mutation: SimulationMutation; outcome: T }>): Promise<{ state: SimulationState; outcome: T } | null> {
    const previous = this.queues.get(simulationId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const current = this.states.get(simulationId);
      if (!current) return null;
      const { mutation, outcome } = await decide(current);
      const next = applyMutation(current, mutation);
      this.states.set(simulationId, next);
      return { state: next, outcome };
    });
    this.queues.set(simulationId, run.catch(() => undefined));
    return run;
  }
}
