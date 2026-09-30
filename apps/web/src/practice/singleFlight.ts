/**
 * Coalesces concurrent calls that share a key into ONE underlying operation
 * (Product Phase 2 Unit 2). A second `run(key, ...)` while the first is still
 * in flight returns the same promise instead of starting another request --
 * so React StrictMode's double-invoked mount effect cannot start two attempts
 * for one question, and a fast double click cannot send two submissions.
 * The entry is dropped as soon as the operation settles (success or failure),
 * so a later, deliberate call (e.g. Retry after a failure) runs normally.
 */
export function createSingleFlight<T>(): { run(key: string, operation: () => Promise<T>): Promise<T> } {
  const inFlight = new Map<string, Promise<T>>();
  return {
    run(key, operation) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise: Promise<T> = operation().finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    }
  };
}
