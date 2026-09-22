import type { CanonicalQuestion, QuestionReader } from "./types.js";

/**
 * Test double for `QuestionReader`, seeded directly with `CanonicalQuestion`
 * records. Shipped from this package's production `src/`, not a `test/`
 * fixture — the same `FixtureProvider`/`InMemoryAttemptRepository`
 * precedent (docs/DECISIONS.md D-047), so a consuming package's tests can
 * depend on it via `@ipmat/db` rather than reaching across a package
 * boundary into another package's `test/` directory.
 */
export class InMemoryQuestionReader implements QuestionReader {
  private readonly byId = new Map<string, CanonicalQuestion>();

  constructor(seed: CanonicalQuestion[] = []) {
    for (const question of seed) {
      this.byId.set(question.id, question);
    }
  }

  async findById(questionId: string): Promise<CanonicalQuestion | null> {
    return this.byId.get(questionId) ?? null;
  }
}
