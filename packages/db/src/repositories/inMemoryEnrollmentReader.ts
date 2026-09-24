import type { EnrollmentReader, EnrollmentRecord } from "./types.js";

/**
 * Test double for `EnrollmentReader`, seeded directly with records. Shipped
 * from this package's production `src/` (the `InMemoryQuestionReader`
 * precedent, docs/DECISIONS.md D-047) so a consuming package's tests can
 * depend on it via `@ipmat/db`.
 */
export class InMemoryEnrollmentReader implements EnrollmentReader {
  private readonly byId = new Map<string, EnrollmentRecord>();

  constructor(seed: EnrollmentRecord[] = []) {
    for (const enrollment of seed) {
      this.byId.set(enrollment.id, enrollment);
    }
  }

  async findById(enrollmentId: string): Promise<EnrollmentRecord | null> {
    return this.byId.get(enrollmentId) ?? null;
  }
}
