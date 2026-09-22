export type PersistenceErrorCode = "invalid_record" | "missing_reference";

/**
 * Fail-closed guard for the persistence boundary specifically — distinct
 * from `@ipmat/autopsy`'s `HypothesisError` (a domain-rule violation) and
 * `@ipmat/attempt`'s `AttemptLifecycleError`. This error means "the shape
 * of data a repository was asked to write is not safe to write" (a
 * malformed id, a non-finite numeric measure, a foreign key this package
 * could not resolve) — never a domain-rule violation, which the domain
 * packages already guard on their own terms before persistence is ever
 * reached. Mirrors the same "typed error class, fail closed" discipline
 * used throughout this codebase (docs/DECISIONS.md).
 */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}
