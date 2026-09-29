/**
 * Prevents exactly the race conditions this unit's instructions name: an
 * old `/v1/auth/me` hydration response overwriting a newer login result,
 * or a logout that finishes after a subsequent login incorrectly clearing
 * session state. Every state-changing auth action (hydrate/signup/login/
 * logout) takes a token via `next()` before its async call, and only
 * applies its result if `isCurrent(token)` is still true when the call
 * resolves -- a strictly later action always wins, and a stale response
 * is silently discarded rather than corrupting state.
 */
export interface OperationGuard {
  next(): number;
  isCurrent(token: number): boolean;
}

export function createOperationGuard(): OperationGuard {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isCurrent(token: number): boolean {
      return token === current;
    }
  };
}
