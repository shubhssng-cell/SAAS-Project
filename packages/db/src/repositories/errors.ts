/**
 * `ownership_mismatch` (docs/DECISIONS.md D-060 security-fix addendum) is
 * distinct from `invalid_record`: it means the data IS well-formed and the
 * referenced rows DO exist, but the authoritative ownership chain (e.g.
 * `PracticeBlock -> PracticeSession -> Enrollment -> Student`) does not
 * match the caller's claimed `studentId`/`enrollmentId` — a security
 * boundary violation, never a shape/validity problem.
 */
export type PersistenceErrorCode = "invalid_record" | "missing_reference" | "ownership_mismatch";

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

/**
 * D-060's ONE named, deterministic mapping for a Postgres serialization
 * failure (SQLSTATE 40001) under `Serializable` isolation — thrown by
 * `runSerializableTransaction()` (`serializable.ts`) whenever a
 * PracticeSession/PracticeBlock/Attempt write loses a genuine concurrent
 * conflict (e.g. two callers racing to allocate the next
 * `blockSequenceNumber` for the same block). There is deliberately NO
 * automatic retry anywhere in this repository layer (docs/DECISIONS.md
 * D-060, grounded in D-049's `decidePublication()` precedent) — this error
 * simply propagates to the caller, who owns the retry decision. Bounded
 * retry/backoff policy is explicitly out of scope here, deferred to a
 * future HTTP/API layer that does not exist yet.
 */
export class SerializationFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializationFailureError";
  }
}
