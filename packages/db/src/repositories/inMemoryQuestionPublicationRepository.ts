import { decidePublication, type PublicationDecisionAction } from "@ipmat/question-engine";
import { PersistenceError } from "./errors.js";
import type { QuestionPublicationRecord, QuestionPublicationRepository } from "./types.js";

/**
 * Test double for `QuestionPublicationRepository`, seeded directly with
 * `QuestionPublicationRecord`s. Shipped from this package's production
 * `src/`, not a `test/` fixture — the same `FixtureProvider`/
 * `InMemoryAttemptRepository`/`InMemoryQuestionReader` precedent
 * (docs/DECISIONS.md D-047). Calls the EXACT SAME shared
 * `decidePublication()` `PrismaQuestionPublicationRepository` calls, and
 * never writes when it throws — a refused decision leaves the seeded
 * record untouched.
 */
export class InMemoryQuestionPublicationRepository implements QuestionPublicationRepository {
  private readonly byId = new Map<string, QuestionPublicationRecord>();

  constructor(seed: QuestionPublicationRecord[] = []) {
    for (const record of seed) {
      this.byId.set(record.id, record);
    }
  }

  async findById(questionId: string): Promise<QuestionPublicationRecord | null> {
    return this.byId.get(questionId) ?? null;
  }

  async decide(questionId: string, action: PublicationDecisionAction): Promise<QuestionPublicationRecord> {
    const existing = this.byId.get(questionId);
    if (!existing) {
      throw new PersistenceError("missing_reference", `No Question found with id "${questionId}".`);
    }

    const nextValidationState = decidePublication(action, {
      currentValidationState: existing.validationState,
      difficultyTier: existing.difficultyTier,
      hasProvenance: existing.hasProvenance
    });

    const updated: QuestionPublicationRecord = { ...existing, validationState: nextValidationState };
    this.byId.set(questionId, updated);
    return updated;
  }
}
