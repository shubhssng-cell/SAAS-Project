import type { PracticeBlockStatus } from "@ipmat/practice-block";
import { PersistenceError } from "./errors.js";
import { InMemoryPracticeBlockReader, InMemoryPracticeBlockRepository } from "./inMemoryPracticeBlockRepository.js";
import { InMemoryPracticeSessionRepository } from "./inMemoryPracticeSessionRepository.js";
import type { StoredTrainingSession, TrainingSessionRepository } from "./types.js";

export interface InMemoryTrainingSessionRepositoryOptions {
  /** Resolves the student who owns an enrollment (the real database answers this with a join). `null` => unknown enrollment. */
  resolveStudentId: (enrollmentId: string) => Promise<string | null>;
}

interface Record_ {
  id: string;
  systemId: string;
  objective: unknown;
  config: unknown;
  practiceBlockId: string;
  createdAt: string;
}

/**
 * The in-memory double of `PrismaTrainingSessionRepository` -- the SAME interface, built on the
 * real in-memory `PracticeSession`/`PracticeBlock` repositories and the same `@ipmat/practice-block`
 * lifecycle functions, so its lifecycle behavior is the real one, not an approximation. It also
 * exposes the pieces the rest of the in-memory wiring needs to share ONE world with it:
 * `practiceSessions`/`practiceBlocks` (read by the recommendation composition), `blockReader`
 * (the fast ownership pre-check `PracticeLoopService` uses) and `blockOwnership` (the live map the
 * in-memory `AttemptRepository` consults when allocating a block sequence number).
 *
 * `create()` calls are serialized one at a time to mimic the database's `Serializable` isolation.
 */
export class InMemoryTrainingSessionRepository implements TrainingSessionRepository {
  readonly practiceSessions: InMemoryPracticeSessionRepository;
  readonly practiceBlocks: InMemoryPracticeBlockRepository;
  readonly blockReader: InMemoryPracticeBlockReader;
  readonly blockOwnership = new Map<string, { status: PracticeBlockStatus; enrollmentId: string; studentId: string }>();

  private readonly sessionOwnership = new Map<string, { enrollmentId: string; studentId: string }>();
  private readonly byId = new Map<string, Record_>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: InMemoryTrainingSessionRepositoryOptions) {
    this.practiceSessions = new InMemoryPracticeSessionRepository();
    this.practiceBlocks = new InMemoryPracticeBlockRepository({
      isSessionActive: () => true,
      resolveSessionOwnership: (practiceSessionId) => this.sessionOwnership.get(practiceSessionId)
    });
    this.blockReader = new InMemoryPracticeBlockReader(this.practiceBlocks);
  }

  create(input: Parameters<TrainingSessionRepository["create"]>[0]): Promise<StoredTrainingSession> {
    const run = this.tail.then(() => this.createNow(input));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async createNow(input: Parameters<TrainingSessionRepository["create"]>[0]): Promise<StoredTrainingSession> {
    const studentId = await this.options.resolveStudentId(input.enrollmentId);
    if (studentId === null) {
      throw new PersistenceError("missing_reference", `No Enrollment found with id "${input.enrollmentId}".`);
    }
    if ((await this.findActiveByEnrollmentId(input.enrollmentId)) !== null) {
      throw new PersistenceError("conflict", "This enrollment already has an active training session.");
    }

    const existing = await this.practiceSessions.findActiveByEnrollmentId(input.enrollmentId);
    const session = existing ?? (await this.practiceSessions.create({ id: input.practiceSessionId, enrollmentId: input.enrollmentId, now: input.now }));
    this.sessionOwnership.set(session.id, { enrollmentId: input.enrollmentId, studentId });

    const block = await this.practiceBlocks.create({
      id: input.practiceBlockId,
      practiceSessionId: session.id,
      now: input.now,
      targetQuestionCount: input.blockSettings.targetQuestionCount,
      blockTimeBudgetSeconds: input.blockSettings.blockTimeBudgetSeconds
    });
    this.blockOwnership.set(block.id, { status: block.status, enrollmentId: input.enrollmentId, studentId });
    this.byId.set(input.id, { id: input.id, systemId: input.systemId, objective: input.objective, config: input.config, practiceBlockId: block.id, createdAt: input.now });
    return (await this.findById(input.id))!;
  }

  async findById(trainingSessionId: string): Promise<StoredTrainingSession | null> {
    const record = this.byId.get(trainingSessionId);
    return record ? this.toStored(record) : null;
  }

  async findActiveByEnrollmentId(enrollmentId: string): Promise<StoredTrainingSession | null> {
    for (const record of this.byId.values()) {
      const stored = await this.toStored(record);
      if (stored.enrollmentId === enrollmentId && stored.block.status === "active") return stored;
    }
    return null;
  }

  async complete(trainingSessionId: string, input: { now: string }): Promise<StoredTrainingSession> {
    return this.terminate(trainingSessionId, "complete", input);
  }

  async abandon(trainingSessionId: string, input: { now: string }): Promise<StoredTrainingSession> {
    return this.terminate(trainingSessionId, "abandon", input);
  }

  private async terminate(trainingSessionId: string, action: "complete" | "abandon", input: { now: string }): Promise<StoredTrainingSession> {
    const record = this.byId.get(trainingSessionId);
    if (!record) throw new PersistenceError("missing_reference", `No TrainingSession found with id "${trainingSessionId}".`);
    const block = await (action === "complete" ? this.practiceBlocks.complete(record.practiceBlockId, input) : this.practiceBlocks.abandon(record.practiceBlockId, input));
    const ownership = this.blockOwnership.get(block.id);
    if (ownership) this.blockOwnership.set(block.id, { ...ownership, status: block.status });
    return this.toStored(record);
  }

  private async toStored(record: Record_): Promise<StoredTrainingSession> {
    const block = (await this.practiceBlocks.findById(record.practiceBlockId))!;
    const owner = this.sessionOwnership.get(block.practiceSessionId)!;
    return { id: record.id, systemId: record.systemId, objective: record.objective, config: record.config, enrollmentId: owner.enrollmentId, studentId: owner.studentId, block, createdAt: record.createdAt };
  }
}
