import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { apiCompleteOnboarding, apiLogin, apiLogout, apiMe, apiSignup, type AuthApiResult, type LogoutResult } from "./api.js";
import { authReducer, failureToHydrateEvent, type AuthState } from "./authState.js";
import { createOperationGuard } from "./operationGuard.js";

/**
 * The smallest clean auth client/state abstraction this unit needs. Owns
 * ONLY: the API calls (`api.ts`), current presentation state
 * (`authReducer`, a pure module — this component is a thin
 * `useReducer` wrapper around it), and race-safety (`operationGuard`). It
 * owns NO authentication logic itself — password validation, hashing,
 * session validation, and identity all remain exclusively server-side
 * (`@ipmat/auth`/`@ipmat/auth-api`, never imported here — see the Web
 * Architecture Lock in PHASE_1_PLATFORM_SHELL.md). `completeOnboarding()`
 * (Product Phase 1 Unit 6) follows the exact same pattern as
 * signup/login: call the server, apply its returned student on success.
 */
interface AuthContextValue {
  state: AuthState;
  signup: (input: { email: string; password: string }) => Promise<AuthApiResult>;
  login: (input: { email: string; password: string }) => Promise<AuthApiResult>;
  logout: () => Promise<LogoutResult>;
  completeOnboarding: () => Promise<AuthApiResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/*
 * `signup`/`login`/`completeOnboarding` apply their result with `flushSync` (Product Phase 1
 * Unit 11): callers `navigate()` immediately after these promises resolve, and an
 * async-continuation `dispatch` is otherwise rendered AFTER that synchronous navigation --
 * `RequireAuth` would render once with the stale "unauthenticated" state and bounce a student
 * who had just signed up back to `/login`. Reproduced in a real browser before this fix.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, { status: "loading" });
  const guard = useRef(createOperationGuard()).current;

  // Runs exactly once, on app startup — establishes presentation auth state from the
  // server (never assumes authenticated just because a protected route exists).
  useEffect(() => {
    const token = guard.next();
    apiMe().then((result) => {
      if (!guard.isCurrent(token)) return; // a login/signup/logout started meanwhile -- its own result already governs state.
      dispatch(result.ok ? { type: "HYDRATE_AUTHENTICATED", student: result.student } : failureToHydrateEvent(result.failure));
    });
  }, [guard]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async signup(input) {
        const token = guard.next();
        const result = await apiSignup(input);
        if (result.ok && guard.isCurrent(token)) flushSync(() => dispatch({ type: "SIGNED_UP", student: result.student }));
        return result;
      },
      async login(input) {
        const token = guard.next();
        const result = await apiLogin(input);
        if (result.ok && guard.isCurrent(token)) flushSync(() => dispatch({ type: "LOGGED_IN", student: result.student }));
        return result;
      },
      async logout() {
        const token = guard.next();
        const result = await apiLogout();
        // Clears presentation state regardless of the server's response -- a network
        // failure during logout must never leave the UI claiming an authenticated state
        // the student just asked to end. The server side is unconditionally idempotent
        // for an already-invalid token (see AuthApiService.logout()), so there is no
        // unsafe case this papers over.
        if (guard.isCurrent(token)) dispatch({ type: "LOGGED_OUT" });
        return result;
      },
      async completeOnboarding() {
        const token = guard.next();
        const result = await apiCompleteOnboarding();
        if (result.ok && guard.isCurrent(token)) flushSync(() => dispatch({ type: "ONBOARDING_COMPLETED", student: result.student }));
        return result;
      }
    }),
    [state, guard]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
