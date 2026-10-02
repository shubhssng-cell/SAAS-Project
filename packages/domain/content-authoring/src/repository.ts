import { computeContentFingerprint } from "./fingerprint.js";
import type { AuthoredQuestion, IdentityRef } from "./types.js";
import type { UniverseQuestionRef } from "./universe.js";

/**
 * Persistence boundary for authored questions. INTERNAL: `findById` returns the
 * answer-bearing question and is for authoring/review only - nothing student
 * facing may use it (the student readers are separate, `select`-based and
 * published-only).
 */
export interface QuestionAuthoringRepository {
  /**
   * Stores a new DRAFT. Exact logical duplicates (same exam, wording and
   * options as a non-rejected question) are NOT created twice: the existing
   * id is returned with `alreadyExisted: true`. Similar-but-different questions
   * are never merged.
   */
  createDraft(question: AuthoredQuestion): Promise<{ id: string; alreadyExisted: boolean }>;
  findById(id: string): Promise<AuthoredQuestion | null>;
  /**
   * Applies a pure lifecycle function to the stored question and persists the
   * result. The id never changes; a published question is immutable except by
   * a lifecycle function that leaves its content unchanged.
   */
  mutate(id: string, fn: (current: AuthoredQuestion) => AuthoredQuestion): Promise<AuthoredQuestion>;
  /** Content-free references of one exam's questions, for the identity gate. */
  listIdentityRefs(examCode: string): Promise<IdentityRef[]>;
  /** Content-free DNA references of one exam's questions, for the Question Universe. */
  listUniverseRefs(examCode: string): Promise<UniverseQuestionRef[]>;
}

export class AuthoringConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringConflictError";
  }
}

export class InMemoryQuestionAuthoringRepository implements QuestionAuthoringRepository {
  private readonly rows = new Map<string, AuthoredQuestion>();

  async createDraft(question: AuthoredQuestion): Promise<{ id: string; alreadyExisted: boolean }> {
    if (question.validationState !== "draft") throw new AuthoringConflictError("only a draft can be created");
    const fingerprint = computeContentFingerprint(question.dna.examCode, question.content.body, question.content.options);
    for (const row of this.rows.values()) {
      if (row.dna.examCode === question.dna.examCode && row.validationState !== "rejected" && computeContentFingerprint(row.dna.examCode, row.content.body, row.content.options) === fingerprint) {
        return { id: row.id, alreadyExisted: true };
      }
    }
    if (this.rows.has(question.id)) throw new AuthoringConflictError(`question id "${question.id}" already exists`);
    this.rows.set(question.id, structuredClone(question));
    return { id: question.id, alreadyExisted: false };
  }

  async findById(id: string): Promise<AuthoredQuestion | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async mutate(id: string, fn: (current: AuthoredQuestion) => AuthoredQuestion): Promise<AuthoredQuestion> {
    const current = this.rows.get(id);
    if (!current) throw new AuthoringConflictError(`no question "${id}"`);
    const next = fn(structuredClone(current));
    if (next.id !== current.id) throw new AuthoringConflictError("a question's id never changes");
    if (next.dna.examCode !== current.dna.examCode) throw new AuthoringConflictError("a question never moves between exams");
    if (current.validationState === "published" && JSON.stringify(next.content) !== JSON.stringify(current.content)) throw new AuthoringConflictError("a published question's content is immutable");
    this.rows.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async listIdentityRefs(examCode: string): Promise<IdentityRef[]> {
    return [...this.rows.values()]
      .filter((q) => q.dna.examCode === examCode)
      .map((q) => ({ id: q.id, fingerprint: computeContentFingerprint(q.dna.examCode, q.content.body, q.content.options), body: q.content.body, validationState: q.validationState }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async listUniverseRefs(examCode: string): Promise<UniverseQuestionRef[]> {
    return [...this.rows.values()]
      .filter((q) => q.dna.examCode === examCode)
      .map((q) => ({ id: q.id, dna: structuredClone(q.dna), validationState: q.validationState }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}
